import { handle } from '../../../web/api'
import { allLeads } from '../../../web/leads'

export const dynamic = 'force-dynamic'
export const GET = handle(async () => ({ leads: await allLeads() }))
