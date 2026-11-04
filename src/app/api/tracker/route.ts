import { handle } from '../../../web/api'
import { createTrackerLead, listTrackerLeads, type TrackerField } from '../../../web/tracker'

export const dynamic = 'force-dynamic'

export const GET = handle(async () => ({ leads: await listTrackerLeads() }))

export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as Partial<Record<TrackerField, string>> & { campaign?: string }
  return createTrackerLead(body)
})
