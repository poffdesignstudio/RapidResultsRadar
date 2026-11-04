import { handle, csvResponse } from '../../../../web/api'
import { TRACKER_EXPORT_COLUMNS, trackerExportRows } from '../../../../web/tracker'
import { toCsv } from '../../../../core/csv'
import { formatDate } from '../../../../core/dates'

export const dynamic = 'force-dynamic'

export const GET = handle(async () => csvResponse(toCsv(TRACKER_EXPORT_COLUMNS, await trackerExportRows()), `rapid-radar_tracker_${formatDate()}.csv`))
