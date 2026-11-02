import { ConfigAlert } from '../../_components/ConfigAlert'
import { SearchRunner } from './SearchRunner'

export const dynamic = 'force-dynamic'

export default async function SearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <>
      <ConfigAlert />
      <SearchRunner id={Number(id)} />
    </>
  )
}
