import { handle } from '../../../../web/api'
import { q, json } from '../../../../web/db'
import { parseCsv } from '../../../../core/csv'
import { formatDate } from '../../../../core/dates'

export const dynamic = 'force-dynamic'

const NEEDED = ['client_name_raw', 'brand', 'city', 'state', 'entry_type', 'use_for_matching']

export const GET = handle(async () => {
  const rows = await q<{ row: Record<string, string>; file_name: string; imported_on: string }>('SELECT row, file_name, imported_on FROM do_not_contact')
  const count = (k: string) => Object.entries(rows.reduce<Record<string, number>>((m, r) => ((m[r.row[k] || '(blank)'] = (m[r.row[k] || '(blank)'] ?? 0) + 1), m), {}))
  return { total: rows.length, file: rows[0]?.file_name, importedOn: rows[0]?.imported_on, byType: count('entry_type'), byUse: count('use_for_matching') }
})

/** Replaces the whole do-not-contact list with the uploaded file. */
export const POST = handle(async (req: Request) => {
  const file = (await req.formData()).get('file')
  if (!(file instanceof File)) throw new Error('Choose the do_not_contact.csv file')
  const rows = parseCsv(await file.text())
  if (!rows.length) throw new Error('The file has no rows')
  const missing = NEEDED.filter((c) => !(c in rows[0]))
  if (missing.length) throw new Error(`The file is missing these columns: ${missing.join(', ')}`)
  await q('DELETE FROM do_not_contact')
  await q(`INSERT INTO do_not_contact (row, file_name, imported_on) SELECT x, $2, $3 FROM jsonb_array_elements($1) AS x`, [json(rows), file.name, formatDate()])
  return { imported: rows.length }
})
