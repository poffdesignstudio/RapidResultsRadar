import { formatDate } from '../core/dates.js'
import { parseCsv } from '../core/csv.js'
import { normPhone } from '../core/normalize.js'
import type { Lead } from '../leads/build.js'
import { COLUMNS, type Column } from '../leads/columns.js'
import { checkDnc } from '../match/doNotContact.js'
import { isSuppressed } from '../pipeline.js'
import { q, json } from './db.js'
import { loadDncRows, loadSuppressionSets } from './stores.js'

export type LeadRow = Record<Column, string>

/** Columns nobody edits: they identify the lead and where it came from. */
export const READ_ONLY: Column[] = ['lead_id', 'source', 'source_id', 'date_found']

/**
 * Saves leads found by a search. A lead found before keeps its first-seen date, and any column
 * someone edited by hand or that Leia's import changed is never overwritten. Other columns
 * take the new value when the search found one.
 */
export async function upsertLeads(items: { lead: Lead; row: Record<string, string> }[], searchId: number | null) {
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500)
    const ids = chunk.map((c) => c.lead.lead_id)
    const existing = new Map((await q<{ lead_id: string; data: LeadRow; first_seen: string }>('SELECT lead_id, data, first_seen FROM leads WHERE lead_id = ANY($1)', [ids])).map((r) => [r.lead_id, r]))
    const locked = new Set((await q<{ k: string }>('SELECT DISTINCT lead_id || \'|\' || col AS k FROM lead_changes WHERE lead_id = ANY($1)', [ids])).map((r) => r.k))
    const out = chunk.map(({ lead, row }) => {
      const old = existing.get(lead.lead_id)
      const firstSeen = old?.first_seen ?? formatDate()
      const data: Record<string, string> = {}
      for (const c of COLUMNS) {
        const was = old?.data[c] ?? ''
        const now = row[c] ?? ''
        if (locked.has(`${lead.lead_id}|${c}`)) data[c] = was
        else if (c === 'review_status') data[c] = was || now
        else data[c] = now !== '' ? now : was
      }
      data.lead_id = lead.lead_id
      data.date_found = firstSeen
      return { lead_id: lead.lead_id, data, provenance: { fields: lead.fields, sources: lead.records.map((r) => `${r.source}:${r.sourceId}`), site_pages: lead.site?.pages ?? [] }, first_seen: firstSeen }
    })
    await q(`INSERT INTO leads (lead_id, data, provenance, first_seen, last_search_id)
             SELECT x.lead_id, x.data, x.provenance, x.first_seen, $2 FROM jsonb_to_recordset($1) AS x(lead_id text, data jsonb, provenance jsonb, first_seen text)
             ON CONFLICT (lead_id) DO UPDATE SET data=EXCLUDED.data, provenance=EXCLUDED.provenance, last_search_id=COALESCE(EXCLUDED.last_search_id, leads.last_search_id), updated_at=now()`,
      [json(out), searchId])
  }
}

export async function leadsForSearch(searchId: number): Promise<LeadRow[]> {
  const rows = await q<{ data: LeadRow }>(
    `SELECT l.data FROM search_leads s JOIN leads l ON l.lead_id = s.lead_id WHERE s.search_id=$1 AND s.excluded IS NULL
     ORDER BY (l.data->>'confidence')::int DESC NULLS LAST, l.data->>'company_name'`, [searchId])
  return rows.map((r) => r.data)
}

export async function leftOutForSearch(searchId: number): Promise<{ lead_id: string; company_name: string; city: string; reason: string }[]> {
  return q(`SELECT lead_id, lead->'fields'->'company_name'->>'value' AS company_name, lead->'fields'->'city'->>'value' AS city, excluded AS reason
            FROM search_leads WHERE search_id=$1 AND excluded IS NOT NULL ORDER BY excluded, 2`, [searchId])
}

export async function allLeads(): Promise<LeadRow[]> {
  const rows = await q<{ data: LeadRow }>(`SELECT data FROM leads ORDER BY updated_at DESC LIMIT 10000`)
  return rows.map((r) => r.data)
}

/** One inline edit from the results table. The column is then locked against later searches. */
export async function updateLeadCell(leadId: string, col: string, value: string, source = 'manual') {
  if (!(COLUMNS as readonly string[]).includes(col) || READ_ONLY.includes(col as Column)) throw new Error(`Column "${col}" cannot be edited`)
  const old = (await q<{ v: string }>('SELECT data->>$2 AS v FROM leads WHERE lead_id=$1', [leadId, col]))[0]
  if (!old) throw new Error(`Lead ${leadId} not found`)
  if ((old.v ?? '') === value) return
  await q('UPDATE leads SET data = jsonb_set(data, ARRAY[$2::text], to_jsonb($3::text)), updated_at=now() WHERE lead_id=$1', [leadId, col, value])
  await q('INSERT INTO lead_changes (lead_id, col, old_value, new_value, source) VALUES ($1,$2,$3,$4,$5)', [leadId, col, old.v ?? '', value, source])
}

export interface ImportSummary {
  rows: number
  matched: number
  unknown: string[]
  changed: Record<string, number>
  cellsChanged: number
}

/**
 * Leia's returned CSV, merged on lead_id. Only cells she filled in and that differ from what we
 * have are changed; blank cells never erase anything. Every change is logged.
 */
export async function importLeiaCsv(text: string, fileName: string): Promise<ImportSummary> {
  const rows = parseCsv(text)
  if (!rows.length) throw new Error('The file has no rows')
  if (!('lead_id' in rows[0])) throw new Error('The file has no lead_id column, so rows cannot be matched to leads')
  const cols = Object.keys(rows[0]).filter((c) => (COLUMNS as readonly string[]).includes(c) && !READ_ONLY.includes(c as Column))
  const ids = rows.map((r) => r.lead_id).filter(Boolean)
  const existing = new Map((await q<{ lead_id: string; data: LeadRow }>('SELECT lead_id, data FROM leads WHERE lead_id = ANY($1)', [ids])).map((r) => [r.lead_id, r.data]))
  const summary: ImportSummary = { rows: rows.length, matched: 0, unknown: [], changed: {}, cellsChanged: 0 }
  for (const r of rows) {
    const old = existing.get(r.lead_id)
    if (!old) { if (r.lead_id) summary.unknown.push(r.lead_id); continue }
    summary.matched++
    const patch: Record<string, string> = {}
    for (const c of cols) {
      const v = (r[c] ?? '').trim()
      if (v !== '' && v !== (old[c as Column] ?? '')) patch[c] = v
    }
    if (!Object.keys(patch).length) continue
    await q('UPDATE leads SET data = data || $2, updated_at=now() WHERE lead_id=$1', [r.lead_id, json(patch)])
    for (const [c, v] of Object.entries(patch)) {
      await q('INSERT INTO lead_changes (lead_id, col, old_value, new_value, source) VALUES ($1,$2,$3,$4,$5)', [r.lead_id, c, old[c as Column] ?? '', v, `import:${fileName}`])
      summary.changed[c] = (summary.changed[c] ?? 0) + 1
      summary.cellsChanged++
    }
  }
  return summary
}

/**
 * Rows for a CSV export. Leads on either do-not-contact list (existing clients or the
 * suppression list, matched on name, email, domain or phone), and leads marked "drop",
 * are left out; the lists are checked again at export time in case they changed.
 */
export async function exportable(rows: LeadRow[]): Promise<{ rows: LeadRow[]; skipped: { lead_id: string; reason: string }[] }> {
  const dnc = await loadDncRows()
  const sup = await loadSuppressionSets()
  const keep: LeadRow[] = []
  const skipped: { lead_id: string; reason: string }[] = []
  for (const r of rows) {
    if (r.review_status === 'drop') { skipped.push({ lead_id: r.lead_id, reason: 'Marked drop' }); continue }
    if (isSuppressed(sup, r.contact_email, r.domain)) { skipped.push({ lead_id: r.lead_id, reason: 'On the suppression list' }); continue }
    const phone = normPhone(r.phone)
    if (phone && sup.phones?.has(phone)) { skipped.push({ lead_id: r.lead_id, reason: 'On the suppression list' }); continue }
    const d = dnc ? checkDnc(dnc, { names: [r.company_name], brand: r.franchise_brand || undefined, city: r.city, state: r.state }) : { action: 'none' as const }
    if (d.action === 'drop') { skipped.push({ lead_id: r.lead_id, reason: d.reason! }); continue }
    if (sup.names?.length) {
      const s = checkDnc(sup.names, { names: [r.company_name], brand: r.franchise_brand || undefined, city: r.city, state: r.state })
      if (s.action === 'drop') { skipped.push({ lead_id: r.lead_id, reason: 'On the suppression list' }); continue }
    }
    keep.push(r)
  }
  return { rows: keep, skipped }
}
