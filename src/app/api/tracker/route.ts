import { handle } from '../../../web/api'
import { createManualTrackerLead, listTrackerLeads, type TrackerField } from '../../../web/tracker'

export const dynamic = 'force-dynamic'

const campaignIdOf = (req: Request) => {
  const id = Number(new URL(req.url).searchParams.get('campaign_id'))
  if (!Number.isInteger(id) || id <= 0) throw new Error('Choose a campaign first (campaign_id is required)')
  return id
}

export const GET = handle(async (req: Request) => ({ leads: await listTrackerLeads(campaignIdOf(req)) }))

/** One hand-entered lead: do-not-contact screened, "Manual entry" source, MANUAL- lead ID. */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as Partial<Record<TrackerField, string>> & { campaign_id?: number }
  const campaignId = Number(body.campaign_id)
  if (!Number.isInteger(campaignId) || campaignId <= 0) throw new Error('Choose a campaign first (campaign_id is required)')
  return createManualTrackerLead(campaignId, body)
})
