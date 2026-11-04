import { config } from '../config.js'
import { formatDate, monthKey } from '../core/dates.js'
import type { UsageStore } from '../budget/usage.js'
import type { LeadLedger } from '../leads/ledger.js'
import { newLeadId } from '../leads/ledger.js'
import type { CrawlCache, SiteResult } from '../enrich/crawler.js'
import type { DncRow } from '../match/doNotContact.js'
import { entryToDncRow, type ListEntry } from '../match/listEntries.js'
import type { Suppression } from '../pipeline.js'
import { q, q1, json } from './db.js'

/** Monthly call counts per paid source, in provider_usage. */
export const dbUsage: UsageStore = {
  async get(source, month) {
    return (await q1<{ calls: number }>('SELECT calls FROM provider_usage WHERE month=$1 AND source=$2', [month, source]))?.calls ?? 0
  },
  async add(source, month) {
    await q('INSERT INTO provider_usage (month, source, calls) VALUES ($1,$2,1) ON CONFLICT (month, source) DO UPDATE SET calls = provider_usage.calls + 1', [month, source])
  },
}

/** Permanent lead IDs, in lead_keys. A business keeps its ID if any of its keys was seen before. */
export const dbLedger: LeadLedger = {
  async idFor(keys) {
    const clean = [...new Set(keys.filter(Boolean))]
    if (!clean.length) return newLeadId()
    const hit = await q1<{ lead_id: string }>('SELECT lead_id FROM lead_keys WHERE key = ANY($1) ORDER BY array_position($1, key) LIMIT 1', [clean])
    let id = hit?.lead_id
    while (!id) {
      const candidate = newLeadId()
      const taken = await q1('SELECT 1 FROM lead_keys WHERE lead_id=$1 UNION SELECT 1 FROM leads WHERE lead_id=$1', [candidate])
      if (!taken) id = candidate
    }
    await q('INSERT INTO lead_keys (key, lead_id) SELECT unnest($1::text[]), $2 ON CONFLICT (key) DO NOTHING', [clean, id])
    return id
  },
  async firstSeen(id) {
    return (await q1<{ first_seen: string }>('SELECT first_seen FROM leads WHERE lead_id=$1', [id]))?.first_seen ?? formatDate()
  },
}

export const dbCrawlCache: CrawlCache = {
  async get(key) {
    return (await q1<{ result: SiteResult }>('SELECT result FROM crawl_cache WHERE key=$1', [key]))?.result ?? null
  },
  async set(key, result) {
    await q('INSERT INTO crawl_cache (key, result, crawled_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET result=EXCLUDED.result, crawled_at=now()', [key, json(result)])
  },
}

/** Every source with its on/off flag. Paid sources also have call caps and a monthly counter. */
export interface SourceSetting {
  source: string
  label: string
  paid: boolean
  built: boolean
  enabled: boolean
  max_per_run: number
  max_per_month: number
  calls_this_month: number
  cost_per_1000: number
  free_per_month: number
  note: string
}

const SOURCES: Omit<SourceSetting, 'enabled' | 'max_per_run' | 'max_per_month' | 'calls_this_month'>[] = [
  { source: 'google', label: 'Google Places (Text Search, basic fields)', paid: true, built: true, cost_per_1000: config.google.costPer1000, free_per_month: config.google.freeCallsPerMonth, note: config.google.skuNote },
  { source: 'serper', label: 'Website search API (Serper or similar)', paid: true, built: false, cost_per_1000: 0, free_per_month: 0, note: 'Stage 3. Not built yet.' },
  { source: 'email_verifier', label: 'Email verifier', paid: true, built: false, cost_per_1000: 0, free_per_month: 0, note: 'Stage 4. Not built.' },
  { source: 'email_finder', label: 'Email finder', paid: true, built: false, cost_per_1000: 0, free_per_month: 0, note: 'Stage 4. Not built.' },
  { source: 'overture', label: 'Overture Maps places', paid: false, built: true, cost_per_1000: 0, free_per_month: 0, note: 'Free open data.' },
  { source: 'nppes', label: 'NPPES NPI Registry', paid: false, built: true, cost_per_1000: 0, free_per_month: 0, note: 'Free. Home care and home health searches only.' },
  { source: 'cms', label: 'CMS home health agencies and owners', paid: false, built: true, cost_per_1000: 0, free_per_month: 0, note: 'Free. Home care and home health searches only.' },
  { source: 'crawler', label: 'Business website crawl', paid: false, built: true, cost_per_1000: 0, free_per_month: 0, note: 'Free. Up to 5 pages per site, robots.txt respected.' },
]

export async function getSourceSettings(): Promise<SourceSetting[]> {
  for (const s of SOURCES) {
    const on = s.source === 'google' ? config.paidSources.google.enabled : s.built && !s.paid
    const run = s.source === 'google' ? config.google.maxCallsPerRun : 0
    const month = s.source === 'google' ? config.google.maxCallsPerMonth : 0
    await q('INSERT INTO provider_settings (source, enabled, max_per_run, max_per_month) VALUES ($1,$2,$3,$4) ON CONFLICT (source) DO NOTHING', [s.source, on, run, month])
  }
  const rows = await q<{ source: string; enabled: boolean; max_per_run: number; max_per_month: number }>('SELECT * FROM provider_settings')
  const usage = await q<{ source: string; calls: number }>('SELECT source, calls FROM provider_usage WHERE month=$1', [monthKey()])
  return SOURCES.map((s) => {
    const r = rows.find((x) => x.source === s.source)!
    return { ...s, enabled: s.built && r.enabled, max_per_run: r.max_per_run, max_per_month: r.max_per_month, calls_this_month: usage.find((u) => u.source === s.source)?.calls ?? 0 }
  })
}

const LIST_COLS = 'kind, name, brand, address, city, state, email, phone, entry_type, use_for_matching, match_rule'

/** The existing-clients list as checkDnc rows; null when the list is empty. */
export async function loadDncRows(): Promise<DncRow[] | null> {
  const rows = await q<ListEntry>(`SELECT ${LIST_COLS} FROM list_entries WHERE kind='client' ORDER BY id`)
  return rows.length ? rows.map(entryToDncRow) : null
}

/**
 * The screening sets for BOTH lists: emails, blocked domains and phones are gathered
 * from every entry (an existing client's email or phone screens a lead out just like
 * a suppression entry's does), and suppression entries that carry a business name
 * also come back as checkDnc rows, so a suppressed business matches by name too.
 */
export async function loadSuppressionSets(): Promise<Suppression> {
  const rows = await q<ListEntry>(`SELECT ${LIST_COLS} FROM list_entries ORDER BY id`)
  const emails = new Set<string>()
  const domains = new Set<string>()
  const phones = new Set<string>()
  const names: DncRow[] = []
  for (const r of rows) {
    if (r.email) (r.email.startsWith('@') ? domains.add(r.email.slice(1)) : emails.add(r.email))
    if (r.phone) phones.add(r.phone)
    if (r.kind === 'suppression' && r.name) names.push(entryToDncRow(r))
  }
  return { emails, domains, phones, names, entries: rows.length }
}
