import { handle } from '../../../web/api'
import { parseCsv } from '../../../core/csv'
import { parseSheetRows } from '../../../core/sheet'
import { EMAIL_LIST_LABELS, emailEntriesFromRows, emailEntriesFromText, isEmailListKind, type EmailListKind, type ParsedEmails } from '../../../match/emailLists'
import { addEmailListEntries, getListEntries, removeListEntry } from '../../../web/lists'

export const dynamic = 'force-dynamic'

const asKind = (v: FormDataEntryValue | string | null): EmailListKind => {
  if (isEmailListKind(v)) return v
  throw new Error('Say which list: kind must be "risky" or "dead"')
}

/** Both email lists with their entries, newest first: { risky: {...}, dead: {...} }. */
export const GET = handle(async () => {
  const [risky, dead] = await Promise.all([getListEntries('risky'), getListEntries('dead')])
  return {
    risky: { total: risky.length, entries: risky },
    dead: { total: dead.length, entries: dead },
  }
})

/**
 * Adds addresses to one email list, from an uploaded CSV or Excel file or from
 * typed/pasted lines (the Add-one form sends a single line). Files are read for
 * their email column (first column when no header names it). The result reports
 * added / duplicates skipped / invalid skipped. A typed submission that adds
 * nothing fails with the reason, so the Add-one form can say plainly that the
 * address is already listed or is not a valid email.
 */
export const POST = handle(async (req: Request) => {
  const form = await req.formData()
  const kind = asKind(form.get('kind'))
  const label = EMAIL_LIST_LABELS[kind]
  const file = form.get('file')
  const typed = String(form.get('values') ?? '')
  let parsed: ParsedEmails = { entries: [], invalid: 0 }
  let source = 'typed'
  if (file instanceof File) {
    source = file.name
    const name = file.name.toLowerCase()
    const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls')
      || file.type.includes('spreadsheetml') || file.type === 'application/vnd.ms-excel'
    const isCsv = name.endsWith('.csv') || file.type.includes('csv')
    if (isCsv && !isExcel) parsed = emailEntriesFromRows(kind, parseCsv(await file.text()))
    else if (isExcel) parsed = emailEntriesFromRows(kind, parseSheetRows(await file.arrayBuffer()))
    else throw new Error('Upload a CSV or Excel file')
  }
  if (typed.trim()) {
    const fromText = emailEntriesFromText(kind, typed)
    parsed = { entries: parsed.entries.concat(fromText.entries), invalid: parsed.invalid + fromText.invalid }
  }
  if (!parsed.entries.length && !parsed.invalid) throw new Error('No email addresses found. Add one address, or upload a file with an email column.')
  if (!parsed.entries.length) throw new Error(`None of the ${parsed.invalid} value${parsed.invalid === 1 ? '' : 's'} given is a valid email address.`)
  const { added, duplicates, total } = await addEmailListEntries(kind, parsed.entries, source)
  if (!(file instanceof File) && added === 0 && duplicates > 0) {
    throw new Error(`${parsed.entries[0].email} is already on the ${label} list.`)
  }
  return { added, duplicates, invalid: parsed.invalid, total }
})

/** DELETE ?id=N removes one entry from whichever email list holds it. */
export const DELETE = handle(async (req: Request) => {
  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) throw new Error('Say which entry: id must be a positive number')
  await removeListEntry(id)
  return { removed: 1 }
})
