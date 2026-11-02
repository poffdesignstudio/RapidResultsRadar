import { ConfigAlert } from '../_components/ConfigAlert'
import { AllLeads } from './AllLeads'
import { dbConfigured } from '../../web/db'

export const dynamic = 'force-dynamic'

export default function LeadsPage() {
  return (
    <>
      <h1>All leads</h1>
      <ConfigAlert />
      {dbConfigured() ? <AllLeads /> : <p className="muted">Leads appear here once the database is connected.</p>}
    </>
  )
}
