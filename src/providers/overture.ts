import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects, type FileMetaData } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { config } from '../config.js'
import { httpGet, sleep } from '../core/http.js'
import { normPhone, zip5, normalizeUrl } from '../core/normalize.js'
import { inArea } from '../geo/area.js'
import type { Provider, RunContext, SourceRecord } from '../core/types.js'

/**
 * Overture Maps places: free open data (CDLA Permissive 2.0, Apache 2.0 and CC0, depending on
 * the record's source). The files are sorted by location, so we read only the row groups whose
 * bounding box overlaps the search area. That is a few MB out of about 13 GB.
 *
 * Schema checked against the 10-21-2026 release: names.primary, basic_category,
 * taxonomy {primary, hierarchy, alternates}, addresses[], phones[], websites[], emails[],
 * brand.names.primary, operating_status, confidence, sources[], bbox.
 */
const COLUMNS = ['id', 'names', 'basic_category', 'taxonomy', 'confidence', 'addresses', 'phones', 'websites', 'emails', 'brand', 'operating_status', 'bbox', 'sources']

export async function latestRelease(): Promise<string> {
  if (config.overture.release !== 'latest') return config.overture.release
  const res = await httpGet(`${config.overture.bucketUrl}/?list-type=2&prefix=release/&delimiter=/`, { timeoutMs: 30000 })
  const releases = [...res.text.matchAll(/<Prefix>release\/([^<]+)\/<\/Prefix>/g)].map((m) => m[1]).sort()
  if (!releases.length) throw new Error(`Could not list Overture releases (HTTP ${res.status})`)
  return releases[releases.length - 1]
}

async function listPlaceFiles(release: string): Promise<string[]> {
  const prefix = `release/${release}/theme=places/type=place/`
  const res = await httpGet(`${config.overture.bucketUrl}/?list-type=2&prefix=${encodeURIComponent(prefix)}`, { timeoutMs: 30000 })
  return [...res.text.matchAll(/<Key>([^<]+\.parquet)<\/Key>/g)].map((m) => `${config.overture.bucketUrl}/${m[1]}`)
}

function statsOf(md: FileMetaData, rg: number, path: string) {
  const col = md.row_groups[rg].columns.find((c) => c.meta_data?.path_in_schema.join('.') === path)
  const s = col?.meta_data?.statistics
  return { min: Number(s?.min_value ?? s?.min), max: Number(s?.max_value ?? s?.max) }
}

interface OvertureRow {
  id: string
  names?: { primary?: string }
  basic_category?: string
  taxonomy?: { primary?: string; hierarchy?: string[]; alternates?: string[] }
  confidence?: number
  addresses?: { freeform?: string; locality?: string; postcode?: string; region?: string; country?: string }[]
  phones?: string[]
  websites?: string[]
  emails?: string[]
  brand?: { names?: { primary?: string } }
  operating_status?: string
  bbox?: { xmin: number; xmax: number; ymin: number; ymax: number }
}

export const overtureProvider: Provider & { release?: string } = {
  name: 'overture',
  paid: false,

  async search(ctx: RunContext): Promise<SourceRecord[]> {
    const { area, niche, log } = ctx
    const release = await latestRelease()
    this.release = release
    const files = await listPlaceFiles(release)
    log(`Overture release ${release}: ${files.length} place files`)
    const b = area.bbox
    const rows: OvertureRow[] = []
    // Read each file up to 3 times: a long download through a slow network can drop partway.
    const readFile = async (url: string) => {
      for (let attempt = 1; ; attempt++) {
        const before = rows.length
        try { return await readOne(url) } catch (e) {
          rows.length = before
          if (attempt >= 3) throw e
          log(`Overture: retrying a file after "${(e as Error).message}" (attempt ${attempt + 1} of 3)`)
          await sleep(2000 * attempt)
        }
      }
    }
    const readOne = async (url: string) => {
        const file = await asyncBufferFromUrl({ url })
        const md = await parquetMetadataAsync(file)
        let start = 0
        for (let rg = 0; rg < md.row_groups.length; rg++) {
          const n = Number(md.row_groups[rg].num_rows)
          const x = statsOf(md, rg, 'bbox.xmin')
          const y = statsOf(md, rg, 'bbox.ymin')
          const overlaps = !(x.max < b.minLng || x.min > b.maxLng || y.max < b.minLat || y.min > b.maxLat)
          if (overlaps) {
            const part = (await parquetReadObjects({ file, metadata: md, columns: COLUMNS, rowStart: start, rowEnd: start + n, compressors })) as OvertureRow[]
            for (const r of part) {
              if (r.bbox && r.bbox.xmin >= b.minLng && r.bbox.xmin <= b.maxLng && r.bbox.ymin >= b.minLat && r.bbox.ymin <= b.maxLat) rows.push(r)
            }
          }
          start += n
        }
    }
    // A few files at a time, so a retry does not drop rows another file added in the meantime.
    for (const url of files) await readFile(url)
    const tax = new Set(niche.overtureTaxonomies)
    const kw = niche.keywords.map((k) => k.toLowerCase())
    const out: SourceRecord[] = []
    for (const r of rows) {
      const t = r.taxonomy
      const taxHit = [t?.primary, ...(t?.alternates ?? [])].some((c) => c && tax.has(c))
      const name = (r.names?.primary || '').toLowerCase()
      const kwHit = kw.some((k) => name.includes(k))
      if (!taxHit && !kwHit) continue
      // An excluded main category (home builder, salon...) rules it out unless the name says otherwise.
      if (!kwHit && niche.excludeCategories.test(t?.primary ?? '')) continue
      if (!taxHit && niche.excludeCategories.test([t?.primary, r.basic_category].filter(Boolean).join(' '))) continue
      const rec = this.normalize(r)
      if (rec && inArea(area, rec)) out.push(rec)
    }
    log(`Overture: ${rows.length} places in the search box, ${out.length} match the niche inside the radius`)
    return out
  },

  normalize(raw: unknown): SourceRecord | null {
    const r = raw as OvertureRow
    const name = r.names?.primary
    if (!name) return null
    const a = r.addresses?.[0]
    const lng = r.bbox ? (r.bbox.xmin + r.bbox.xmax) / 2 : undefined
    const lat = r.bbox ? (r.bbox.ymin + r.bbox.ymax) / 2 : undefined
    const region = a?.region?.replace(/^US-/, '').toUpperCase()
    return {
      source: 'overture',
      sourceId: r.id,
      name,
      address: a?.freeform,
      city: a?.locality,
      state: region && region.length === 2 ? region : undefined,
      zip: zip5(a?.postcode),
      phone: normPhone(r.phones?.[0]) || undefined,
      website: normalizeUrl(r.websites?.[0]) || undefined,
      emails: r.emails?.filter(Boolean).map((e) => e.toLowerCase()),
      lat,
      lng,
      categories: [r.taxonomy?.primary, r.basic_category, ...(r.taxonomy?.alternates ?? [])].filter((c): c is string => !!c),
      closed: r.operating_status === 'permanently_closed' || r.operating_status === 'closed',
      sourceConfidence: r.confidence,
      altNames: r.brand?.names?.primary ? [r.brand.names.primary] : undefined,
    }
  },

  estimateCost: () => 0,
}
