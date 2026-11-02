import { handle } from '../../../../web/api'
import { updateLeadCell } from '../../../../web/leads'

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { col, value } = (await req.json()) as { col: string; value: string }
  await updateLeadCell((await ctx.params).id, col, String(value ?? '').trim())
})
