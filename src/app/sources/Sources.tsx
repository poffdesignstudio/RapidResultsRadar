'use client'
import { useEffect, useState } from 'react'

interface S {
  source: string; label: string; paid: boolean; built: boolean; enabled: boolean
  max_per_run: number; max_per_month: number; calls_this_month: number; cost_per_1000: number; free_per_month: number; note: string
}

const month = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}` }

export function Sources() {
  const [rows, setRows] = useState<S[]>([])
  const [googleKey, setGoogleKey] = useState(true)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => fetch('/api/sources').then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setRows(j.sources); setGoogleKey(j.googleKey) }).catch((e) => setMsg({ ok: false, text: e.message }))
  useEffect(() => { load() }, [])

  const update = async (source: string, patch: Partial<S>) => {
    setMsg(null)
    const res = await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, ...patch }) })
    const j = await res.json()
    if (!res.ok) return setMsg({ ok: false, text: j.error })
    setRows(j.sources)
    setMsg({ ok: true, text: 'Saved.' })
  }

  const cost = (s: S) => {
    const billable = Math.max(0, s.calls_this_month - s.free_per_month)
    return `$${((s.calls_this_month / 1000) * s.cost_per_1000).toFixed(2)} list · $${((billable / 1000) * s.cost_per_1000).toFixed(2)} after free calls`
  }

  return (
    <>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      <div className="gridwrap">
        <table className="grid">
          <thead><tr><th>Source</th><th>On</th><th>Paid</th><th>Calls in {month()}</th><th>Max per search</th><th>Max per month</th><th>Est. cost this month</th><th>Notes</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.source}>
                <td>{s.label}{s.source === 'google' && !googleKey && <div className="small" style={{ color: 'var(--warn)' }}>GOOGLE_PLACES_API_KEY not set in Vercel</div>}</td>
                <td><input type="checkbox" checked={s.enabled} disabled={!s.built} onChange={(e) => update(s.source, { enabled: e.target.checked })} /></td>
                <td>{s.paid ? 'yes' : 'free'}</td>
                <td className="num">{s.paid ? s.calls_this_month : '—'}</td>
                <td>{s.paid && s.built ? <NumberCell value={s.max_per_run} onSave={(v) => update(s.source, { max_per_run: v })} /> : '—'}</td>
                <td>{s.paid && s.built ? <NumberCell value={s.max_per_month} onSave={(v) => update(s.source, { max_per_month: v })} /> : '—'}</td>
                <td>{s.paid && s.built ? cost(s) : '—'}</td>
                <td className="small muted" style={{ whiteSpace: 'normal', minWidth: 260 }}>{s.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">A search stops calling a paid source when it reaches either cap. Turning a free source off here turns it off for every search; the search form also lets you skip sources one search at a time. Google pricing shown is not confirmed; check Google&apos;s pricing page.</p>
    </>
  )
}

function NumberCell({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  return <input type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => Number(v) !== value && onSave(Number(v))} style={{ width: 90 }} />
}
