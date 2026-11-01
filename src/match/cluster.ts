import { nameSimilarity, normPhone, streetKey, domainFromUrl, isOwnWebsite } from '../core/normalize.js'
import type { SourceRecord } from '../core/types.js'

export interface Cluster {
  records: SourceRecord[]
  /** Other clusters that look like the same business but did not meet the bar to merge. */
  possibleDuplicates: number[]
}

/** Website key: the domain, or domain plus path for a shared chain site (one site, many offices). */
export function siteKey(url: string | undefined, sharedDomains: Set<string>): string {
  if (!url || !isOwnWebsite(url)) return ''
  const d = domainFromUrl(url)
  if (!sharedDomains.has(d)) return d
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '').toLowerCase()
    return path ? d + path : ''
  } catch { return '' }
}

function bestNameSim(a: SourceRecord, b: SourceRecord): number {
  let best = 0
  for (const x of [a.name, ...(a.altNames ?? [])]) for (const y of [b.name, ...(b.altNames ?? [])]) best = Math.max(best, nameSimilarity(x, y))
  return best
}

export type MatchVerdict = 'same' | 'maybe' | 'different'

/** Decides whether two source records describe the same business. */
export function compare(a: SourceRecord, b: SourceRecord, sharedDomains: Set<string>): MatchVerdict {
  if (a.ids?.ccn && a.ids.ccn === b.ids?.ccn) return 'same'
  if (a.ids?.npi && a.ids.npi === b.ids?.npi) return 'same'
  const sim = bestNameSim(a, b)
  const sameZip = !!a.zip && a.zip === b.zip
  const sameStreet = !!streetKey(a.address) && streetKey(a.address) === streetKey(b.address)
  const pa = normPhone(a.phone)
  const samePhone = !!pa && pa === normPhone(b.phone)
  const sk = siteKey(a.website, sharedDomains)
  const sameSite = !!sk && sk === siteKey(b.website, sharedDomains)
  if (samePhone && (sim >= 0.4 || sameStreet)) return 'same'
  if (sameSite && (sim >= 0.4 || sameStreet || samePhone)) return 'same'
  if (sameZip && sameStreet && sim >= 0.5) return 'same'
  if (sameZip && sim >= 0.85) return 'same'
  if (sameStreet && sim >= 0.85) return 'same'
  if (samePhone || sameSite) return 'maybe'
  // Different phone and different street: a different office, even with a similar name.
  const pb = normPhone(b.phone)
  const sa = streetKey(a.address), sb = streetKey(b.address)
  if (pa && pb && pa !== pb && sa && sb && sa !== sb) return 'different'
  const sameCity = !!a.city && a.city.toLowerCase() === b.city?.toLowerCase()
  if (sameStreet && sim >= 0.4) return 'maybe'
  if (sameZip && sim >= 0.7) return 'maybe'
  if (sameCity && sim >= 0.9) return 'maybe'
  return 'different'
}

/** Groups records into businesses. Only pairs that share a phone, website, ZIP, street or CCN are compared. */
export function clusterRecords(records: SourceRecord[], sharedDomains: Set<string>): Cluster[] {
  const parent = records.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const blocks = new Map<string, number[]>()
  const add = (k: string, i: number) => { if (k) (blocks.get(k) ?? blocks.set(k, []).get(k)!).push(i) }
  records.forEach((r, i) => {
    add(`p:${normPhone(r.phone)}`.replace(/^p:$/, ''), i)
    add(`w:${siteKey(r.website, sharedDomains)}`.replace(/^w:$/, ''), i)
    add(r.zip ? `z:${r.zip}` : '', i)
    add(r.ids?.ccn ? `c:${r.ids.ccn}` : '', i)
    add(r.ids?.npi ? `n:${r.ids.npi}` : '', i)
    add(r.city ? `t:${r.city.toLowerCase()}|${r.state ?? ''}` : '', i)
  })
  const maybes: [number, number][] = []
  const done = new Set<string>()
  for (const idx of blocks.values()) {
    for (let x = 0; x < idx.length; x++) {
      for (let y = x + 1; y < idx.length; y++) {
        const i = idx[x], j = idx[y]
        const k = i < j ? `${i},${j}` : `${j},${i}`
        if (done.has(k)) continue
        done.add(k)
        const v = compare(records[i], records[j], sharedDomains)
        if (v === 'same') parent[find(i)] = find(j)
        else if (v === 'maybe') maybes.push([i, j])
      }
    }
  }
  const byRoot = new Map<number, number>()
  const clusters: Cluster[] = []
  records.forEach((r, i) => {
    const root = find(i)
    if (!byRoot.has(root)) { byRoot.set(root, clusters.length); clusters.push({ records: [], possibleDuplicates: [] }) }
    clusters[byRoot.get(root)!].records.push(r)
  })
  for (const [i, j] of maybes) {
    const ci = byRoot.get(find(i))!, cj = byRoot.get(find(j))!
    if (ci === cj) continue
    if (!clusters[ci].possibleDuplicates.includes(cj)) clusters[ci].possibleDuplicates.push(cj)
    if (!clusters[cj].possibleDuplicates.includes(ci)) clusters[cj].possibleDuplicates.push(ci)
  }
  return clusters
}
