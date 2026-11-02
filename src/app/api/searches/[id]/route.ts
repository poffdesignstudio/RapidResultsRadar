import { handle } from '../../../../web/api'
import { q1 } from '../../../../web/db'
import { progressOf, type SearchRow } from '../../../../web/job'
import { leadsForSearch, leftOutForSearch } from '../../../../web/leads'

export const dynamic = 'force-dynamic'

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id)
  const s = await q1<SearchRow>('SELECT * FROM searches WHERE id=$1', [id])
  if (!s) throw new Error(`Search ${id} not found`)
  const withRows = new URL(req.url).searchParams.get('rows') !== '0'
  return {
    search: { ...s, progress: progressOf(s) },
    leads: withRows ? await leadsForSearch(id) : undefined,
    leftOut: withRows ? await leftOutForSearch(id) : undefined,
  }
})
