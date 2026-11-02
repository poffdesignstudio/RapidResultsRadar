import type { Lead } from '../leads/build.js'
import { TRACKED } from '../leads/columns.js'
import { config } from '../config.js'
import { monthKey } from '../core/dates.js'
import type { CallCounter } from '../budget/usage.js'
import { googleListPrice } from '../providers/googlePlaces.js'

export interface RunStats {
  title: string
  lines: string[]
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '0%')
const count = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>()
  for (const x of xs) { const k = key(x); m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

/** The plain-text run report: coverage, where each field came from, Google usage and cost. */
export function buildReport(opts: {
  header: string[]
  leads: Lead[]
  excluded: Lead[]
  sourceLines: string[]
  googleLines: string[]
  dncLine: string
}): string {
  const { leads, excluded } = opts
  const n = leads.length
  const L: string[] = [...opts.header, '']
  L.push('SOURCES', ...opts.sourceLines.map((s) => `  ${s}`), '')

  const google = leads.filter((l) => l.records.some((r) => r.source === 'google'))
  const ov = leads.filter((l) => l.records.some((r) => r.source === 'overture'))
  const both = leads.filter((l) => l.records.some((r) => r.source === 'google') && l.records.some((r) => r.source === 'overture'))
  L.push('GOOGLE vs OVERTURE CROSS-CHECK',
    `  Found by both: ${both.length}   Google only: ${google.length - both.length}   Overture only: ${ov.length - both.length}`, '')

  const web = leads.filter((l) => l.fields.website)
  const crawled = leads.filter((l) => l.site?.status === 'ok')
  const named = leads.filter((l) => l.fields.contact_name)
  const anyEmail = leads.filter((l) => l.fields.contact_email)
  const personal = anyEmail.filter((l) => l.fields.email_status?.value !== 'generic')
  L.push(`BUSINESSES FOUND: ${n} exported, ${excluded.length} left out (see the review file)`,
    `  With a website:          ${web.length} (${pct(web.length, n)}), crawled OK: ${crawled.length}`,
    `  With a named person:     ${named.length} (${pct(named.length, n)})`,
    ...count(named, (l) => l.fields.contact_name!.source.split(':')[0].split(' ')[0]).map(([k, v]) => `      from ${k}: ${v}`),
    `  With any email:          ${anyEmail.length} (${pct(anyEmail.length, n)})`,
    `  With a personal email:   ${personal.length} (${pct(personal.length, n)})  (not info@ / office@ style)`,
    ...count(anyEmail, (l) => l.fields.contact_email!.source.replace(':found_on_page', ' (found on its pages)').replace(':listed', ' (listed in its data)')).map(([k, v]) => `      email from ${k}: ${v}`),
    '  Email status:',
    ...count(anyEmail, (l) => l.fields.email_status?.value ?? '').map(([k, v]) => `      ${k}: ${v}`),
    '  Hiring signal:',
    ...count(leads, (l) => l.fields.hiring_signal?.value ?? 'unknown').map(([k, v]) => `      ${k}: ${v}`),
    '  Segment:',
    ...count(leads, (l) => l.fields.segment?.value ?? '').map(([k, v]) => `      ${k}: ${v}`),
    `  Franchise or chain locations: ${leads.filter((l) => l.brand).length}`,
    '')

  L.push('GOOGLE PLACES', ...opts.googleLines.map((s) => `  ${s}`), '')

  L.push('FIELDS THAT CAME ONLY FROM GOOGLE (Google terms allow storing only the place ID)')
  let any = false
  for (const c of TRACKED) {
    const only = leads.filter((l) => l.fields[c]?.source === 'google').length
    if (only) { L.push(`  ${c}: ${only} rows`); any = true }
  }
  if (!any) L.push('  None. Every exported field also came from an open or government source.')
  L.push('')

  L.push('DO-NOT-CONTACT', `  ${opts.dncLine}`, '')
  L.push('LEFT OUT OF THE EXPORT')
  for (const [k, v] of count(excluded, (l) => l.excluded!.replace(/:.*/, ''))) L.push(`  ${k}: ${v}`)
  if (excluded.length) L.push('  Examples:', ...excluded.slice(0, 15).map((l) => `    ${l.fields.company_name?.value ?? '?'}  (${l.excluded})`))
  if (!excluded.length) L.push('  None')
  L.push('')
  L.push('MOST COMMON FLAGS')
  for (const [k, v] of count(leads.flatMap((l) => l.flags.map((f) => f.replace(/: .*|of RR-.*/, ''))), (x) => x).slice(0, 12)) L.push(`  ${v}  ${k}`)
  return L.join('\r\n') + '\r\n'
}

/** The Google section of the report: calls, caps and estimated cost. */
export function googleReportLines(counter: Pick<CallCounter, 'runCalls' | 'maxPerRun' | 'maxPerMonth' | 'stoppedAtCap'>, monthBefore: number, monthAfter: number, used: boolean, freePerMonth = config.google.freeCallsPerMonth, costPer1000 = config.google.costPer1000): string[] {
  if (!used) return ['Not used (no API key, turned off, or not selected). Calls: 0. Cost: $0.00']
  const billable = (n: number) => Math.max(0, n - freePerMonth)
  const afterFree = ((billable(monthAfter) - billable(monthBefore)) / 1000) * costPer1000
  return [
    `Calls this run: ${counter.runCalls} (run cap ${counter.maxPerRun})`,
    `Calls in ${monthKey()}: ${monthAfter} of ${counter.maxPerMonth} monthly cap`,
    `Estimated cost this run: $${googleListPrice(counter.runCalls).toFixed(2)} at list price, $${afterFree.toFixed(2)} after the ${freePerMonth} free monthly calls`,
    `Pricing used: $${costPer1000} per 1,000 calls. ${config.google.skuNote}`,
    ...(counter.stoppedAtCap ? [`STOPPED at the ${counter.stoppedAtCap}. Some businesses may be missing.`] : []),
  ]
}

