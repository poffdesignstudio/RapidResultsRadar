'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Params {
  niche: string; city: string; state: string; zip: string; radius: number
  sources: { google: boolean; overture: boolean; nppes: boolean; cms: boolean; crawler: boolean }
}

const DEFAULT: Params = {
  niche: 'home care', city: 'Charlotte', state: 'NC', zip: '', radius: 30,
  sources: { google: true, overture: true, nppes: true, cms: true, crawler: true },
}
const SOURCE_LABELS: [keyof Params['sources'], string][] = [
  ['google', 'Google Places (paid, capped)'],
  ['overture', 'Overture Maps (free)'],
  ['nppes', 'NPPES / NPI (free, home care only)'],
  ['cms', 'CMS Medicare data (free, home care only)'],
  ['crawler', 'Crawl business websites (free)'],
]

export function SearchForm({ disabled }: { disabled: boolean }) {
  const router = useRouter()
  const [p, setP] = useState<Params>(DEFAULT)
  const [useZip, setUseZip] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setP((x) => ({ ...x, [k]: v }))
  const body = () => ({ ...p, city: useZip ? '' : p.city, state: useZip ? '' : p.state, zip: useZip ? p.zip : '' })

  const start = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch('/api/searches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(j.error ?? 'Could not start the search')
    router.push(`/searches/${j.id}`)
  }

  return (
    <form className="panel" onSubmit={start}>
      <div className="row">
        <label className="f">Niche
          <input value={p.niche} onChange={(e) => set('niche', e.target.value)} placeholder="home care" style={{ width: 200 }} />
        </label>
        <label className="f">Location by
          <select value={useZip ? 'zip' : 'city'} onChange={(e) => setUseZip(e.target.value === 'zip')}>
            <option value="city">City and state</option>
            <option value="zip">ZIP code</option>
          </select>
        </label>
        {useZip ? (
          <label className="f">ZIP<input value={p.zip} onChange={(e) => set('zip', e.target.value)} placeholder="28202" style={{ width: 90 }} inputMode="numeric" /></label>
        ) : (
          <>
            <label className="f">City<input value={p.city} onChange={(e) => set('city', e.target.value)} placeholder="Charlotte" style={{ width: 160 }} /></label>
            <label className="f">State<input value={p.state} onChange={(e) => set('state', e.target.value.toUpperCase())} placeholder="NC" maxLength={2} style={{ width: 60 }} /></label>
          </>
        )}
        <label className="f">Radius (miles)
          <input type="number" min={1} max={100} value={p.radius} onChange={(e) => set('radius', Number(e.target.value))} style={{ width: 90 }} />
        </label>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="small muted" style={{ marginBottom: 6 }}>Sources</div>
        <div className="checks">
          {SOURCE_LABELS.map(([k, label]) => (
            <label key={k}><input type="checkbox" checked={p.sources[k]} onChange={(e) => set('sources', { ...p.sources, [k]: e.target.checked })} /> {label}</label>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>&quot;home care&quot; and &quot;home health&quot; both search home care and home health agencies. Google stops at the caps set on the Sources page.</div>
      </div>
      {error && <div className="alert bad" style={{ marginTop: 12 }}>{error}</div>}
      <div style={{ marginTop: 16 }}>
        <button disabled={disabled || busy}>{busy ? 'Starting…' : 'Start search'}</button>
      </div>
    </form>
  )
}
