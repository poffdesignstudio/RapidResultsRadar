import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config, googleApiKey, OUTPUT_DIR, ensureDir } from './config.js'
import { formatDate, isoToDisplay } from './core/dates.js'
import { httpGet } from './core/http.js'
import { resolveArea } from './geo/area.js'
import { textSearchPage } from './providers/googlePlaces.js'
import { CallCounter } from './budget/usage.js'
import { latestRelease } from './providers/overture.js'
import { nppesQuery } from './providers/nppes.js'
import { pdcCsvUrl, catalogCsvUrl, cachedCsv, findHeader } from './providers/cmsData.js'
import { hasMx } from './enrich/emails.js'

/**
 * Makes one real call to every Stage 1 source and writes what it finds to
 * output/source_check_MM-DD-YYYY.txt. Uses 1 Google call when a key is set.
 */
const out: string[] = []
const say = (s = '') => { console.log(s); out.push(s) }
const ok = (s: string) => say(`  OK    ${s}`)
const bad = (s: string) => say(`  FAIL  ${s}`)

async function step(name: string, fn: () => Promise<void>) {
  say(`\n${name}`)
  try { await fn() } catch (e) { bad((e as Error).message) }
}

async function main() {
  say(`SOURCE CHECK - ${formatDate()}   Node ${process.version}   ${process.platform}`)

  await step('Census Gazetteer (city and ZIP centers)', async () => {
    const area = await resolveArea({ city: 'Charlotte', state: 'NC', radiusMiles: 30 }, (m) => bad(m))
    if (!area.zips.size) throw new Error('ZIP list is empty')
    ok(`Charlotte, NC center ${area.centerLat.toFixed(4)}, ${area.centerLng.toFixed(4)}; ${area.zips.size} ZIPs and ${area.places.length} towns within 30 miles; states ${[...area.states].join(', ')}`)
  })

  await step('Google Places API (New) Text Search, basic fields (uses 1 call)', async () => {
    if (!googleApiKey()) { say('  SKIP  GOOGLE_PLACES_API_KEY is not set in .env'); return }
    const googleCounter = new CallCounter('google', 1, config.google.maxCallsPerMonth)
    if (!(await googleCounter.canCall())) throw new Error(`Cap reached: ${googleCounter.stoppedAtCap}`)
    const r = await textSearchPage({ apiKey: googleApiKey(), counter: googleCounter }, 'home care agency', { minLat: 34.79, maxLat: 35.66, minLng: -81.37, maxLng: -80.31 })
    if (r.error) throw new Error(r.error)
    ok(`${r.places.length} places on page 1, next page available: ${r.nextPageToken ? 'yes' : 'no'}`)
    const p = r.places[0]
    if (p) ok(`First: ${p.displayName?.text} | ${p.formattedAddress} | id ${p.id} | status ${p.businessStatus}`)
    ok(`Calls this month: ${await googleCounter.monthCalls()} of ${config.google.maxCallsPerMonth}`)
  })

  await step('Overture Maps places', async () => {
    const rel = await latestRelease()
    ok(`Latest release: ${rel}`)
  })

  await step('NPPES NPI Registry API', async () => {
    const r = await nppesQuery({ taxonomy_description: 'Home Health', city: 'Charlotte', state: 'NC' })
    if (r.error) throw new Error(r.error)
    ok(`Home Health organizations in Charlotte, NC: ${r.count} (this page ${r.results.length})`)
    const x = r.results[0]
    if (x) {
      const b = x.basic ?? {}
      ok(`First: ${b.organization_name} | official: ${b.authorized_official_first_name} ${b.authorized_official_last_name}, ${b.authorized_official_title_or_position} | updated ${isoToDisplay(b.last_updated)}`)
      ok(`Taxonomies: ${(x.taxonomies ?? []).map((t) => `${t.code} ${t.desc}${t.primary ? ' (primary)' : ''}`).join('; ')}`)
      ok(`Has any email field: ${/email/i.test(JSON.stringify(x)) ? 'yes' : 'no'}`)
    }
    for (const desc of ['In Home Supportive Care', 'Nursing Care']) {
      const q = await nppesQuery({ taxonomy_description: desc, city: 'Charlotte', state: 'NC' })
      say(`  ${q.error ? 'FAIL' : 'OK  '}  "${desc}" in Charlotte, NC: ${q.error ?? q.count}`)
    }
    const deep = await nppesQuery({ taxonomy_description: 'Home Health', state: 'NC', skip: '1000' })
    say(`  INFO  skip=1000 statewide: ${deep.error ?? `${deep.results.length} results`}`)
    const tooDeep = await nppesQuery({ taxonomy_description: 'Home Health', state: 'NC', skip: '1200' })
    say(`  INFO  skip=1200 statewide: ${tooDeep.error ?? `${tooDeep.results.length} results`}`)
  })

  await step('CMS Home Health Care Agencies (Provider Data Catalog 6jpm-sxkc)', async () => {
    const meta = await pdcCsvUrl(config.cms.homeHealthDatasetId)
    ok(`${meta.title} | updated ${isoToDisplay(meta.modified) || meta.modified} | ${meta.url}`)
    const rows = await cachedCsv('home_health_agencies', meta.url)
    const h = Object.keys(rows[0] ?? {})
    ok(`${rows.length} agencies; ${rows.filter((r) => /^nc$/i.test(r[findHeader(h, /^state$/i) ?? ''] ?? '')).length} in NC`)
    say(`  INFO  Columns: ${h.join(' | ')}`)
    for (const [label, re] of [['name', /provider.?name/i], ['ccn', /certification number|ccn/i], ['address', /^address$/i], ['city', /city/i], ['zip', /zip/i], ['phone', /telephone|phone/i], ['ownership', /ownership/i]] as const) {
      const m = findHeader(h, re)
      say(`  ${m ? 'OK  ' : 'FAIL'}  ${label} -> ${m ?? 'NOT FOUND'}`)
    }
  })

  for (const title of [config.cms.ownersDatasetTitle, 'Home Health Agency Enrollments']) {
    await step(`CMS ${title} (data.cms.gov)`, async () => {
      const { url, label } = await catalogCsvUrl(title)
      ok(`Newest CSV: ${label ?? ''} ${url}`)
      const rows = await cachedCsv(title.includes('Owners') ? 'hha_all_owners' : 'hha_enrollments', url)
      const h = Object.keys(rows[0] ?? {})
      ok(`${rows.length} rows`)
      say(`  INFO  Columns: ${h.join(' | ')}`)
      const need: [string, RegExp][] = title.includes('Owners')
        ? [['enrollment id', /enrollment.?id/i], ['owner type', /type.*owner/i], ['first name', /first name/i], ['last name', /last name/i], ['role', /role text/i], ['percentage', /percentage ownership/i]]
        : [['enrollment id', /enrollment.?id/i], ['ccn', /^ccn$|certification number|ccn/i], ['org name', /organization name/i], ['state', /^state$|state/i], ['zip', /zip/i]]
      for (const [label2, re] of need) {
        const m = findHeader(h, re)
        say(`  ${m ? 'OK  ' : 'FAIL'}  ${label2} -> ${m ?? 'NOT FOUND'}`)
      }
      if (title.includes('Owners')) {
        const t = findHeader(h, /type.*owner/i)
        if (t) say(`  INFO  Owner types: ${[...new Set(rows.slice(0, 5000).map((r) => r[t]))].join(', ')}`)
      }
    })
  }

  await step('Website crawl and mail-server check', async () => {
    const r = await httpGet('https://www.rrbgs.com/robots.txt', { timeoutMs: 15000 })
    say(`  ${r.status ? 'OK  ' : 'FAIL'}  Fetched a business website's robots.txt: HTTP ${r.status}`)
    const mx = await hasMx('gmail.com')
    say(`  ${mx ? 'OK  ' : 'FAIL'}  MX lookup for gmail.com: ${mx === null ? 'lookup failed' : mx ? 'mail server found' : 'none'}`)
  })

  const p = join(ensureDir(OUTPUT_DIR), `source_check_${formatDate()}.txt`)
  writeFileSync(p, out.join('\r\n') + '\r\n')
  console.log(`\nSaved to ${p}`)
}

main()
