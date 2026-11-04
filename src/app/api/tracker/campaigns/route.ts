import { handle } from '../../../../web/api'
import { createTrackerCampaign, listTrackerCampaigns } from '../../../../web/tracker'

export const dynamic = 'force-dynamic'

export const GET = handle(async () => ({ campaigns: await listTrackerCampaigns() }))

export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as { name?: string; type?: string }
  return createTrackerCampaign(body.name ?? '', body.type)
})
