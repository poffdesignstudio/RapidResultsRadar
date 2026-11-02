import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config, CACHE_DIR, ensureDir } from '../config.js'
import { httpGet } from '../core/http.js'
import { parseCsv } from '../core/csv.js'

/**
 * Downloads CMS data files once and caches them for `cms.cacheDays`. CMS column names shift
 * between releases, so callers look columns up by pattern (see `col`) instead of exact name.
 *
 */
export async function cachedCsv(cacheName: string, url: string): Promise<Record<string, string>[]> {
  const dir = ensureDir(join(CACHE_DIR, 'cms'))
  const p = join(dir, `${cacheName}.csv`)
  const fresh = existsSync(p) && Date.now() - statSync(p).mtimeMs < config.cms.cacheDays * 86400000
  if (!fresh) {
    const res = await httpGet(url, { timeoutMs: 300000 })
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`)
    writeFileSync(p, res.text)
  }
  return parseCsv(readFileSync(p, 'utf8'))
}

/** The value of the first column whose header matches any pattern. */
export function col(row: Record<string, string>, ...patterns: RegExp[]): string {
  for (const re of patterns) {
    const k = Object.keys(row).find((h) => re.test(h))
    if (k !== undefined) return row[k] ?? ''
  }
  return ''
}

/** Finds a column header (for the source check to report what it matched). */
export function findHeader(headers: string[], ...patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const k = headers.find((h) => re.test(h))
    if (k) return k
  }
  return undefined
}

/** Provider Data Catalog metastore: dataset ID -> CSV download URL. */
export async function pdcCsvUrl(datasetId: string): Promise<{ url: string; modified?: string; title?: string }> {
  const res = await httpGet(`${config.cms.metastoreUrl}${datasetId}`, { timeoutMs: 30000 })
  if (!res.ok) throw new Error(`HTTP ${res.status} reading CMS metastore for ${datasetId}`)
  const j = JSON.parse(res.text) as { title?: string; modified?: string; distribution?: { downloadURL?: string; data?: { downloadURL?: string } }[] }
  const d = j.distribution?.[0]
  const url = d?.downloadURL ?? d?.data?.downloadURL
  if (!url) throw new Error(`No download URL in CMS metastore for ${datasetId}`)
  return { url, modified: j.modified, title: j.title }
}

interface CatalogDataset {
  title?: string
  modified?: string
  distribution?: { downloadURL?: string; accessURL?: string; mediaType?: string; format?: string; title?: string; modified?: string; temporal?: string }[]
}
let catalog: CatalogDataset[] | null = null

/** data.cms.gov catalog (data.json): dataset title -> newest CSV download URL. */
export async function catalogCsvUrl(title: string): Promise<{ url: string; label?: string }> {
  if (!catalog) {
    const res = await httpGet(config.cms.catalogUrl, { timeoutMs: 120000 })
    if (!res.ok) throw new Error(`HTTP ${res.status} reading ${config.cms.catalogUrl}`)
    catalog = (JSON.parse(res.text) as { dataset?: CatalogDataset[] }).dataset ?? []
  }
  // Each quarterly release is its own catalog entry, titled "<title> : YYYY-MM-DD". Take the newest.
  const want = title.toLowerCase()
  const matches = catalog.filter((d) => {
    const t = d.title?.toLowerCase() ?? ''
    return t === want || t.startsWith(`${want} :`)
  })
  if (!matches.length) throw new Error(`Dataset "${title}" not found in the data.cms.gov catalog`)
  const csvs = matches
    .flatMap((ds) => (ds.distribution ?? []).map((d) => ({ ...d, modified: d.modified ?? ds.modified, title: d.title ?? ds.title })))
    .filter((d) => d.downloadURL && (/csv/i.test(d.mediaType ?? '') || /\.csv(\?|$)/i.test(d.downloadURL)))
  csvs.sort((a, b) => String(b.modified ?? '').localeCompare(String(a.modified ?? '')))
  if (!csvs.length) throw new Error(`No CSV download for "${title}"`)
  return { url: csvs[0].downloadURL!, label: csvs[0].title }
}
