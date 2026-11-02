import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { config, OUTPUT_DIR, ensureDir, googleApiKey } from './config.js'
import { formatDate } from './core/dates.js'
import { toCsv } from './core/csv.js'
import type { RunContext, SourceRecord } from './core/types.js'
import { resolveArea } from './geo/area.js'
import { resolveNiche } from './niches.js'
import { CallCounter } from './budget/usage.js'
import { loadDnc } from './match/doNotContact.js'
import { loadSuppression } from './match/suppression.js'
import { Ledger } from './leads/ledger.js'
import { baseRow } from './leads/build.js'
import { COLUMNS } from './leads/columns.js'
import { buildReport, googleReportLines } from './export/report.js'
import { runSource, matchLeads, crawlLeads, checkMailServers, finalizeLeads, needsCrawl, type SourceKey } from './pipeline.js'

const HELP = `
Lead Digger, Stage 1 (command line)

  npm run dig -- --niche "home care" --city Charlotte --state NC --radius 30
  npm run dig -- --niche "home care" --zip 28202 --radius 30

Options
  --niche        Niche text. "home care" and "home health" both run the home care and home health preset.
  --city/--state City and two-letter state, or use --zip, or --lat and --lng.
  --radius       Miles (default 25).
  --no-google    Skip Google Places (free sources only).
  --no-crawl     Skip the website crawl.
  --max-google   Google calls allowed in this run (default ${config.google.maxCallsPerRun}; the monthly cap of ${config.google.maxCallsPerMonth} always applies).
  --max-sites    Crawl at most this many websites (for a quick test).
`

async function main() {
  const { values: a } = parseArgs({
    options: {
      niche: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, zip: { type: 'string' },
      radius: { type: 'string', default: '25' }, lat: { type: 'string' }, lng: { type: 'string' },
      'no-google': { type: 'boolean' }, 'no-crawl': { type: 'boolean' }, 'max-google': { type: 'string' },
      'max-sites': { type: 'string' }, help: { type: 'boolean' },
    },
  })
  if (a.help || !a.niche) { console.log(HELP); process.exit(a.help ? 0 : 1) }
  const started = Date.now()
  const log = (m: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${m}`)
  const today = formatDate()

  const niche = resolveNiche(a.niche)
  const area = await resolveArea({
    city: a.city, state: a.state, zip: a.zip, radiusMiles: Number(a.radius),
    lat: a.lat ? Number(a.lat) : undefined, lng: a.lng ? Number(a.lng) : undefined,
  }, log)
  log(`Searching "${niche.label}" within ${area.radiusMiles} miles of ${area.label}: ${area.zips.size} ZIP codes, ${area.places.length} towns, states ${[...area.states].join(', ')}`)

  const counter = new CallCounter('google', a['max-google'] ? Number(a['max-google']) : config.google.maxCallsPerRun, config.google.maxCallsPerMonth)
  const monthBefore = await counter.monthCalls()
  const useGoogle = !a['no-google'] && config.paidSources.google.enabled
  const google = useGoogle && googleApiKey() ? { apiKey: googleApiKey(), counter } : null

  const ctx: RunContext = { niche, area, log }
  const keys: SourceKey[] = ['google', 'overture', 'nppes', 'cms']
  const runs = await Promise.all(keys.map((k) => (k === 'google' && !useGoogle ? Promise.resolve({ records: [] as SourceRecord[], note: 'Google Places: skipped' }) : runSource(k, ctx, google))))
  const records = runs.flatMap((r) => r.records)

  const ledger = new Ledger()
  const leads = await matchLeads(records, ctx, ledger)
  ledger.save()

  const toCrawl = leads.filter(needsCrawl).slice(0, a['max-sites'] ? Number(a['max-sites']) : undefined)
  if (!a['no-crawl'] && config.crawler.enabled) {
    log(`Crawling ${toCrawl.length} websites (up to ${config.crawler.maxPagesPerSite} pages each, robots.txt respected)...`)
    for (let i = 0; i < toCrawl.length; i += 25) {
      await crawlLeads(toCrawl.slice(i, i + 25))
      log(`  crawled ${Math.min(i + 25, toCrawl.length)}/${toCrawl.length}`)
    }
  }
  const mxWorks = await checkMailServers(leads)
  if (!mxWorks) log('MX check: skipped (turned off, or DNS lookups not working on this network)')
  const { dncLine } = finalizeLeads(leads, area, loadDnc(), loadSuppression())

  const kept = leads.filter((l) => !l.excluded).sort((x, y) => y.score - x.score)
  const excluded = leads.filter((l) => l.excluded)

  const out = ensureDir(OUTPUT_DIR)
  const slug = `${(a.zip ?? `${a.city ?? 'area'}_${a.state ?? ''}`).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${niche.key}_${today}`
  const rowOf = async (l: (typeof leads)[number]) => baseRow(l, await ledger.firstSeen(l.lead_id))
  const csvPath = join(out, `leads_${slug}.csv`)
  writeFileSync(csvPath, toCsv(COLUMNS, await Promise.all(kept.map(rowOf))))
  writeFileSync(join(out, `review_left_out_${slug}.csv`), toCsv(['reason', ...COLUMNS], await Promise.all(excluded.map(async (l) => ({ reason: l.excluded, ...(await rowOf(l)) })))))
  writeFileSync(join(out, `provenance_${slug}.json`), JSON.stringify(Object.fromEntries(leads.map((l) => [l.lead_id, { fields: l.fields, sources: l.records.map((r) => `${r.source}:${r.sourceId}`), site_pages: l.site?.pages, excluded: l.excluded }])), null, 2))
  const sample = [...kept].sort(() => Math.random() - 0.5).slice(0, 10)
  writeFileSync(join(out, `spotcheck_${slug}.csv`), toCsv(['lead_id', 'company_name', 'website', 'contact_name', 'contact_name_source', 'contact_title', 'contact_email', 'email_status', 'email_source', 'pages_crawled', 'flags'], sample.map((l) => ({
    lead_id: l.lead_id, company_name: l.fields.company_name?.value, website: l.fields.website?.value,
    contact_name: l.fields.contact_name?.value, contact_name_source: l.fields.contact_name?.source, contact_title: l.fields.contact_title?.value,
    contact_email: l.fields.contact_email?.value, email_status: l.fields.email_status?.value, email_source: l.fields.contact_email?.source,
    pages_crawled: l.site?.pages.map((p) => `${p.kind} ${p.status} ${p.url}`).join(' | '), flags: l.flags.join('; '),
  }))))

  const report = buildReport({
    header: [
      `LEAD DIGGER REPORT - ${today}`,
      `Niche: ${niche.label}   Area: ${area.radiusMiles} miles around ${area.label}   States: ${[...area.states].join(', ')}`,
      `Run time: ${Math.round((Date.now() - started) / 1000)} seconds`,
      `CSV: ${csvPath}`,
    ],
    leads: kept,
    excluded,
    sourceLines: [
      ...runs.map((r) => r.note),
      `Websites crawled: ${toCrawl.filter((l) => l.site).length}${a['no-crawl'] ? ' (crawl skipped)' : ''}`,
      `Mail-server (MX) check: ${mxWorks ? 'done' : 'skipped'}`,
    ],
    googleLines: googleReportLines(counter, monthBefore, await counter.monthCalls(), !!google),
    dncLine,
  })
  writeFileSync(join(out, `report_${slug}.txt`), report)
  console.log('\n' + report)
}

if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) main().catch((e) => { console.error(`\nERROR: ${e.message}`); process.exit(1) })
