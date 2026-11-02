import { handle } from '../../../web/api'
import { q } from '../../../web/db'
import { createSearch, progressOf, type SearchParams, type SearchRow } from '../../../web/job'

export const dynamic = 'force-dynamic'

export const GET = handle(async () => {
  const rows = await q<SearchRow>('SELECT id, created_at, params, status, phase, state, error FROM searches ORDER BY id DESC LIMIT 50')
  return rows.map((r) => ({ ...r, progress: progressOf({ ...r, log: [], report: null } as SearchRow) }))
})

export const POST = handle(async (req: Request) => {
  const p = (await req.json()) as SearchParams
  if (!p.niche?.trim()) throw new Error('Enter a niche')
  if (!p.zip && !(p.city && p.state)) throw new Error('Enter a city and state, or a ZIP code')
  if (p.zip && !/^\d{5}$/.test(p.zip)) throw new Error('ZIP code must be 5 digits')
  if (p.state && !/^[A-Za-z]{2}$/.test(p.state)) throw new Error('State must be the 2-letter code, like NC')
  const radius = Number(p.radius)
  if (!(radius > 0 && radius <= 100)) throw new Error('Radius must be between 1 and 100 miles')
  const id = await createSearch({ ...p, niche: p.niche.trim(), city: p.city?.trim(), state: p.state?.trim().toUpperCase(), radius })
  return { id }
})
