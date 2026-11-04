import { ConfigAlert } from '../_components/ConfigAlert'
import { Tracker } from './Tracker'
import { dbConfigured } from '../../web/db'

export const dynamic = 'force-dynamic'

export default function TrackerPage() {
  return (
    <>
      <h1>Campaign tracker</h1>
      <ConfigAlert />
      {dbConfigured() ? <Tracker /> : <p className="muted">Tracker leads appear here once the database is connected.</p>}
    </>
  )
}
