import { ConfigAlert } from '../_components/ConfigAlert'
import { Calls } from './Calls'
import { dbConfigured } from '../../web/db'

export const dynamic = 'force-dynamic'

export default function CallsPage() {
  return (
    <>
      <h1>Calls</h1>
      <ConfigAlert />
      {dbConfigured() ? <Calls /> : <p className="muted">The call list appears here once the database is connected.</p>}
    </>
  )
}
