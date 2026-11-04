import { handle } from '../../../web/api'
import { allLeads, deleteLeads } from '../../../web/leads'

export const dynamic = 'force-dynamic'
export const GET = handle(async () => ({ leads: await allLeads() }))

/** Bulk delete from the All leads page: body { ids: [lead_id, ...] }. Deletes only from the leads pool. */
export const DELETE = handle(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown }
  if (!Array.isArray(body.ids)) throw new Error('Send the leads to delete as { ids: [...] }')
  return { deleted: await deleteLeads(body.ids.map((v) => String(v))) }
})
