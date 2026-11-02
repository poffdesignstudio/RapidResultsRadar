import { handle, csvResponse } from '../../../../../web/api'
import { leadsForSearch, exportable } from '../../../../../web/leads'
import { toCsv } from '../../../../../core/csv'
import { COLUMNS } from '../../../../../leads/columns'
import { formatDate } from '../../../../../core/dates'

export const dynamic = 'force-dynamic'

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id)
  const { rows } = await exportable(await leadsForSearch(id))
  return csvResponse(toCsv(COLUMNS, rows), `rapid-radar_search-${id}_${formatDate()}.csv`)
})
