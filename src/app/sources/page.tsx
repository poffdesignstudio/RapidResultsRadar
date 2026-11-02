import { ConfigAlert } from '../_components/ConfigAlert'
import { Sources } from './Sources'
import { dbConfigured } from '../../web/db'

export const dynamic = 'force-dynamic'

export default function SourcesPage() {
  return (
    <>
      <h1>Sources &amp; calls</h1>
      <ConfigAlert />
      {dbConfigured() ? <Sources /> : <p className="muted">Source settings and call counters are stored in the database, which is not connected yet.</p>}
    </>
  )
}
