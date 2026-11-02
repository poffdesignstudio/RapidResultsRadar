'use client'
import { useEffect, useState } from 'react'

interface Dnc { total: number; file?: string; importedOn?: string; byType: [string, number][]; byUse: [string, number][] }
interface Sup { value: string; reason: string; added_on: string }

export function Lists() {
  const [dnc, setDnc] = useState<Dnc | null>(null)
  const [sup, setSup] = useState<Sup[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [typed, setTyped] = useState('')

  const load = () => {
    fetch('/api/lists/dnc').then((r) => r.json()).then(setDnc).catch(() => {})
    fetch('/api/lists/suppression').then((r) => r.json()).then((j) => setSup(Array.isArray(j) ? j : [])).catch(() => {})
  }
  useEffect(load, [])

  const post = async (url: string, fd: FormData, done: (j: Record<string, number>) => string) => {
    setMsg(null)
    const res = await fetch(url, { method: 'POST', body: fd })
    const j = await res.json()
    setMsg(res.ok ? { ok: true, text: done(j) } : { ok: false, text: j.error })
    load()
  }
  const uploadDnc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (dnc?.total && !window.confirm(`Replace the current list (${dnc.total} rows) with ${f.name}?`)) { e.target.value = ''; return }
    const fd = new FormData(); fd.append('file', f)
    post('/api/lists/dnc', fd, (j) => `Imported ${j.imported} do-not-contact rows. They apply to the next search and to every export.`)
    e.target.value = ''
  }
  const uploadSup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const fd = new FormData(); fd.append('file', f)
    post('/api/lists/suppression', fd, (j) => `Added ${j.added} addresses to the suppression list.`)
    e.target.value = ''
  }
  const addTyped = () => {
    const fd = new FormData(); fd.append('values', typed)
    post('/api/lists/suppression', fd, (j) => { setTyped(''); return `Added ${j.added} addresses.` })
  }
  const remove = async (value: string) => {
    if (!window.confirm(`Remove ${value} from the suppression list? It could then appear in exports again.`)) return
    await fetch(`/api/lists/suppression?value=${encodeURIComponent(value)}`, { method: 'DELETE' })
    load()
  }

  return (
    <>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Do-not-contact list (existing clients)</h2>
        {dnc && dnc.total > 0 ? (
          <p>{dnc.total} rows from <code>{dnc.file}</code>, imported {dnc.importedOn}. Types: {dnc.byType.map(([k, n]) => `${k} ${n}`).join(', ')}. use_for_matching: {dnc.byUse.map(([k, n]) => `${k} ${n}`).join(', ')}.</p>
        ) : (
          <div className="alert">No do-not-contact list yet. Until one is imported, searches say &quot;NOT APPLIED&quot; and exports cannot leave out existing clients.</div>
        )}
        <label className="btn" style={{ cursor: 'pointer' }}>Upload do_not_contact.csv<input type="file" accept=".csv,text/csv" onChange={uploadDnc} style={{ display: 'none' }} /></label>
        <p className="small muted">Uploading replaces the whole list. Needs the columns client_name_raw, brand, location_raw, city, state, entry_type, use_for_matching, match_rule. Only rows with use_for_matching = yes are used; franchise offices match on brand + state (+ city); named businesses match on name; place_name_only and demo_or_test rows never match; franchise rows with no state are only flagged.</p>
      </div>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Suppression list ({sup.length})</h2>
        <p className="small muted">Unsubscribed or blocked addresses. Any lead whose email is here is left out of every export. Use <code>@domain.com</code> to block a whole domain.</p>
        <div className="row">
          <textarea value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="one address per line" rows={3} style={{ minWidth: 280 }} />
          <button onClick={addTyped} disabled={!typed.trim()}>Add</button>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>Upload CSV<input type="file" accept=".csv,text/csv" onChange={uploadSup} style={{ display: 'none' }} /></label>
        </div>
        {sup.length > 0 && (
          <div className="gridwrap" style={{ marginTop: 12, maxHeight: 360 }}>
            <table className="grid">
              <thead><tr><th>Address or domain</th><th>Reason</th><th>Added</th><th></th></tr></thead>
              <tbody>{sup.map((s) => <tr key={s.value}><td>{s.value}</td><td>{s.reason}</td><td>{s.added_on}</td><td><button className="ghost" onClick={() => remove(s.value)}>Remove</button></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
