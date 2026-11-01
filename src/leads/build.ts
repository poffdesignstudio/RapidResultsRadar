import { domainFromUrl, formatPhone, isOwnWebsite, normName, normPhone, splitName, nameSimilarity } from '../core/normalize.js'
import { formatDate } from '../core/dates.js'
import type { Confidence, Field, Niche, Person, SourceRecord } from '../core/types.js'
import type { Cluster } from '../match/cluster.js'
import { detectBrand, type Brand } from '../match/franchise.js'
import type { SiteResult } from '../enrich/crawler.js'
import { titleScore } from '../enrich/extract.js'
import { applyPattern, isGenericEmail, patternOf, FREE_MAIL } from '../enrich/emails.js'
import type { Column } from './columns.js'

export interface Lead {
  lead_id: string
  records: SourceRecord[]
  fields: Partial<Record<Column, Field>>
  flags: string[]
  notes: string[]
  brand?: Brand
  site?: SiteResult
  /** Email domain mail-server check: true, false, or null when unknown. */
  mx?: boolean | null
  excluded?: string
  score: number
  possibleDuplicateOf: string[]
}

/** Which source we trust first for each field. Google is last so stored data comes from open sources. */
const ORDER: Record<string, SourceRecord['source'][]> = {
  name: ['overture', 'cms_hha', 'nppes', 'cms_owners', 'google'],
  address: ['cms_hha', 'overture', 'nppes', 'cms_owners', 'google'],
  phone: ['overture', 'cms_hha', 'nppes', 'cms_owners', 'google'],
  website: ['overture', 'nppes', 'cms_hha', 'cms_owners', 'google'],
}

function pick(records: SourceRecord[], order: SourceRecord['source'][], get: (r: SourceRecord) => string | undefined): Field | undefined {
  for (const src of order) {
    for (const r of records.filter((x) => x.source === src)) {
      const v = get(r)
      if (v) {
        const agree = records.filter((o) => o !== r && get(o) && norm(get(o)!) === norm(v)).map((o) => o.source)
        const conf: Confidence = agree.length ? 'high' : r.source === 'overture' && (r.sourceConfidence ?? 1) < 0.5 ? 'low' : 'medium'
        return { value: v, source: [r.source, ...new Set(agree)].filter((s, i, a) => a.indexOf(s) === i).join('+'), confidence: conf }
      }
    }
  }
  return undefined
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function sourceIdOf(r: SourceRecord): string {
  const prefix = { google: 'google', overture: 'overture', nppes: 'npi', cms_hha: 'ccn', cms_owners: 'cms_enrollment', website: 'web' }[r.source]
  return `${prefix}:${r.sourceId}`
}

/** Builds a lead's company fields from the records that matched together. */
export function buildLead(cluster: Cluster, niche: Niche): Lead {
  const recs = cluster.records
  const f: Partial<Record<Column, Field>> = {}
  const set = (c: Column, v: Field | undefined) => { if (v) f[c] = v }
  set('company_name', pick(recs, ORDER.name, (r) => r.name))
  const addrRec = ORDER.address.flatMap((s) => recs.filter((r) => r.source === s)).find((r) => r.address)
  if (addrRec) {
    const others = recs.filter((r) => r !== addrRec)
    for (const [c, v] of [['address', addrRec.address], ['city', addrRec.city], ['state', addrRec.state], ['zip', addrRec.zip]] as [Column, string | undefined][]) {
      if (!v) continue
      const agree = others.filter((o) => norm(String((o as unknown as Record<string, unknown>)[c] ?? '')) === norm(v)).map((o) => o.source)
      f[c] = { value: v, source: [addrRec.source, ...new Set(agree)].join('+'), confidence: agree.length ? 'high' : 'medium' }
    }
  }
  const ph = pick(recs, ORDER.phone, (r) => normPhone(r.phone) || undefined)
  if (ph) f.phone = { ...ph, value: formatPhone(ph.value) }
  set('website', pick(recs, ORDER.website, (r) => (isOwnWebsite(r.website) ? r.website : undefined)))
  if (f.website) f.domain = { ...f.website, value: domainFromUrl(f.website.value) }

  const names = recs.flatMap((r) => [r.name, ...(r.altNames ?? [])])
  const otherState = f.website && f.state ? stateInUrlMismatch(f.website.value, f.state.value) : ''
  const wrongSiteFlag = otherState ? `Website looks like a location in ${otherState}, not this office, so it was not used` : ''
  if (otherState) { delete f.website; delete f.domain }
  const brand = detectBrand(names, recs.map((r) => r.website ?? ''))
  if (brand) f.franchise_brand = { value: brand.brand, source: 'franchise_list', confidence: 'high' }

  const hh = recs.some((r) => r.homeHealthEvidence) || names.some((n) => /home health/i.test(n))
  f.segment = niche.healthcare
    ? { value: hh ? 'home health' : 'home care', source: hh ? 'cms_or_npi_or_name' : 'niche', confidence: hh ? 'high' : 'medium' }
    : { value: niche.defaultSegment, source: 'niche', confidence: 'medium' }

  const lead: Lead = { lead_id: '', records: recs, fields: f, flags: wrongSiteFlag ? [wrongSiteFlag] : [], notes: [], brand, score: 0, possibleDuplicateOf: [] }
  if (recs.some((r) => r.source === 'google' && r.closed)) lead.excluded = 'Google lists it as permanently closed'
  else if (recs.some((r) => r.closed)) lead.flags.push('One source lists it as closed')
  const own = recs.find((r) => r.ownership)?.ownership
  if (own) lead.notes.push(`CMS ownership type: ${own}`)
  return lead
}

/** Keys that identify this business in the lead ID ledger, strongest first. */
export function ledgerKeys(lead: Lead): string[] {
  const k: string[] = lead.records.map((r) => sourceIdOf(r))
  const ccn = lead.records.find((r) => r.ids?.ccn)?.ids?.ccn
  if (ccn) k.push(`ccn:${ccn}`)
  const phone = normPhone(lead.fields.phone?.value)
  if (phone) k.push(`phone:${phone}`)
  if (lead.fields.domain && !lead.brand) k.push(`domain:${lead.fields.domain.value}`)
  const nz = normName(lead.fields.company_name?.value).replace(/ /g, '_')
  if (nz && lead.fields.zip) k.push(`name_zip:${nz}|${lead.fields.zip.value}`)
  return [...new Set(k)]
}

const SOURCE_BONUS: Record<string, number> = { website: 10, cms_owners: 15, nppes: 5 }

interface Candidate extends Person { score: number; sources: Set<string> }

/** Every named person from every source, merged by name and ranked. */
export function rankPeople(lead: Lead): Candidate[] {
  const all: Person[] = [...lead.records.flatMap((r) => r.people ?? []), ...(lead.site?.people ?? [])]
  const by = new Map<string, Candidate>()
  for (const p of all) {
    const key = `${(p.first ?? '').toLowerCase()} ${(p.last ?? '').toLowerCase()}`.trim() || p.name.toLowerCase()
    const src = p.step.split(':')[0]
    const s = titleScore(p.title) + (SOURCE_BONUS[src] ?? 0) + (p.confidence === 'high' ? 5 : p.confidence === 'low' ? -10 : 0)
    const cur = by.get(key)
    if (!cur) by.set(key, { ...p, score: s, sources: new Set([src]) })
    else {
      cur.sources.add(src)
      if (s > cur.score) Object.assign(cur, { ...p, score: s, sources: cur.sources })
    }
  }
  for (const c of by.values()) if (c.sources.size > 1) { c.score += 20; c.confidence = 'high' }
  return [...by.values()].sort((a, b) => b.score - a.score)
}

/** Chooses the contact person and email, then scores and flags the lead. */
export function finalizeContact(lead: Lead, guessForNamedPeople: boolean, placeNames: string[] = []) {
  const f = lead.fields
  const site = lead.site
  const people = rankPeople(lead)
  const top = people[0]
  if (top) {
    const via = [...top.sources].join('+')
    f.contact_name = { value: top.name, source: `${top.step}${top.sources.size > 1 ? ` (also ${via})` : ''}`, confidence: top.confidence }
    if (top.title) f.contact_title = { value: top.title, source: top.step, confidence: top.confidence }
    if (people.length > 1) lead.notes.push(`Other people: ${people.slice(1, 4).map((p) => `${p.name}${p.title ? ` (${p.title})` : ''} [${p.step}]`).join('; ')}`)
    if (top.step.startsWith('nppes') && top.sources.size === 1) lead.flags.push('Contact is the NPI authorized official, who may not be the owner')
    if (top.score < 40) lead.flags.push('Contact title is not clearly a decision maker')
  }

  const company = f.company_name?.value ?? ''
  const domain = f.domain?.value ?? ''
  const siteEmails = (site?.emails ?? []).map((e) => e.email)
  const recEmails = lead.records.flatMap((r) => (r.emails ?? []).map((e) => ({ e, src: r.source })))
  const allEmails = [...siteEmails.map((e) => ({ e, src: 'website' })), ...recEmails]
  const how = (src: string) => (src === 'website' ? 'website:found_on_page' : `${src}:listed`)
  const personal = allEmails.filter((x) => !isGenericEmail(x.e, company, placeNames))
  const generic = allEmails.filter((x) => isGenericEmail(x.e, company, placeNames))

  let email: Field | undefined
  let status = ''
  if (top) {
    const own = personal.find((x) => patternOf(x.e, top))
    if (own) { email = { value: own.e, source: how(own.src), confidence: own.src === 'website' ? 'high' : 'medium' }; status = 'unverified' }
    if (!email && domain && !lead.brand) {
      // Learn the pattern from another named person's email on the same domain.
      for (const p of people.slice(1)) {
        const mine = personal.find((x) => x.e.endsWith(`@${domain}`) && patternOf(x.e, p))
        const pat = mine && patternOf(mine.e, p)
        if (pat) {
          const guess = applyPattern(pat, top, domain)
          if (guess) { email = { value: guess, source: `pattern_from_site:${pat}`, confidence: 'medium' }; status = 'unverified'; break }
        }
      }
    }
    if (!email && guessForNamedPeople && domain && !lead.brand && lead.mx !== false && top.first && top.last) {
      const guess = applyPattern('first', top, domain)
      if (guess) {
        email = { value: guess, source: 'pattern_guess:first', confidence: 'low' }
        status = 'unverified'
        const alts = ['first.last', 'flast'].map((p) => applyPattern(p, top, domain)).filter(Boolean)
        lead.notes.push(`Other email guesses: ${alts.join(', ')}`)
        lead.flags.push('Email is a guess from the name, not found on the site')
      }
    }
  }
  if (!email && personal.length) {
    const x = personal.find((p) => p.e.endsWith(`@${domain}`)) ?? personal[0]
    email = { value: x.e, source: how(x.src), confidence: 'medium' }
    status = 'unverified'
    if (top) lead.flags.push('Personal-looking email may belong to someone other than the contact')
    else lead.flags.push('Personal-looking email, but no name was found')
  }
  if (!email && generic.length) {
    const x = generic.find((p) => p.e.endsWith(`@${domain}`)) ?? generic[0]
    email = { value: x.e, source: how(x.src), confidence: 'medium' }
    status = 'generic'
  }
  if (email) {
    f.contact_email = email
    f.email_status = { value: status, source: 'rapid_radar', confidence: 'medium' }
    const ed = email.value.split('@')[1]
    if (FREE_MAIL.test(ed)) lead.notes.push('Email is a free webmail address (gmail, yahoo, etc.)')
    else if (domain && ed !== domain && !ed.endsWith(`.${domain}`) && !lead.brand) lead.flags.push(`Email domain (${ed}) differs from the website (${domain})`)
    if (lead.brand && email.value.endsWith(`@${lead.brand.domains[0]}`) && status === 'generic') lead.flags.push('Email may go to the brand head office, not this location')
  }
  if (lead.mx === false && email) lead.flags.push('Email domain has no mail server (MX check failed)')

  if (site) f.hiring_signal = { value: site.hiring, source: `website:${site.careersPage ? 'careers' : 'pages'}`, confidence: site.hiring === 'unknown' ? 'low' : 'medium' }
  if (site && site.status !== 'ok') lead.flags.push(`Website ${site.status.replace(/_/g, ' ')}`)
  if (!f.website) lead.flags.push('No website found')
  if (!f.contact_name) lead.flags.push('No named person found')

  // A website whose name looks nothing like the business is often the wrong site.
  if (site?.status === 'ok' && company && domain) {
    const domainWords = domain.split('.')[0]
    const sim = nameSimilarity(company, domainWords.replace(/[-_]/g, ' '))
    const squashed = normName(company).replace(/ /g, '')
    if (sim < 0.2 && !squashed.includes(domainWords.replace(/[-_]/g, '')) && !domainWords.includes(squashed.slice(0, 6)) && !lead.brand) lead.flags.push('Website name does not resemble the business name')
  }
  if (lead.possibleDuplicateOf.length) lead.flags.push(`Possible duplicate of ${lead.possibleDuplicateOf.join(', ')}`)

  // Confidence score, 0 to 100.
  let s = 30
  const srcs = new Set(lead.records.map((r) => r.source))
  s += Math.min(20, (srcs.size - 1) * 10)
  if (site?.status === 'ok') s += 10
  if (f.contact_name) s += f.contact_name.confidence === 'high' ? 20 : f.contact_name.confidence === 'medium' ? 12 : 5
  if (email) s += status === 'generic' ? 5 : email.confidence === 'high' ? 20 : email.confidence === 'medium' ? 12 : 4
  s -= Math.min(30, lead.flags.length * 5)
  lead.score = Math.max(0, Math.min(100, s))
}

export function baseRow(lead: Lead, dateFound = formatDate()): Record<string, string> {
  const f = lead.fields
  const row: Record<string, string> = {}
  for (const [k, v] of Object.entries(f)) row[k] = v?.value ?? ''
  const srcs = [...new Set(lead.records.map((r) => r.source))]
  row.lead_id = lead.lead_id
  row.source = srcs.join('+')
  row.source_id = lead.records.map(sourceIdOf).join('; ')
  row.date_found = dateFound
  row.email_source = f.contact_email?.source ?? ''
  row.hiring_signal = f.hiring_signal?.value ?? 'unknown'
  row.confidence = String(lead.score)
  row.flags = lead.flags.join('; ')
  row.review_status = 'pending'
  row.notes = lead.notes.join(' | ')
  return row
}

export { splitName }

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new-hampshire': 'NH', 'new-jersey': 'NJ', 'new-mexico': 'NM', 'new-york': 'NY',
  'north-carolina': 'NC', 'north-dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode-island': 'RI',
  'south-carolina': 'SC', 'south-dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west-virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

/** For chain location pages like brand.com/texas/rio-grande-valley: the other state's name, if the URL names one. */
export function stateInUrlMismatch(url: string, state: string): string {
  let path = ''
  try { path = new URL(url).pathname.toLowerCase().replace(/_/g, '-') } catch { return '' }
  for (const [name, abbr] of Object.entries(STATES)) {
    if (abbr === state.toUpperCase()) continue
    // Match whole path segments only, so "west-virginia" does not hide inside "virginia-beach".
    if (path.split('/').includes(name)) return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return ''
}
