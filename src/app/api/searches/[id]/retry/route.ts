import { handle } from '../../../../../web/api'
import { retrySearch } from '../../../../../web/job'

export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await retrySearch(Number((await ctx.params).id))
})
