import { config, googleApiKey } from '../config.js'
import { CallCounter } from '../budget/usage.js'
import { zip5 } from '../core/normalize.js'
import { inArea } from '../geo/area.js'
import type { Provider, RunContext, SourceRecord } from '../core/types.js'

/**
 * Google Places API (New) Text Search, basic fields only (the Pro tier): place ID, name,
 * address and location. No phone or website, which would move every call to the pricier
 * Enterprise tier. Each page of up to 20 results is one billed call. Google returns at most
 * 60 results (3 pages) for one search, so when an area fills all 3 pages we split it into
 * 4 smaller boxes and search each one.
 *
 * Google's terms let us keep only the place ID. Name and address are used for matching;
 * the report lists any CSV field that came only from Google.
 */
const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
  'places.location', 'places.businessStatus', 'places.types', 'places.primaryType', 'nextPageToken',
].join(',')

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'

interface Box { minLat: number; maxLat: number; minLng: number; maxLng: number }
interface GPlace {
  id: string
  displayName?: { text?: string }
  formattedAddress?: string
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[]
  location?: { latitude: number; longitude: number }
  businessStatus?: string
  types?: string[]
  primaryType?: string
}

export const googleCounter = new CallCounter('google', config.google.maxCallsPerRun, config.google.maxCallsPerMonth)

/** One Text Search request. Exported for the source check. */
export async function textSearchPage(query: string, box: Box, pageToken?: string): Promise<{ places: GPlace[]; nextPageToken?: string; error?: string }> {
  googleCounter.record()
  const body: Record<string, unknown> = {
    textQuery: query,
    pageSize: config.google.pageSize,
    locationRestriction: { rectangle: { low: { latitude: box.minLat, longitude: box.minLng }, high: { latitude: box.maxLat, longitude: box.maxLng } } },
  }
  if (pageToken) body.pageToken = pageToken
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleApiKey(), 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as { places?: GPlace[]; nextPageToken?: string; error?: { message?: string } }
  if (!res.ok) return { places: [], error: `HTTP ${res.status}: ${json.error?.message ?? 'unknown error'}` }
  return { places: json.places ?? [], nextPageToken: json.nextPageToken }
}

function split(b: Box): Box[] {
  const midLat = (b.minLat + b.maxLat) / 2
  const midLng = (b.minLng + b.maxLng) / 2
  return [
    { minLat: b.minLat, maxLat: midLat, minLng: b.minLng, maxLng: midLng },
    { minLat: b.minLat, maxLat: midLat, minLng: midLng, maxLng: b.maxLng },
    { minLat: midLat, maxLat: b.maxLat, minLng: b.minLng, maxLng: midLng },
    { minLat: midLat, maxLat: b.maxLat, minLng: midLng, maxLng: b.maxLng },
  ]
}

export const googleProvider: Provider & { errors: string[] } = {
  name: 'google',
  paid: true,
  errors: [],

  async search(ctx: RunContext): Promise<SourceRecord[]> {
    const { area, niche, log } = ctx
    if (!config.google.enabled || !config.paidSources.google.enabled) { log('Google: turned off in config, skipped'); return [] }
    if (!googleApiKey()) { log('Google: GOOGLE_PLACES_API_KEY not set, skipped'); return [] }
    const found = new Map<string, GPlace>()

    const searchBox = async (query: string, box: Box, depth: number): Promise<void> => {
      let token: string | undefined
      let count = 0
      for (let page = 0; page < 3; page++) {
        if (!googleCounter.canCall()) return
        const r = await textSearchPage(query, box, token)
        if (r.error) { this.errors.push(r.error); log(`Google error: ${r.error}`); return }
        r.places.forEach((p) => found.set(p.id, p))
        count += r.places.length
        token = r.nextPageToken
        if (!token) break
      }
      // A full 60 means Google may have more here than it will show. Split and search again.
      if (count >= 60 && depth < config.google.maxSplitDepth) {
        for (const sub of split(box)) await searchBox(query, sub, depth + 1)
      }
    }

    for (const q of niche.googleQueries) {
      await searchBox(q, area.bbox, 0)
      if (googleCounter.stoppedAtCap) break
    }
    if (googleCounter.stoppedAtCap) log(`Google: stopped at the ${googleCounter.stoppedAtCap}. Coverage may be incomplete.`)
    const out = [...found.values()].map((p) => this.normalize(p)).filter((r): r is SourceRecord => !!r && inArea(area, r))
    log(`Google: ${googleCounter.runCalls} calls, ${found.size} places, ${out.length} inside the radius`)
    return out
  },

  normalize(raw: unknown): SourceRecord | null {
    const p = raw as GPlace
    const name = p.displayName?.text
    if (!p.id || !name) return null
    const comp = (t: string, short = false) => {
      const c = p.addressComponents?.find((x) => x.types?.includes(t))
      return short ? c?.shortText : c?.longText
    }
    const street = [comp('street_number'), comp('route', true)].filter(Boolean).join(' ')
    const sub = comp('subpremise')
    return {
      source: 'google',
      sourceId: p.id,
      name,
      address: street ? (sub ? `${street} Ste ${sub}` : street) : p.formattedAddress?.split(',')[0],
      city: comp('locality') || comp('sublocality') || comp('postal_town'),
      state: comp('administrative_area_level_1', true),
      zip: zip5(comp('postal_code')),
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      categories: [p.primaryType, ...(p.types ?? [])].filter((t): t is string => !!t),
      closed: p.businessStatus === 'CLOSED_PERMANENTLY',
    }
  },

  estimateCost(calls: number): number {
    const billable = Math.max(0, calls - config.google.freeCallsPerMonth)
    return (billable / 1000) * config.google.costPer1000
  },
}

/** List price of the calls before the free monthly allowance, for the report. */
export const googleListPrice = (calls: number) => (calls / 1000) * config.google.costPer1000
