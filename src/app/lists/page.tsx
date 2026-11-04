import { ConfigAlert } from '../_components/ConfigAlert'
import { Lists } from './Lists'
import { dbConfigured } from '../../web/db'

export const dynamic = 'force-dynamic'

export default function ListsPage() {
  return (
    <>
      <h1 style={{ textAlign: 'center' }}>DO NOT CONTACT &amp; SUPPRESSION</h1>
      <ConfigAlert showOptional={false} />
      {dbConfigured() ? <Lists /> : <p className="muted">These lists are stored in the database, which is not connected yet.</p>}
    </>
  )
}
