import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../config.js'
import { parseCsv } from '../core/csv.js'
import { normName, nameSimilarity } from '../core/normalize.js'

/**
 * Existing Rapid Results clients (data/do_not_contact.csv). Columns:
 * client_name_raw, brand, location_raw, city, state, entry_type, use_for_matching, match_rule,
 * segment_guess, source_list_date, date_added, notes.
 *
 * - Only rows with use_for_matching = yes.
 * - franchise_office rows match on brand + state (+ city when the row has one).
 * - named_business rows match on company name.
 * - Never match rows marked place_name_only or demo_or_test.
 * - Franchise rows with no state: flag possible matches, never auto-drop.
 */
export interface DncRow {
  client_name_raw: string; brand: string; location_raw: string; city: string; state: string
  entry_type: string; use_for_matching: string; match_rule: string; notes: string
}

export interface DncResult { action: 'drop' | 'flag' | 'none'; reason?: string }

export function loadDnc(file = join(DATA_DIR, 'do_not_contact.csv')): DncRow[] | null {
  if (!existsSync(file)) return null
  return parseCsv(readFileSync(file, 'utf8')) as unknown as DncRow[]
}

const NEVER = /place_name_only|demo_or_test/i
const usable = (r: DncRow) => /^y(es)?$/i.test(r.use_for_matching ?? '') && !NEVER.test(`${r.entry_type} ${r.match_rule}`)

export function checkDnc(
  rows: DncRow[],
  lead: { names: string[]; brand?: string; city?: string; state?: string },
): DncResult {
  const flags: string[] = []
  const leadCity = (lead.city ?? '').trim().toLowerCase()
  const leadState = (lead.state ?? '').trim().toUpperCase()
  for (const r of rows.filter(usable)) {
    const label = `${r.client_name_raw}${r.location_raw ? ` (${r.location_raw})` : ''}`
    if (/franchise_office/i.test(r.entry_type)) {
      if (!lead.brand || normName(lead.brand) !== normName(r.brand)) continue
      const rowState = (r.state ?? '').trim().toUpperCase()
      const rowCity = (r.city ?? '').trim().toLowerCase()
      if (!rowState) { flags.push(`Same brand as a client with no state on file: ${label}`); continue }
      if (rowState !== leadState) continue
      if (!rowCity || rowCity === leadCity) return { action: 'drop', reason: `Existing client: ${label}` }
      // Same brand and state, different city: a different office, so a valid prospect.
      continue
    }
    if (/named_business/i.test(r.entry_type)) {
      const target = r.client_name_raw || r.brand
      let best = 0
      for (const n of lead.names) {
        if (normName(n) && normName(n) === normName(target)) return { action: 'drop', reason: `Existing client: ${label}` }
        best = Math.max(best, nameSimilarity(n, target))
      }
      if (best >= 0.75) flags.push(`Name is close to existing client: ${label}`)
    }
  }
  return flags.length ? { action: 'flag', reason: flags.join('; ') } : { action: 'none' }
}
