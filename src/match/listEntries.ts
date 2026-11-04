import { normName, normPhone, streetKey } from '../core/normalize.js'
import type { DncRow } from './doNotContact.js'

/**
 * One entry on one of the two do-not-contact lists (table `list_entries`):
 * kind 'client' = an existing Rapid Results client, kind 'suppression' = someone who
 * said leave them alone. An entry carries whatever identifying values its source had —
 * a business name, an email (or '@domain.com' for a whole-domain block), a phone —
 * and the search, the exports and the campaign import screen against all of them.
 * The client flavor keeps the legacy do_not_contact columns (entry_type,
 * use_for_matching, match_rule) so checkDnc treats migrated rows exactly as before.
 */
export type ListKind = 'client' | 'suppression'

export interface ListEntry {
  id?: number
  kind: ListKind
  name: string
  brand: string
  address: string
  city: string
  state: string
  email: string
  phone: string
  entry_type: string
  use_for_matching: string
  match_rule: string
  source?: string
  added_on?: string
}

const blank = (kind: ListKind): ListEntry => ({
  kind, name: '', brand: '', address: '', city: '', state: '', email: '', phone: '',
  entry_type: 'named_business', use_for_matching: 'yes', match_rule: '',
})

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i
const DOMAIN_RE = /^@[^\s@]+\.[a-z]{2,}$/i
const isEmailish = (v: string) => EMAIL_RE.test(v) || DOMAIN_RE.test(v)

/** First non-empty value among the candidate (already normalized) headers. */
function pick(byNorm: Map<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    const v = byNorm.get(c)
    if (v) return v
  }
  return ''
}

const NAME_HEADERS = ['clientnameraw', 'companyname', 'businessname', 'clientname', 'name', 'company', 'business', 'organization', 'orgname', 'org']
const EMAIL_HEADERS = ['contactsemail', 'contactemail', 'email', 'emailaddress', 'companyemail', 'personalemail', 'clientemail']
const PHONE_HEADERS = ['contactphone', 'phone', 'phonenumber', 'telephone', 'mobile', 'cellphone', 'phone1']
/** Columns that never hold the entry itself, so the simple-list fallback ignores them. */
const NOT_THE_ENTRY = new Set(['leadid', 'id', 'notes', 'note', 'confidence', 'confidencescore', 'datefound', 'source', 'sourceid', 'reviewstatus', 'status'])

/**
 * Turns spreadsheet rows (from parseCsv or parseSheetRows, header-keyed) into list
 * entries. Tolerant on purpose: a full lead-shaped sheet, the legacy do_not_contact
 * format, or a simple one-column list all work. The identifying values — business
 * name, address, email, phone — are pulled from whichever columns carry them.
 * Rows with none of name/email/phone are dropped.
 */
export function rowsToEntries(kind: ListKind, rows: Record<string, string>[]): ListEntry[] {
  const out: ListEntry[] = []
  for (const raw of rows) {
    const byNorm = new Map<string, string>()
    for (const [h, v] of Object.entries(raw)) {
      const n = normHeader(h)
      const value = (v ?? '').trim()
      if (n && value && !byNorm.has(n)) byNorm.set(n, value)
    }
    if (!byNorm.size) continue
    const values = [...byNorm.values()]
    const entryValues = [...byNorm.entries()].filter(([h]) => !NOT_THE_ENTRY.has(h)).map(([, v]) => v)
    const e = blank(kind)
    // The legacy do-not-contact sheet keeps its exact matching semantics.
    const legacy = byNorm.has('clientnameraw') && (byNorm.has('entrytype') || byNorm.has('useformatching'))
    if (legacy) {
      e.entry_type = byNorm.get('entrytype') || 'named_business'
      e.use_for_matching = byNorm.get('useformatching') || 'yes'
      e.match_rule = byNorm.get('matchrule') ?? ''
    }
    e.name = pick(byNorm, NAME_HEADERS)
    e.brand = pick(byNorm, ['brand', 'franchisebrand'])
    e.address = pick(byNorm, ['locationraw', 'address', 'streetaddress', 'street', 'location', 'addressline1'])
    e.city = pick(byNorm, ['city'])
    e.state = pick(byNorm, ['state'])
    const emailCell = pick(byNorm, EMAIL_HEADERS)
    e.email = (isEmailish(emailCell) ? emailCell : values.find(isEmailish) ?? '').toLowerCase()
    const phoneCell = pick(byNorm, PHONE_HEADERS)
    e.phone = normPhone(phoneCell) || normPhone(values.find((v) => !isEmailish(v) && normPhone(v)) ?? '')
    // Simple lists (one meaningful column) put the entry itself first.
    if (!e.name && !e.email && !e.phone) {
      const first = entryValues.find((v) => !/^\d+$/.test(v) && !/^https?:\/\//i.test(v)) ?? ''
      if (isEmailish(first)) e.email = first.toLowerCase()
      else if (normPhone(first) && !/[a-z]/i.test(first)) e.phone = normPhone(first)
      else e.name = first
    }
    if (e.name || e.email || e.phone) out.push(e)
  }
  return out
}

/**
 * Pasted entries, one per line: an email (or '@domain.com') becomes an email entry, a
 * bare phone number a phone entry, anything else with letters a business-name entry.
 */
export function linesToEntries(kind: ListKind, text: string): ListEntry[] {
  const out: ListEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const v = line.trim().replace(/,$/, '')
    if (!v) continue
    const e = blank(kind)
    if (isEmailish(v)) e.email = v.toLowerCase()
    else if (normPhone(v) && !/[a-z]/i.test(v)) e.phone = normPhone(v)
    else if (/[a-z]/i.test(v)) e.name = v
    else continue
    out.push(e)
  }
  return out
}

/** Stable identity for de-duplicating inserts: same business/name/contact twice counts once. */
export function entryDedupeKey(e: ListEntry): string {
  return [
    e.kind,
    e.email.toLowerCase(),
    e.phone,
    normName(e.name),
    streetKey(e.address),
    e.city.trim().toLowerCase(),
    e.state.trim().toUpperCase(),
    normName(e.brand),
  ].join('|')
}

/** The checkDnc view of an entry: name/brand/city/state matching, unchanged semantics. */
export function entryToDncRow(e: ListEntry): DncRow {
  return {
    client_name_raw: e.name,
    brand: e.brand,
    location_raw: e.address,
    city: e.city,
    state: e.state,
    entry_type: e.entry_type || 'named_business',
    use_for_matching: e.use_for_matching || 'yes',
    match_rule: e.match_rule ?? '',
    notes: '',
  }
}
