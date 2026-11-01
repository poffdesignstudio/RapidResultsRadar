import type { Lead } from '../leads/build.js'
import { TRACKED } from '../leads/columns.js'

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
  if (!excluded.length) L.push('  None')
  L.push('')
  L.push('MOST COMMON FLAGS')
  for (const [k, v] of count(leads.flatMap((l) => l.flags.map((f) => f.replace(/: .*|of RR-.*/, ''))), (x) => x).slice(0, 12)) L.push(`  ${v}  ${k}`)
  return L.join('\r\n') + '\r\n'
}
