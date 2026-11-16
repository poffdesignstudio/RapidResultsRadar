import { entryDedupeKey, isEmailAddress, type ListEntry } from './listEntries.js'

/**
 * The two email-only reference lists the bulk email searches produce: 'risky' =
 * addresses a verifier flagged as risky, 'dead' = addresses that are undeliverable.
 * They live in the same `list_entries` table as the do-not-contact lists, under
 * their own kinds, and entries carry just the email (lowercased). Unlike 'client'
 * and 'suppression', these lists screen NOTHING — no search, export or campaign
 * reads them; they are standing records Leia maintains from each bulk search.
 */
export type EmailListKind = 'risky' | 'dead'

export const EMAIL_LIST_KINDS: EmailListKind[] = ['risky', 'dead']

export const EMAIL_LIST_LABELS: Record<EmailListKind, string> = {
  risky: 'Risky Emails',
  dead: 'Dead Emails',
}

export const isEmailListKind = (v: unknown): v is EmailListKind => v === 'risky' || v === 'dead'

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Headers that name the email column, most specific first (compared normalized). */
const EMAIL_HEADERS = ['contactsemail', 'contactemail', 'emailaddress', 'email', 'companyemail', 'personalemail', 'clientemail']

export interface ParsedEmails {
  entries: ListEntry[]
  /** Non-empty values that were not a usable email address. */
  invalid: number
}

const emailEntry = (kind: EmailListKind, email: string): ListEntry => ({
  kind, name: '', brand: '', address: '', city: '', state: '', email: email.toLowerCase(), phone: '',
  entry_type: 'named_business', use_for_matching: 'yes', match_rule: '',
})

/**
 * Spreadsheet rows (from parseCsv or parseSheetRows, header-keyed) for an email
 * list: the address comes from the email column — a header that names it — or,
 * when no header does, from the row's first column. Empty cells are skipped
 * silently; anything else that is not a complete email address counts as invalid.
 */
export function emailEntriesFromRows(kind: EmailListKind, rows: Record<string, string>[]): ParsedEmails {
  const out: ListEntry[] = []
  let invalid = 0
  for (const raw of rows) {
    const byNorm = new Map<string, string>()
    for (const [h, v] of Object.entries(raw)) {
      const n = normHeader(h)
      if (n && !byNorm.has(n)) byNorm.set(n, (v ?? '').trim())
    }
    let cell = ''
    for (const c of EMAIL_HEADERS) {
      if (byNorm.get(c)) { cell = byNorm.get(c)!; break }
    }
    if (!cell) cell = (Object.values(raw)[0] ?? '').trim()
    if (!cell) continue
    if (isEmailAddress(cell)) out.push(emailEntry(kind, cell))
    else invalid++
  }
  return { entries: out, invalid }
}

/** Typed or pasted addresses, one per line; the single-add form sends one line. */
export function emailEntriesFromText(kind: EmailListKind, text: string): ParsedEmails {
  const out: ListEntry[] = []
  let invalid = 0
  for (const line of text.split(/\r?\n/)) {
    const v = line.trim().replace(/,$/, '')
    if (!v) continue
    if (isEmailAddress(v)) out.push(emailEntry(kind, v))
    else invalid++
  }
  return { entries: out, invalid }
}

/**
 * Splits parsed entries into the ones a list does not already hold and a count of
 * the duplicates — repeated inside the batch itself, or already on the list
 * (same entryDedupeKey). Keeps the two lists independent: keys carry the kind,
 * so an address on the Risky list never blocks the Dead list, or vice versa.
 */
export function summarizeImport(existingKeys: ReadonlySet<string>, entries: ListEntry[]): { fresh: ListEntry[]; duplicates: number } {
  const seen = new Set(existingKeys)
  const fresh: ListEntry[] = []
  let duplicates = 0
  for (const e of entries) {
    const key = entryDedupeKey(e)
    if (seen.has(key)) { duplicates++; continue }
    seen.add(key)
    fresh.push(e)
  }
  return { fresh, duplicates }
}
