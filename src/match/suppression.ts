import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../config.js'
import { parseCsv } from '../core/csv.js'

/**
 * data/suppression.csv: one row per unsubscribed or blocked address, column `email`.
 * A row may instead hold a whole domain as "@example.com". Leads whose email or website
 * domain is suppressed are left out of every export.
 */
export function loadSuppression(): { emails: Set<string>; domains: Set<string> } {
  const p = join(DATA_DIR, 'suppression.csv')
  const emails = new Set<string>()
  const domains = new Set<string>()
  if (existsSync(p)) {
    for (const r of parseCsv(readFileSync(p, 'utf8'))) {
      const v = (r.email ?? Object.values(r)[0] ?? '').trim().toLowerCase()
      if (v.startsWith('@')) domains.add(v.slice(1))
      else if (v.includes('@')) emails.add(v)
    }
  }
  return { emails, domains }
}
