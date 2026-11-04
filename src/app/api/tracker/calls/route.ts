import { handle } from '../../../../web/api'
import { listCallList } from '../../../../web/tracker'

export const dynamic = 'force-dynamic'

/** Every tracker lead at CALL OUTREACH, across all campaigns — the Calls page. */
export const GET = handle(async () => ({ calls: await listCallList() }))
