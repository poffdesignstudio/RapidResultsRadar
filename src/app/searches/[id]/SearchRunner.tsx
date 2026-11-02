'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LeadsTable } from '../../_components/LeadsTable'

interface Search {
  id: number; status: string; phase: string; error: string | null; report: string | null; log: string[]
  params: { niche: string; city?: string; state?: string; zip?: string; radius: number }
  state: { counts?: { kept: number; excluded: number } }
  progress: { pct: number; label: string }
}
type Row = Record<string, string>

/**
 * Runs a search one step at a time from the browser and shows progress. Progress is saved after
 * every step, so closing the page pauses the search and opening it again continues it.
 */
export function SearchRunner({ id }: { id: number }) {
  const [search, setSearch] = useState<Search | null>(null)
  const [leads, setLeads] = useState<Row[]>([])
  const [leftOut, setLeftOut] = useState<{ lead_id: string; company_name: string; city: string; reason: string }[]>([])
  const [tab, setTab] = useState<'leads' | 'left' | 'report' | 'log'>('leads')
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const running = useRef(false)
  const pausedRef = useRef(false)

  const load = useCallback(async (rows = true) => {
    const res = await fetch(`/api/searches/${id}${rows ? '' : '?rows=0'}`)
    const j = await res.json()
    if (!res.ok) throw new Error(j.error)
    setSearch(j.search)
    if (rows) { setLeads(j.leads); setLeftOut(j.leftOut) }
    return j.search as Search
  }, [id])

  const run = useCallback(async () => {
    if (running.current) return
    running.current = true
    setError('')
    try {
      let s = await load(false)
      let lastPhase = s.phase
      while ((s.status === 'queued' || s.status === 'running') && !pausedRef.current) {
        const res = await fetch(`/api/searches/${id}/step`, { method: 'POST' })
        const j = await res.json().catch(() => ({ error: `The server returned ${res.status}` }))
        if (!res.ok) {
          // A timed-out step leaves its lock for 5 minutes; wait and check again rather than stop.
          setError(`${j.error ?? 'Step failed'}. Retrying in 20 seconds…`)
          await new Promise((r) => setTimeout(r, 20000))
          s = await load(false)
          continue
        }
        setError('')
        s = j.search
        setSearch(s)
        // Refresh the table once businesses are matched, every few crawl batches, and at the end.
        if (s.phase !== lastPhase || s.status !== 'running') { await load(true); lastPhase = s.phase }
      }
      await load(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      running.current = false
    }
  }, [id, load])

  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { load(true).then((s) => { if (s.status === 'queued' || s.status === 'running') run() }).catch((e) => setError(e.message)) }, [load, run])

  const retry = async () => {
    await fetch(`/api/searches/${id}/retry`, { method: 'POST' })
    setPaused(false)
    pausedRef.current = false
    run()
  }
  const resume = () => { setPaused(false); pausedRef.current = false; run() }

  if (!search) return error ? <div className="alert bad">{error}</div> : <p className="muted">Loading…</p>
  const p = search.params
  const active = search.status === 'queued' || search.status === 'running'
  return (
    <>
      <h1>Search #{search.id}: {p.niche} within {p.radius} mi of {p.zip ? `ZIP ${p.zip}` : `${p.city}, ${p.state}`}</h1>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className={`badge ${search.status}`}>{search.status}</span>{' '}
            <span>{search.progress.label}</span>
            {search.state.counts && <span className="muted"> · {search.state.counts.kept} leads, {search.state.counts.excluded} left out</span>}
          </div>
          <div className="row">
            {active && !paused && <button className="ghost" onClick={() => setPaused(true)}>Pause</button>}
            {active && paused && <button onClick={resume}>Resume</button>}
            {search.status === 'failed' && <button onClick={retry}>Retry from the failed step</button>}
            <a className="btn ghost" href={`/api/searches/${id}/export`}>Export CSV</a>
          </div>
        </div>
        <div className="bar" style={{ marginTop: 12 }}><div style={{ width: `${search.progress.pct}%` }} /></div>
        {active && <div className="small muted" style={{ marginTop: 6 }}>{paused ? 'Paused. Progress is saved.' : 'Keep this page open while the search runs. Progress is saved after every step; if you close it, open it again to continue.'}</div>}
        {search.error && <div className="alert bad" style={{ marginTop: 12 }}>{search.error}</div>}
        {error && <div className="alert" style={{ marginTop: 12 }}>{error}</div>}
      </div>
      <div className="tabs">
        <button className={tab === 'leads' ? 'on' : ''} onClick={() => setTab('leads')}>Leads ({leads.length})</button>
        <button className={tab === 'left' ? 'on' : ''} onClick={() => setTab('left')}>Left out ({leftOut.length})</button>
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>Report</button>
        <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Log</button>
      </div>
      {tab === 'leads' && (leads.length ? <LeadsTable rows={leads} /> : <p className="muted">{active ? 'Leads appear here once businesses are matched.' : 'No leads.'}</p>)}
      {tab === 'left' && (
        <div className="gridwrap" style={{ marginTop: 10 }}>
          <table className="grid">
            <thead><tr><th>Company</th><th>City</th><th>Why it was left out</th><th>Lead ID</th></tr></thead>
            <tbody>{leftOut.map((r) => <tr key={r.lead_id}><td>{r.company_name}</td><td>{r.city}</td><td title={r.reason}>{r.reason}</td><td>{r.lead_id}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {tab === 'report' && <pre className="report">{search.report ?? 'The report appears when the search finishes.'}</pre>}
      {tab === 'log' && <pre className="report">{search.log.join('\n') || 'No log yet.'}</pre>}
    </>
  )
}
