import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { config, OUTPUT_DIR, ensureDir, googleApiKey } from './config.js'
import { formatDate, monthKey } from './core/dates.js'
import { mapLimit } from './core/http.js'
import { toCsv } from './core/csv.js'
import type { RunContext, SourceRecord } from './core/types.js'
import { resolveArea } from './geo/area.js'
import { resolveNiche, nicheMismatch } from './niches.js'
import { googleProvider, googleCounter, googleListPrice } from './providers/googlePlaces.js'
import { overtureProvider } from './providers/overture.js'
import { nppesProvider } from './providers/nppes.js'
import { cmsHomeHealthProvider } from './providers/cmsHomeHealth.js'
import { cmsOwnersProvider } from './providers/cmsOwners.js'
import { clusterRecords } from './match/cluster.js'
import { sharedDomains } from './match/franchise.js'
import { loadDnc, checkDnc } from './match/doNotContact.js'
import { loadSuppression } from './match/suppression.js'
import { crawlSite } from './enrich/crawler.js'
import { hasMx } from './enrich/emails.js'
import { Ledger } from './leads/ledger.js'
import { buildLead, finalizeContact, ledgerKeys, baseRow, type Lead } from './leads/build.js'
import { COLUMNS } from './leads/columns.js'
import { buildReport } from './export/report.js'

const HELP = `
Lead Digger, Stage 1

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
  if (a['max-google']) googleCounter.maxPerRun = Number(a['max-google'])
  const monthBefore = googleCounter.monthCalls()

  const ctx: RunContext = { niche, area, log }
  const useGoogle = !a['no-google']
  const [g, o, np, hha, own] = await Promise.all([
    useGoogle ? googleProvider.search(ctx) : (log('Google: skipped (--no-google)'), Promise.resolve([] as SourceRecord[])),
    overtureProvider.search(ctx).catch((e) => { log(`Overture: FAILED (${e.message})`); return [] as SourceRecord[] }),
    nppesProvider.search(ctx).catch((e) => { log(`NPPES: FAILED (${e.message})`); return [] as SourceRecord[] }),
    cmsHomeHealthProvider.search(ctx),
    cmsOwnersProvider.search(ctx),
  ])

  // Records from the owner file only matter when they attach to a business another source found.
  const records = [...g, ...o, ...np, ...hha, ...own]
  const shared = sharedDomains()
  const all = clusterRecords(records, shared)
  const keep = all.map((c, i) => (c.records.some((r) => r.source !== 'cms_owners') ? i : -1)).filter((i) => i >= 0)
  const clusters = keep.map((i) => all[i])
  log(`Matched ${records.length} source records into ${clusters.length} businesses`)

  // Keep only businesses that are actually in the niche. The rest go to the review file with the reason.
  const ledger = new Ledger()
  const leads: Lead[] = clusters.map((c) => buildLead(c, niche))
  leads.forEach((l) => (l.lead_id = ledger.idFor(ledgerKeys(l))))
  const leadByCluster = new Map(keep.map((ci, li) => [ci, leads[li]]))
  clusters.forEach((c, i) => (leads[i].possibleDuplicateOf = c.possibleDuplicates.map((j) => leadByCluster.get(j)?.lead_id).filter((x): x is string => !!x)))
  ledger.save()
  for (const l of leads) {
    const reason = nicheMismatch(niche, {
      names: [...new Set(l.records.flatMap((r) => [r.name, ...(r.altNames ?? [])]))],
      government: l.records.some((r) => ['nppes', 'cms_hha', 'cms_owners'].includes(r.source)),
      brand: !!l.brand,
      category: l.records.some((r) => r.source === 'overture' && r.categories?.some((c) => niche.overtureTaxonomies.includes(c))),
    })
    if (reason) l.excluded ??= reason
  }

  // Website crawl, in batches, cached per site so a re-run picks up where it left off.
  const toCrawl = leads.filter((l) => !l.excluded && l.fields.website).slice(0, a['max-sites'] ? Number(a['max-sites']) : undefined)
  if (!a['no-crawl'] && config.crawler.enabled) {
    log(`Crawling ${toCrawl.length} websites (up to ${config.crawler.maxPagesPerSite} pages each, robots.txt respected)...`)
    let done = 0
    await mapLimit(toCrawl, config.crawler.concurrency, async (l) => {
      const url = l.fields.website!.value
      let stay = !!l.brand
      try { stay ||= new URL(url).pathname.length > 1 && /locations?|offices?|branch/.test(new URL(url).pathname) } catch { /* bad URL */ }
      try { l.site = await crawlSite(url, { stayUnderPath: stay }) } catch (e) { l.flags.push(`Crawl error: ${(e as Error).message}`) }
      if (++done % 25 === 0) log(`  crawled ${done}/${toCrawl.length}`)
    })
  }

  // Mail-server check on each email domain we might use.
  // First make sure DNS lookups work here at all, so a blocked network is not read as "no mail server".
  const mxWorks = config.email.mxCheck && (await hasMx('gmail.com')) === true
  if (config.email.mxCheck && !mxWorks) log('MX check: DNS lookups are not working on this network, so the mail-server check was skipped')
  if (mxWorks) {
    await mapLimit(leads, 10, async (l) => {
      const d = l.site?.emails.find((e) => e.email.endsWith(`@${l.fields.domain?.value}`))?.email.split('@')[1] ?? l.fields.domain?.value
      if (d) l.mx = await hasMx(d)
    })
  }
  const placeNames = area.places.map((p) => p.name)
  leads.forEach((l) => finalizeContact(l, config.email.guessForNamedPeople, placeNames))

  // Do-not-contact and suppression.
  const dnc = loadDnc()
  let dncDropped = 0, dncFlagged = 0
  if (dnc) {
    for (const l of leads) {
      const r = checkDnc(dnc, {
        names: l.records.flatMap((x) => [x.name, ...(x.altNames ?? [])]),
        brand: l.brand?.brand, city: l.fields.city?.value, state: l.fields.state?.value,
      })
      if (r.action === 'drop') { l.excluded ??= r.reason; dncDropped++ }
      if (r.action === 'flag') { l.flags.push(r.reason!); dncFlagged++ }
    }
  }
  const sup = loadSuppression()
  for (const l of leads) {
    const e = l.fields.contact_email?.value
    const d = l.fields.domain?.value
    if ((e && sup.emails.has(e)) || (d && sup.domains.has(d)) || (e && sup.domains.has(e.split('@')[1]))) l.excluded ??= 'On the suppression list'
  }

  const kept = leads.filter((l) => !l.excluded).sort((x, y) => y.score - x.score)
  const excluded = leads.filter((l) => l.excluded)

  // Files.
  const out = ensureDir(OUTPUT_DIR)
  const slug = `${(a.zip ?? `${a.city ?? 'area'}_${a.state ?? ''}`).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${niche.key}_${today}`
  const rows = kept.map((l) => baseRow(l, ledger.firstSeen(l.lead_id)))
  const csvPath = join(out, `leads_${slug}.csv`)
  writeFileSync(csvPath, toCsv(COLUMNS, rows))
  writeFileSync(join(out, `review_left_out_${slug}.csv`), toCsv(['reason', ...COLUMNS], excluded.map((l) => ({ reason: l.excluded, ...baseRow(l, ledger.firstSeen(l.lead_id)) }))))
  const prov = Object.fromEntries(leads.map((l) => [l.lead_id, { fields: l.fields, sources: l.records.map((r) => `${r.source}:${r.sourceId}`), site_pages: l.site?.pages, excluded: l.excluded }]))
  writeFileSync(join(out, `provenance_${slug}.json`), JSON.stringify(prov, null, 2))
  const sample = [...kept].sort(() => Math.random() - 0.5).slice(0, 10)
  writeFileSync(join(out, `spotcheck_${slug}.csv`), toCsv(['lead_id', 'company_name', 'website', 'contact_name', 'contact_name_source', 'contact_title', 'contact_email', 'email_status', 'email_source', 'pages_crawled', 'flags'], sample.map((l) => ({
    lead_id: l.lead_id, company_name: l.fields.company_name?.value, website: l.fields.website?.value,
    contact_name: l.fields.contact_name?.value, contact_name_source: l.fields.contact_name?.source, contact_title: l.fields.contact_title?.value,
    contact_email: l.fields.contact_email?.value, email_status: l.fields.email_status?.value, email_source: l.fields.contact_email?.source,
    pages_crawled: l.site?.pages.map((p) => `${p.kind} ${p.status} ${p.url}`).join(' | '), flags: l.flags.join('; '),
  }))))

  const runCalls = googleCounter.runCalls
  const monthAfter = googleCounter.monthCalls()
  const billable = (n: number) => Math.max(0, n - config.google.freeCallsPerMonth)
  const afterFree = ((billable(monthAfter) - billable(monthBefore)) / 1000) * config.google.costPer1000
  const googleLines = googleApiKey() && useGoogle
    ? [
        `Calls this run: ${runCalls} (run cap ${googleCounter.maxPerRun})`,
        `Calls in ${monthKey()}: ${monthAfter} of ${config.google.maxCallsPerMonth} monthly cap`,
        `Estimated cost this run: $${googleListPrice(runCalls).toFixed(2)} at list price, $${afterFree.toFixed(2)} after the ${config.google.freeCallsPerMonth} free monthly calls`,
        `Pricing used: $${config.google.costPer1000} per 1,000 calls. ${config.google.skuNote}`,
        ...(googleCounter.stoppedAtCap ? [`STOPPED at the ${googleCounter.stoppedAtCap}. Some businesses may be missing.`] : []),
        ...googleProvider.errors.slice(0, 3).map((e) => `Error: ${e}`),
      ]
    : ['Not used (no API key, or --no-google). Calls: 0. Cost: $0.00']
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
      `Google Places: ${g.length} places`,
      `Overture (release ${overtureProvider.release ?? '?'}): ${o.length} places`,
      `NPPES: ${np.length} organizations from ${nppesProvider.calls} free calls${nppesProvider.errors.length ? ` (${nppesProvider.errors.length} errors, first: ${nppesProvider.errors[0]})` : ''}`,
      `CMS home health agencies: ${hha.length}${cmsHomeHealthProvider.errors.length ? ` (FAILED: ${cmsHomeHealthProvider.errors[0]})` : ''}`,
      `CMS owners: ${own.length} enrolled agencies, ${own.flatMap((r) => r.people ?? []).length} named people${cmsOwnersProvider.errors.length ? ` (FAILED: ${cmsOwnersProvider.errors[0]})` : ''}`,
      `Websites crawled: ${toCrawl.filter((l) => l.site).length}${a['no-crawl'] ? ' (crawl skipped)' : ''}`,
      `Mail-server (MX) check: ${!config.email.mxCheck ? 'turned off' : mxWorks ? 'done' : 'SKIPPED, DNS lookups not working on this network'}`,
    ],
    googleLines,
    dncLine: dnc ? `Applied (${dnc.length} rows in file): ${dncDropped} dropped as existing clients, ${dncFlagged} flagged for review` : 'NOT APPLIED: data/do_not_contact.csv is missing. Do not send this file to Leia until it is re-run with the list.',
  })
  writeFileSync(join(out, `report_${slug}.txt`), report)
  console.log('\n' + report)
}

main().catch((e) => { console.error(`\nERROR: ${e.message}`); process.exit(1) })
