import { handle } from '../../../../../web/api'
import { progressOf, stepSearch } from '../../../../../web/job'

export const dynamic = 'force-dynamic'
// One step can download large open-data files or crawl a batch of websites.
export const maxDuration = 300

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await stepSearch(Number((await ctx.params).id))
  return { search: { ...s, progress: progressOf(s) } }
})
