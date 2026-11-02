import { config } from '../config.js'
import { formatDate } from '../core/dates.js'
import type { RunContext, SourceRecord } from '../core/types.js'
import { resolveArea } from '../geo/area.js'
import { resolveNiche } from '../niches.js'
import { CallCounter } from '../budget/usage.js'
import { baseRow, type Lead } from '../leads/build.js'
import { COLUMNS } from '../leads/columns.js'
import { buildReport, googleReportLines } from '../export/report.js'
import {
  runSource, matchLeads, crawlLeads, checkMailServers, finalizeLeads, needsCrawl, areaToJson, areaFromJson, SOURCE_LABELS, type SourceKey,
} from '../pipeline.js'
import { q, q1, json } from './db.js'
import { dbUsage, dbLedger, dbCrawlCache, getSourceSettings, loadDncRows, loadSuppressionSets } from './stores.js'
import { upsertLeads } from './leads.js'

export interface SearchParams {
  niche: string
  city?: string
  state?: string
  zip?: string
  radius: number
  sources: Record<SourceKey | 'crawler', boolean>
  profile?: string
}

interface JobState {
  area?: ReturnType<typeof areaToJson>
  notes?: string[]
  google?: { runCalls: number; stoppedAtCap: string | null; monthBefore: number; monthAfter: number; maxPerRun: number; maxPerMonth: number; used: boolean }
  crawl?: { total: number; done: number }
  counts?: { kept: number; excluded: number }
}

export interface SearchRow {
  id: number
  created_at: string
  params: SearchParams
  status: 'queued' | 'running' | 'done' | 'failed'
  phase: string
  state: JobState
  log: string[]
  report: string | null
  error: string | null
}

const SOURCE_ORDER: SourceKey[] = ['google', 'overture', 'nppes', 'cms']
const CRAWL_BATCH = 12

export async function createSearch(params: SearchParams): Promise<number> {
  const row = await q1<{ id: number }>('INSERT INTO searches (params) VALUES ($1) RETURNING id', [json(params)])
  return row!.id
}

/** A short description of where a search is, for the progress bar. */
export function progressOf(s: SearchRow): { pct: number; label: string } {
  const steps = ['start', ...SOURCE_ORDER.map((k) => `source:${k}`), 'match', 'crawl', 'finalize', 'done']
  const i = Math.max(0, steps.indexOf(s.phase))
  let pct = (i / (steps.length - 1)) * 100
  let label = s.phase
  if (s.phase.startsWith('source:')) label = `Searching ${SOURCE_LABELS[s.phase.slice(7) as SourceKey]}`
  if (s.phase === 'start') label = 'Finding the search area'
  if (s.phase === 'match') label = 'Matching businesses across sources'
  if (s.phase === 'crawl') {
    const c = s.state.crawl
    label = c ? `Crawling websites: ${c.done} of ${c.total}` : 'Crawling websites'
    if (c?.total) pct = ((steps.indexOf('crawl') + c.done / c.total) / (steps.length - 1)) * 100
  }
  if (s.phase === 'finalize') label = 'Choosing contacts and emails, applying lists'
  if (s.phase === 'done') label = 'Done'
  return { pct: Math.round(pct), label }
}

/**
 * Runs the next step of a search and saves progress. Only one step runs at a time per search;
 * a second caller gets the search back unchanged.
 */
export async function stepSearch(id: number): Promise<SearchRow> {
  const s = await q1<SearchRow>(
    `UPDATE searches SET locked_until = now() + interval '5 minutes', status = CASE WHEN status='queued' THEN 'running' ELSE status END
     WHERE id=$1 AND status IN ('queued','running') AND (locked_until IS NULL OR locked_until < now()) RETURNING *`, [id])
  if (!s) return (await q1<SearchRow>('SELECT * FROM searches WHERE id=$1', [id]))!
  const log: string[] = [...s.log]
  const say = (m: string) => log.push(`${new Date().toISOString().slice(11, 19)} ${m}`)
  const state: JobState = { ...s.state }
  let phase = s.phase
  let status: SearchRow['status'] = 'running'
  let report: string | null = s.report
  let error: string | null = null
  try {
    const niche = resolveNiche(s.params.niche)
    if (phase === 'start') {
      const area = await resolveArea({ city: s.params.city || undefined, state: s.params.state || undefined, zip: s.params.zip || undefined, radiusMiles: Number(s.params.radius) }, say)
      state.area = areaToJson(area)
      state.notes = []
      say(`Searching "${niche.label}" within ${area.radiusMiles} miles of ${area.label}: ${area.zips.size} ZIP codes, ${area.places.length} towns, states ${[...area.states].join(', ')}`)
      phase = nextSourcePhase(s.params, -1)
    } else if (phase.startsWith('source:')) {
      const key = phase.slice(7) as SourceKey
      const ctx: RunContext = { niche, area: areaFromJson(state.area!), log: say }
      let google = null
      let counter: CallCounter | null = null
      if (key === 'google') {
        const g = (await getSourceSettings()).find((x) => x.source === 'google')!
        counter = new CallCounter('google', g.max_per_run, g.max_per_month, dbUsage)
        const monthBefore = await counter.monthCalls()
        const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim() || ''
        if (!g.enabled) say('Google Places: turned off on the Sources page, skipped')
        google = g.enabled && apiKey ? { apiKey, counter } : null
        state.google = { runCalls: 0, stoppedAtCap: null, monthBefore, monthAfter: monthBefore, maxPerRun: g.max_per_run, maxPerMonth: g.max_per_month, used: !!google }
      }
      const run = key === 'google' && !google
        ? { records: [] as SourceRecord[], note: process.env.GOOGLE_PLACES_API_KEY ? 'Google Places: turned off on the Sources page' : 'Google Places: skipped, GOOGLE_PLACES_API_KEY is not set in Vercel' }
        : await runSource(key, ctx, google)
      if (counter && state.google) Object.assign(state.google, { runCalls: counter.runCalls, stoppedAtCap: counter.stoppedAtCap, monthAfter: await counter.monthCalls() })
      await q('INSERT INTO search_records (search_id, source, records) VALUES ($1,$2,$3) ON CONFLICT (search_id, source) DO UPDATE SET records=EXCLUDED.records', [id, key, json(run.records)])
      state.notes = [...(state.notes ?? []).filter((n) => !n.startsWith(SOURCE_LABELS[key].split(' ')[0])), run.note]
      say(run.note)
      phase = nextSourcePhase(s.params, SOURCE_ORDER.indexOf(key))
    } else if (phase === 'match') {
      const recs = (await q<{ records: SourceRecord[] }>('SELECT records FROM search_records WHERE search_id=$1', [id])).flatMap((r) => r.records)
      const ctx: RunContext = { niche, area: areaFromJson(state.area!), log: say }
      const leads = dedupeById(await matchLeads(recs, ctx, dbLedger), say)
      const crawlOn = s.params.sources.crawler && (await getSourceSettings()).find((x) => x.source === 'crawler')!.enabled
      await q('DELETE FROM search_leads WHERE search_id=$1', [id])
      await saveSearchLeads(id, leads, (l) => crawlOn && needsCrawl(l), true)
      // Show the businesses right away; contacts fill in after the crawl.
      await upsertLeads(leads.filter((l) => !l.excluded).map((l) => ({ lead: l, row: baseRow(l) })), id)
      state.crawl = { total: crawlOn ? leads.filter(needsCrawl).length : 0, done: 0 }
      say(crawlOn ? `Crawling ${state.crawl.total} websites, ${CRAWL_BATCH} at a time` : 'Website crawl turned off for this search')
      phase = 'crawl'
    } else if (phase === 'crawl') {
      const batch = await q<{ lead: Lead }>('SELECT lead FROM search_leads WHERE search_id=$1 AND needs_crawl ORDER BY lead_id LIMIT $2', [id, CRAWL_BATCH])
      if (batch.length) {
        const leads = batch.map((b) => b.lead)
        await crawlLeads(leads, dbCrawlCache)
        await saveSearchLeads(id, leads, () => false)
        state.crawl = { total: state.crawl?.total ?? 0, done: (state.crawl?.done ?? 0) + leads.length }
      }
      const left = await q1<{ n: number }>('SELECT count(*)::int AS n FROM search_leads WHERE search_id=$1 AND needs_crawl', [id])
      if (!left?.n) { say(`Website crawl finished (${state.crawl?.done ?? 0} sites)`); phase = 'finalize' }
    } else if (phase === 'finalize') {
      const leads = (await q<{ lead: Lead }>('SELECT lead FROM search_leads WHERE search_id=$1', [id])).map((r) => r.lead)
      const area = areaFromJson(state.area!)
      const mxWorks = await checkMailServers(leads.filter((l) => !l.excluded))
      const { dncLine } = finalizeLeads(leads, area, await loadDncRows(), await loadSuppressionSets())
      await saveSearchLeads(id, leads, () => false)
      const kept = leads.filter((l) => !l.excluded).sort((a, b) => b.score - a.score)
      const excluded = leads.filter((l) => l.excluded)
      await upsertLeads(kept.map((l) => ({ lead: l, row: baseRow(l) })), id)
      state.counts = { kept: kept.length, excluded: excluded.length }
      const g = state.google
      report = buildReport({
        header: [
          `LEAD DIGGER REPORT - ${formatDate()}   (search #${id})`,
          `Niche: ${niche.label}   Area: ${area.radiusMiles} miles around ${area.label}   States: ${[...area.states].join(', ')}`,
        ],
        leads: kept,
        excluded,
        sourceLines: [
          ...(state.notes ?? []),
          `Websites crawled: ${state.crawl?.done ?? 0}${s.params.sources.crawler ? '' : ' (crawl turned off)'}`,
          `Mail-server (MX) check: ${mxWorks ? 'done' : 'skipped'}`,
        ],
        googleLines: g ? googleReportLines({ runCalls: g.runCalls, maxPerRun: g.maxPerRun, maxPerMonth: g.maxPerMonth, stoppedAtCap: g.stoppedAtCap }, g.monthBefore, g.monthAfter, g.used) : googleReportLines({ runCalls: 0, maxPerRun: 0, maxPerMonth: 0, stoppedAtCap: null }, 0, 0, false),
        dncLine,
      })
      say(`Done: ${kept.length} leads, ${excluded.length} left out`)
      phase = 'done'
      status = 'done'
    }
  } catch (e) {
    error = (e as Error).message
    status = 'failed'
    say(`FAILED during "${phase}": ${error}`)
  }
  const saved = await q1<SearchRow>(
    `UPDATE searches SET phase=$2, status=$3, state=$4, log=$5, report=$6, error=$7, locked_until=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, phase, status, json(state), json(log.slice(-300)), report, error])
  return saved!
}

/** A failed search can be resumed from the step that failed. */
export async function retrySearch(id: number) {
  await q(`UPDATE searches SET status='running', error=NULL, locked_until=NULL WHERE id=$1 AND status='failed'`, [id])
}

function nextSourcePhase(p: SearchParams, after: number): string {
  for (let i = after + 1; i < SOURCE_ORDER.length; i++) if (p.sources[SOURCE_ORDER[i]]) return `source:${SOURCE_ORDER[i]}`
  return 'match'
}

/** Two groups of records can map to one lead ID when they share a key; keep the first. */
function dedupeById(leads: Lead[], say: (m: string) => void): Lead[] {
  const seen = new Set<string>()
  const out = leads.filter((l) => (seen.has(l.lead_id) ? false : (seen.add(l.lead_id), true)))
  if (out.length < leads.length) say(`${leads.length - out.length} duplicate businesses merged by lead ID`)
  return out
}

async function saveSearchLeads(id: number, leads: Lead[], crawl: (l: Lead) => boolean, insert = false) {
  for (let i = 0; i < leads.length; i += 500) {
    const chunk = leads.slice(i, i + 500).map((l) => ({ lead_id: l.lead_id, lead: l, needs_crawl: crawl(l), excluded: l.excluded ?? null }))
    if (insert) {
      await q(`INSERT INTO search_leads (search_id, lead_id, lead, needs_crawl, excluded)
               SELECT $1, x.lead_id, x.lead, x.needs_crawl, x.excluded FROM jsonb_to_recordset($2) AS x(lead_id text, lead jsonb, needs_crawl boolean, excluded text)
               ON CONFLICT (search_id, lead_id) DO NOTHING`, [id, json(chunk)])
    } else {
      await q(`UPDATE search_leads s SET lead=x.lead, needs_crawl=x.needs_crawl, excluded=x.excluded
               FROM jsonb_to_recordset($2) AS x(lead_id text, lead jsonb, needs_crawl boolean, excluded text)
               WHERE s.search_id=$1 AND s.lead_id=x.lead_id`, [id, json(chunk)])
    }
  }
}

export const DEFAULT_SOURCES: SearchParams['sources'] = { google: true, overture: true, nppes: true, cms: true, crawler: config.crawler.enabled }
export { COLUMNS }
