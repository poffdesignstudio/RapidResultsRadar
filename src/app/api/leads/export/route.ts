import { handle, csvResponse } from '../../../../web/api'
import { allLeads, exportable } from '../../../../web/leads'
import { toCsv } from '../../../../core/csv'
import { COLUMNS } from '../../../../leads/columns'
import { formatDate } from '../../../../core/dates'

export const dynamic = 'force-dynamic'

export const GET = handle(async () => {
  const { rows } = await exportable(await allLeads())
  return csvResponse(toCsv(COLUMNS, rows), `rapid-radar_all-leads_${formatDate()}.csv`)
})
