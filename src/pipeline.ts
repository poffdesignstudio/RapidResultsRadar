import { config } from './config.js'
import { mapLimit } from './core/http.js'
import type { RunContext, SearchArea, SourceRecord } from './core/types.js'
import { createGoogleProvider, type GoogleAccess } from './providers/googlePlaces.js'
import { overtureProvider } from './providers/overture.js'
import { nppesProvider } from './providers/nppes.js'
import { cmsHomeHealthProvider } from './providers/cmsHomeHealth.js'
import { cmsOwnersProvider } from './providers/cmsOwners.js'
import { clusterRecords } from './match/cluster.js'
import { sharedDomains } from './match/franchise.js'
import { checkDnc, type DncRow } from './match/doNotContact.js'
import { crawlSite, type CrawlCache } from './enrich/crawler.js'
import { hasMx } from './enrich/emails.js'
import { buildLead, finalizeContact, ledgerKeys, type Lead } from './leads/build.js'
import type { LeadLedger } from './leads/ledger.js'
import { nicheMismatch } from './niches.js'

/**
 * The Stage 1 search, as separate steps. The CLI runs them back to back; the web app runs
 * them one per request and saves progress in between.
 */
export type SourceKey = 'google' | 'overture' | 'nppes' | 'cms'
export const SOURCE_LABELS: Record<SourceKey, string> = {
  google: 'Google Places',
  overture: 'Overture Maps',
  nppes: 'NPPES (NPI Registry)',
  cms: 'CMS home health agencies and owners',
}

export interface SourceRun {
  records: SourceRecord[]
  /** One line for the report: counts, calls and any error. */
  note: string
}

export async function runSource(key: SourceKey, ctx: RunContext, google: GoogleAccess | null): Promise<SourceRun> {
  try {
    if (key === 'google') {
      const p = createGoogleProvider(google)
      const records = await p.search(ctx)
      const g = google?.counter
      const note = !google?.apiKey
        ? 'Google Places: skipped, GOOGLE_PLACES_API_KEY is not set'
        : `Google Places: ${records.length} places from ${g?.runCalls ?? 0} calls${g?.stoppedAtCap ? ` (STOPPED at the ${g.stoppedAtCap}; some businesses may be missing)` : ''}${p.errors.length ? ` (error: ${p.errors[0]})` : ''}`
      return { records, note }
    }
    if (key === 'overture') {
      const records = await overtureProvider.search(ctx)
      return { records, note: `Overture (release ${overtureProvider.release ?? '?'}): ${records.length} places` }
    }
    if (key === 'nppes') {
      nppesProvider.errors = []
      nppesProvider.calls = 0
      const records = await nppesProvider.search(ctx)
      const e = nppesProvider.errors
      return { records, note: `NPPES: ${records.length} organizations from ${nppesProvider.calls} free calls${e.length ? ` (${e.length} errors, first: ${e[0]})` : ''}` }
    }
    cmsHomeHealthProvider.errors = []
    cmsOwnersProvider.errors = []
    const hha = await cmsHomeHealthProvider.search(ctx)
    const own = await cmsOwnersProvider.search(ctx)
    const fail = [...cmsHomeHealthProvider.errors, ...cmsOwnersProvider.errors]
    return {
      records: [...hha, ...own],
      note: `CMS: ${hha.length} certified agencies, ${own.length} enrolled agencies with ${own.flatMap((r) => r.people ?? []).length} named owners or officers${fail.length ? ` (FAILED: ${fail[0]})` : ''}`,
    }
  } catch (e) {
    ctx.log(`${SOURCE_LABELS[key]}: FAILED (${(e as Error).message})`)
    return { records: [], note: `${SOURCE_LABELS[key]}: FAILED (${(e as Error).message})` }
  }
}

/**
 * Groups records into businesses, gives each a permanent lead ID, links possible duplicates,
 * and marks businesses outside the niche as left out.
 */
export async function matchLeads(records: SourceRecord[], ctx: RunContext, ledger: LeadLedger): Promise<Lead[]> {
  const { niche } = ctx
  const all = clusterRecords(records, sharedDomains())
  // Records from the CMS owner file only matter when they attach to a business another source found.
  const keep = all.map((c, i) => (c.records.some((r) => r.source !== 'cms_owners') ? i : -1)).filter((i) => i >= 0)
  const clusters = keep.map((i) => all[i])
  const leads = clusters.map((c) => buildLead(c, niche))
  for (const l of leads) l.lead_id = await ledger.idFor(ledgerKeys(l))
  const byCluster = new Map(keep.map((ci, li) => [ci, leads[li]]))
  clusters.forEach((c, i) => (leads[i].possibleDuplicateOf = c.possibleDuplicates.map((j) => byCluster.get(j)?.lead_id).filter((x): x is string => !!x)))
  for (const l of leads) {
    const reason = nicheMismatch(niche, {
      names: [...new Set(l.records.flatMap((r) => [r.name, ...(r.altNames ?? [])]))],
      government: l.records.some((r) => ['nppes', 'cms_hha', 'cms_owners'].includes(r.source)),
      brand: !!l.brand,
      category: l.records.some((r) => r.source === 'overture' && r.categories?.some((c) => niche.overtureTaxonomies.includes(c))),
    })
    if (reason) l.excluded ??= reason
  }
  ctx.log(`Matched ${records.length} source records into ${leads.length} businesses (${leads.filter((l) => l.excluded).length} left out as not ${niche.label.toLowerCase()})`)
  return leads
}

export const needsCrawl = (l: Lead) => !l.excluded && !!l.fields.website && !l.site && !l.crawlError

/** Crawls the given leads' websites in place. */
export async function crawlLeads(leads: Lead[], cache?: CrawlCache) {
  await mapLimit(leads, config.crawler.concurrency, async (l) => {
    const url = l.fields.website!.value
    let stay = !!l.brand
    try { stay ||= new URL(url).pathname.length > 1 && /locations?|offices?|branch/.test(new URL(url).pathname) } catch { /* bad URL */ }
    try { l.site = await crawlSite(url, { stayUnderPath: stay, cache }) } catch (e) { l.crawlError = (e as Error).message; l.flags.push(`Crawl error: ${l.crawlError}`) }
  })
}

/** Mail-server check on each lead's email domain. Returns false when lookups do not work on this network. */
export async function checkMailServers(leads: Lead[]): Promise<boolean> {
  if (!config.email.mxCheck || (await hasMx('gmail.com')) !== true) return false
  await mapLimit(leads, 10, async (l) => {
    const d = l.site?.emails.find((e) => e.email.endsWith(`@${l.fields.domain?.value}`))?.email.split('@')[1] ?? l.fields.domain?.value
    if (d) l.mx = await hasMx(d)
  })
  return true
}

export interface Suppression { emails: Set<string>; domains: Set<string> }

export function isSuppressed(sup: Suppression, email?: string, domain?: string): boolean {
  return !!((email && sup.emails.has(email.toLowerCase())) || (domain && sup.domains.has(domain)) || (email && sup.domains.has(email.split('@')[1]?.toLowerCase())))
}

/** Picks contacts and emails, then applies the do-not-contact and suppression lists. */
export function finalizeLeads(leads: Lead[], area: SearchArea, dnc: DncRow[] | null, sup: Suppression) {
  const placeNames = area.places.map((p) => p.name)
  for (const l of leads) {
    // Start from the flags and notes set before this step, so running it again does not repeat them.
    l.baseFlags ??= [...l.flags]
    l.baseNotes ??= [...l.notes]
    l.flags = [...l.baseFlags]
    l.notes = [...l.baseNotes]
    if (l.excluded?.startsWith('Existing client') || l.excluded === 'On the suppression list') delete l.excluded
    finalizeContact(l, config.email.guessForNamedPeople, placeNames)
  }
  let dropped = 0
  let flagged = 0
  if (dnc) {
    for (const l of leads) {
      const r = checkDnc(dnc, { names: l.records.flatMap((x) => [x.name, ...(x.altNames ?? [])]), brand: l.brand?.brand, city: l.fields.city?.value, state: l.fields.state?.value })
      if (r.action === 'drop') { l.excluded ??= r.reason; dropped++ }
      if (r.action === 'flag') { l.flags.push(r.reason!); flagged++ }
    }
  }
  for (const l of leads) if (isSuppressed(sup, l.fields.contact_email?.value, l.fields.domain?.value)) l.excluded ??= 'On the suppression list'
  return {
    dncLine: dnc
      ? `Applied (${dnc.length} rows on the list): ${dropped} dropped as existing clients, ${flagged} flagged for review`
      : 'NOT APPLIED: no do-not-contact list has been imported. Do not send these leads to Leia until it is.',
  }
}

/** Sets are not JSON. These convert a search area for saving between steps. */
export const areaToJson = (a: SearchArea) => ({ ...a, zips: [...a.zips], states: [...a.states] })
export const areaFromJson = (a: ReturnType<typeof areaToJson>): SearchArea => ({ ...a, zips: new Set(a.zips), states: new Set(a.states) })
