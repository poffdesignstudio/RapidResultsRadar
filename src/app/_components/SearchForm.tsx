'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import citiesByState from '../../data/CITIES_BY_STATE.json'

interface Params {
  niche: string
  city: string
  state: string
  zip: string
  radius: number
  sources: { google: boolean; overture: boolean; nppes: boolean; cms: boolean; crawler: boolean }
}

const DEFAULT: Params = {
  niche: 'home care',
  city: 'Charlotte',
  state: 'NC',
  zip: '',
  radius: 30,
  sources: { google: true, overture: true, nppes: true, cms: true, crawler: true },
}

const SOURCE_LABELS: [keyof Params['sources'], string][] = [
  ['google', 'Google Places (paid, capped)'],
  ['overture', 'Overture Maps (free)'],
  ['nppes', 'NPPES / NPI (free, home care only)'],
  ['cms', 'CMS Medicare data (free, home care only)'],
  ['crawler', 'Crawl business websites (free)'],
]

// State -> City picker. The dropdowns show full state names, in this order.
// The search API and gazetteer only accept the 2-letter state code
// (see src/app/api/searches/route.ts), so the selected state name is
// mapped to its code before the search is started; the city is sent
// as-is. City lists come from src/data/CITIES_BY_STATE.json
// (2020 Census populations) and are already alphabetical.
const STATE_NAMES = [
  'North Carolina',
  'South Carolina',
  'Virginia',
  'Georgia',
  'Tennessee',
  'West Virginia',
  'Kentucky',
] as const

const STATE_CODES: Record<string, string> = {
  'North Carolina': 'NC',
  'South Carolina': 'SC',
  Virginia: 'VA',
  Georgia: 'GA',
  Tennessee: 'TN',
  'West Virginia': 'WV',
  Kentucky: 'KY',
}

type CitiesByState = {
  states: Record<string, { threshold: number; cities: { city: string; population: number }[] }>
}

const CITIES_BY_STATE = (citiesByState as unknown as CitiesByState).states

export function SearchForm({ disabled }: { disabled: boolean }) {
  const router = useRouter()
  const [p, setP] = useState<Params>(DEFAULT)
  const [useZip, setUseZip] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setP((x) => ({ ...x, [k]: v }))

  const stateName = STATE_NAMES.find((name) => STATE_CODES[name] === p.state) ?? ''
  const cities = stateName ? CITIES_BY_STATE[stateName]?.cities ?? [] : []

  const onStateChange = (name: string) => {
    const nextCities = name ? CITIES_BY_STATE[name]?.cities ?? [] : []
    setP((x) => ({ ...x, state: STATE_CODES[name] ?? '', city: nextCities[0]?.city ?? '' }))
  }

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
            <label className="f">State
              <select value={stateName} onChange={(e) => onStateChange(e.target.value)} style={{ width: 170 }}>
                <option value="">Select state</option>
                {STATE_NAMES.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="f">City
              <select value={p.city} disabled={!stateName} onChange={(e) => set('city', e.target.value)} style={{ width: 160 }}>
                {stateName ? (
                  cities.map((c) => (
                    <option key={c.city} value={c.city}>{c.city}</option>
                  ))
                ) : (
                  <option value="">Select a state first</option>
                )}
              </select>
            </label>
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
