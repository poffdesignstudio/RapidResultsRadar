import { handle } from '../../../web/api'
import { q, json } from '../../../web/db'

export const dynamic = 'force-dynamic'

/** Saved search profiles: a name plus the search form's values. */
export const GET = handle(async () => q('SELECT id, name, params FROM profiles ORDER BY name'))

export const POST = handle(async (req: Request) => {
  const { name, params } = (await req.json()) as { name: string; params: unknown }
  if (!name?.trim()) throw new Error('Give the profile a name')
  await q('INSERT INTO profiles (name, params) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET params=EXCLUDED.params', [name.trim(), json(params)])
})

export const DELETE = handle(async (req: Request) => {
  const id = Number(new URL(req.url).searchParams.get('id'))
  await q('DELETE FROM profiles WHERE id=$1', [id])
})
