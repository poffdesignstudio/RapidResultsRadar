import { handle } from '../../../../web/api'
import { q } from '../../../../web/db'
import { parseCsv } from '../../../../core/csv'
import { formatDate } from '../../../../core/dates'

export const dynamic = 'force-dynamic'

export const GET = handle(async () => q('SELECT value, reason, added_on FROM suppression ORDER BY added_on DESC, value LIMIT 2000'))

/** Adds addresses (or @domain.com for a whole domain) from a CSV file or a typed list. Never removes any. */
export const POST = handle(async (req: Request) => {
  const form = await req.formData()
  const file = form.get('file')
  const typed = String(form.get('values') ?? '')
  const reason = String(form.get('reason') ?? '') || 'unsubscribed'
  let values: string[] = typed.split(/[\s,;]+/)
  if (file instanceof File) {
    const rows = parseCsv(await file.text())
    values = values.concat(rows.map((r) => r.email ?? r.contact_email ?? Object.values(r)[0] ?? ''))
  }
  const clean = [...new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v) || /^@[^@\s]+\.[a-z]{2,}$/.test(v)))]
  if (!clean.length) throw new Error('No email addresses found. Use one per line, or a CSV with an "email" column.')
  await q('INSERT INTO suppression (value, reason, added_on) SELECT unnest($1::text[]), $2, $3 ON CONFLICT (value) DO NOTHING', [clean, reason, formatDate()])
  return { added: clean.length }
})

export const DELETE = handle(async (req: Request) => {
  await q('DELETE FROM suppression WHERE value=$1', [new URL(req.url).searchParams.get('value')])
})
