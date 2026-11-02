import { ConfigAlert } from './_components/ConfigAlert'
import { SearchForm } from './_components/SearchForm'
import { RecentSearches } from './_components/RecentSearches'
import { dbConfigured } from '../web/db'

export const dynamic = 'force-dynamic'

export default function Home() {
  const db = dbConfigured()
  return (
    <>
      <h1>New search</h1>
      <ConfigAlert />
      <SearchForm disabled={!db} />
      <h2>Searches</h2>
      {db ? <RecentSearches /> : <p className="muted">Searches appear here once the database is connected.</p>}
    </>
  )
}
