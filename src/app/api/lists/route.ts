import { handle } from '../../../web/api'
import { parseCsv } from '../../../core/csv'
import { parseSheetRows } from '../../../core/sheet'
import { linesToEntries, rowsToEntries, type ListEntry, type ListKind } from '../../../match/listEntries'
import { addListEntries, clearList, getListEntries, removeListEntry } from '../../../web/lists'

export const dynamic = 'force-dynamic'

const asKind = (v: FormDataEntryValue | string | null): ListKind => {
  if (v === 'client' || v === 'suppression') return v
  throw new Error('Say which list: kind must be "client" or "suppression"')
}

/** Both lists with their entries, newest first: { client: {...}, suppression: {...} }. */
export const GET = handle(async () => {
  const [client, suppression] = await Promise.all([getListEntries('client'), getListEntries('suppression')])
  return {
    client: { total: client.length, entries: client },
    suppression: { total: suppression.length, entries: suppression },
  }
})

/**
 * Adds entries to one list, from an uploaded CSV or Excel file or from pasted lines
 * (one per line). Spreadsheet rows may be full lead-shaped sheets, the legacy
 * do-not-contact format, or simple lists — the name, address, email and phone are
 * pulled from whichever columns carry them. mode=replace empties the list first
 * (the existing-clients upload pattern); the default just adds, skipping duplicates.
 */
export const POST = handle(async (req: Request) => {
  const form = await req.formData()
  const kind = asKind(form.get('kind'))
  const replace = form.get('mode') === 'replace'
  const file = form.get('file')
  const typed = String(form.get('values') ?? '')
  let entries: ListEntry[] = []
  let source = 'typed'
  if (file instanceof File) {
    source = file.name
    const name = file.name.toLowerCase()
    const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls')
      || file.type.includes('spreadsheetml') || file.type === 'application/vnd.ms-excel'
    const isCsv = name.endsWith('.csv') || file.type.includes('csv')
    if (isCsv && !isExcel) entries = rowsToEntries(kind, parseCsv(await file.text()))
    else if (isExcel) entries = rowsToEntries(kind, parseSheetRows(await file.arrayBuffer()))
    else throw new Error('Upload a CSV or Excel file')
  }
  if (typed.trim()) entries = entries.concat(linesToEntries(kind, typed))
  if (!entries.length) throw new Error('No usable entries found. Each entry needs a business name, an email, or a phone number.')
  const { added, total } = await addListEntries(entries, source, replace)
  return { added, total }
})

/** DELETE ?id=N removes one entry; DELETE ?kind=client|suppression empties that list. */
export const DELETE = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams
  const id = Number(params.get('id'))
  if (Number.isInteger(id) && id > 0) {
    await removeListEntry(id)
    return { removed: 1 }
  }
  const kind = asKind(params.get('kind'))
  return { cleared: await clearList(kind) }
})
