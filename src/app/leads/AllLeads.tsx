'use client'
import { useEffect, useState } from 'react'
import { LeadsTable } from '../_components/LeadsTable'

interface ImportSummary { rows: number; matched: number; unknown: string[]; changed: Record<string, number>; cellsChanged: number }

export function AllLeads() {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => fetch('/api/leads').then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setRows(j.leads) }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const deleteSelected = async (ids: string[]) => {
    const res = await fetch('/api/leads', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error ?? 'Delete failed')
    setSummary(null)
    load()
  }

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    setSummary(null)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/leads/import', { method: 'POST', body: fd })
    const j = await res.json()
    setBusy(false)
    e.target.value = ''
    if (!res.ok) return setError(j.error)
    setSummary(j)
    load()
  }

  return (
    <>
      <div className="panel">
        <div className="row" style={{ alignItems: 'center' }}>
          <a className="btn" href="/api/leads/export">Export all leads (CSV)</a>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>
            {busy ? 'Importing…' : "Import Leia's CSV"}
            <input type="file" accept=".csv,text/csv" onChange={importFile} style={{ display: 'none' }} disabled={busy} />
          </label>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Exports leave out leads on the do-not-contact or suppression list and leads marked &quot;drop&quot;. Importing matches rows on lead_id and changes only the cells Leia filled in; blank cells never erase anything, and edited cells are kept on later searches.
        </div>
        {summary && (
          <div className="alert ok" style={{ marginTop: 12 }}>
            Imported {summary.rows} rows: {summary.matched} matched a lead, {summary.cellsChanged} cells changed
            {Object.keys(summary.changed).length > 0 && <> ({Object.entries(summary.changed).map(([c, n]) => `${c}: ${n}`).join(', ')})</>}.
            {summary.unknown.length > 0 && <> {summary.unknown.length} rows had a lead_id we do not know and were skipped.</>}
          </div>
        )}
      </div>
      {error && <div className="alert bad">{error}</div>}
      {rows ? <LeadsTable rows={rows} onDeleteSelected={deleteSelected} /> : <p className="muted">Loading…</p>}
    </>
  )
}
