import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { config, CACHE_DIR, ensureDir } from '../config.js'
import { httpGetBuffer } from '../core/http.js'
import { haversineMiles } from '../core/normalize.js'
import type { SearchArea } from '../core/types.js'

/**
 * Census Gazetteer files (public domain) give a center point for every ZIP code area (ZCTA)
 * and every city or town. We download each once (about 1 MB zipped) and cache it.
 */
interface GazRow { [k: string]: string }

async function loadGazetteer(kind: 'zcta' | 'place'): Promise<GazRow[]> {
  const dir = ensureDir(join(CACHE_DIR, 'geo'))
  const cached = join(dir, `${kind}.json`)
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'))
  const url = kind === 'zcta' ? config.geo.zctaGazetteerUrl : config.geo.placeGazetteerUrl
  const zipped = await httpGetBuffer(url)
  const files = unzipSync(zipped)
  const name = Object.keys(files).find((f) => f.endsWith('.txt'))
  if (!name) throw new Error(`No .txt file inside ${url}`)
  const lines = strFromU8(files[name]).split(/\r?\n/).filter(Boolean)
  const header = lines[0].split('\t').map((h) => h.trim())
  const keep = kind === 'zcta' ? ['GEOID', 'INTPTLAT', 'INTPTLONG'] : ['USPS', 'NAME', 'LSAD', 'INTPTLAT', 'INTPTLONG']
  const idx = keep.map((k) => header.indexOf(k))
  if (idx.some((i) => i < 0)) throw new Error(`Gazetteer ${kind} columns changed. Found: ${header.join(', ')}`)
  const rows = lines.slice(1).map((l) => {
    const c = l.split('\t')
    return Object.fromEntries(keep.map((k, j) => [k, (c[idx[j]] ?? '').trim()]))
  })
  writeFileSync(cached, JSON.stringify(rows))
  return rows
}

/** "Charlotte city" -> "Charlotte", "Mint Hill town" -> "Mint Hill", "Ballantyne CDP" -> "Ballantyne". */
export function placeBaseName(name: string): string {
  return name.replace(/\s+(city|town|village|CDP|borough|municipality|city and borough|metropolitan government.*|consolidated government.*|unified government.*)$/i, '').trim()
}

export interface AreaInput {
  city?: string
  state?: string
  zip?: string
  radiusMiles: number
  lat?: number
  lng?: number
}

export async function resolveArea(input: AreaInput, log: (m: string) => void): Promise<SearchArea> {
  let lat = input.lat
  let lng = input.lng
  const state = input.state?.toUpperCase()
  let zctas: GazRow[] = []
  let places: GazRow[] = []
  try {
    zctas = await loadGazetteer('zcta')
    places = await loadGazetteer('place')
  } catch (e) {
    log(`WARNING: could not load Census Gazetteer files (${(e as Error).message}). ZIP and town lists will be empty.`)
  }

  if (lat === undefined || lng === undefined) {
    if (input.zip) {
      const z = zctas.find((r) => r.GEOID === input.zip)
      if (!z) throw new Error(`ZIP ${input.zip} not found in the Census ZIP list. Pass --lat and --lng instead.`)
      lat = Number(z.INTPTLAT); lng = Number(z.INTPTLONG)
    } else if (input.city && state) {
      const want = input.city.trim().toLowerCase()
      const hits = places.filter((p) => p.USPS === state && placeBaseName(p.NAME).toLowerCase() === want)
      // Prefer an incorporated city or town over a census-designated place of the same name.
      const p = hits.find((h) => !/CDP$/.test(h.NAME)) || hits[0]
      if (!p) throw new Error(`City "${input.city}, ${state}" not found in the Census place list. Check spelling or pass --lat and --lng.`)
      lat = Number(p.INTPTLAT); lng = Number(p.INTPTLONG)
    } else {
      throw new Error('Give --city and --state, or --zip, or --lat and --lng.')
    }
  }

  const r = input.radiusMiles
  const dLat = r / 69.0
  const dLng = r / (69.172 * Math.cos((lat * Math.PI) / 180))
  const zips = new Set(zctas.filter((z) => haversineMiles(lat!, lng!, Number(z.INTPTLAT), Number(z.INTPTLONG)) <= r).map((z) => z.GEOID))
  const inPlaces = places
    .filter((p) => haversineMiles(lat!, lng!, Number(p.INTPTLAT), Number(p.INTPTLONG)) <= r)
    .map((p) => ({ name: placeBaseName(p.NAME), state: p.USPS }))
  const states = new Set(inPlaces.map((p) => p.state))
  if (state) states.add(state)
  if (input.city && state && !inPlaces.some((p) => p.name.toLowerCase() === input.city!.toLowerCase())) {
    inPlaces.unshift({ name: input.city, state })
  }
  const label = input.zip ? `ZIP ${input.zip}` : input.city ? `${input.city}, ${state}` : `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  return {
    label,
    centerLat: lat,
    centerLng: lng,
    radiusMiles: r,
    bbox: { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng },
    zips,
    places: inPlaces,
    states,
  }
}

/** True when a record is inside the search radius, by point when it has one, else by ZIP. */
export function inArea(area: SearchArea, rec: { lat?: number; lng?: number; zip?: string; state?: string }): boolean {
  if (rec.lat !== undefined && rec.lng !== undefined && !Number.isNaN(rec.lat)) {
    return haversineMiles(area.centerLat, area.centerLng, rec.lat, rec.lng) <= area.radiusMiles
  }
  if (rec.zip && area.zips.size) return area.zips.has(rec.zip)
  return false
}
