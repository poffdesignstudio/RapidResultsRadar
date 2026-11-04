import { handle, csvResponse } from '../../../../web/api'
import { TRACKER_EXPORT_COLUMNS, trackerExportRows } from '../../../../web/tracker'
import { toCsv } from '../../../../core/csv'
import { formatDate } from '../../../../core/dates'

export const dynamic = 'force-dynamic'

/** The export is scoped to one campaign: /api/tracker/export?campaign_id=N */
export const GET = handle(async (req: Request) => {
  const campaignId = Number(new URL(req.url).searchParams.get('campaign_id'))
  if (!Number.isInteger(campaignId) || campaignId <= 0) throw new Error('Choose a campaign first (campaign_id is required)')
  return csvResponse(toCsv(TRACKER_EXPORT_COLUMNS, await trackerExportRows(campaignId)), `rapid-radar_tracker_${formatDate()}.csv`)
})
