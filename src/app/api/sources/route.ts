import { handle } from '../../../web/api'
import { q } from '../../../web/db'
import { getSourceSettings } from '../../../web/stores'

export const dynamic = 'force-dynamic'

export const GET = handle(async () => ({ sources: await getSourceSettings(), googleKey: !!process.env.GOOGLE_PLACES_API_KEY }))

/** Turn a source on or off, or change a paid source's call caps. */
export const POST = handle(async (req: Request) => {
  const { source, enabled, max_per_run, max_per_month } = (await req.json()) as { source: string; enabled?: boolean; max_per_run?: number; max_per_month?: number }
  const s = (await getSourceSettings()).find((x) => x.source === source)
  if (!s) throw new Error(`Unknown source ${source}`)
  if (enabled && !s.built) throw new Error(`${s.label} is not built yet, so it cannot be turned on`)
  for (const [k, v] of [['max_per_run', max_per_run], ['max_per_month', max_per_month]] as const) {
    if (v !== undefined && !(Number.isInteger(v) && v >= 0 && v <= 100000)) throw new Error(`${k} must be a whole number from 0 to 100000`)
  }
  await q('UPDATE provider_settings SET enabled=COALESCE($2, enabled), max_per_run=COALESCE($3, max_per_run), max_per_month=COALESCE($4, max_per_month) WHERE source=$1',
    [source, enabled ?? null, max_per_run ?? null, max_per_month ?? null])
  return { sources: await getSourceSettings() }
})
