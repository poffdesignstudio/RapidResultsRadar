import { handle } from '../../../../web/api'
import { advanceTrackerLead, getTrackerLead, setTrackerStage, updateTrackerLead, type TrackerField } from '../../../../web/tracker'

export const dynamic = 'force-dynamic'

const idOf = async (ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id)
  if (!Number.isInteger(id) || id <= 0) throw new Error('Bad lead id')
  return id
}

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const lead = await getTrackerLead(await idOf(ctx))
  if (!lead) throw new Error('Lead not found')
  return lead
})

interface PatchBody {
  fields?: Partial<Record<TrackerField, string>>
  skips?: { skip_website_form?: boolean; skip_facebook_dm?: boolean }
  stage?: string
  advance?: boolean
}

/** One call can edit contact fields / skip flags, then optionally move the stage. */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = await idOf(ctx)
  const body = (await req.json()) as PatchBody
  let lead = body.fields || body.skips
    ? await updateTrackerLead(id, body.fields ?? {}, body.skips)
    : undefined
  if (body.advance) lead = await advanceTrackerLead(id)
  else if (body.stage) lead = await setTrackerStage(id, body.stage)
  return lead ?? getTrackerLead(id)
})
