'use client'
import { useEffect, useMemo, useState } from 'react'
import {
  CAMPAIGNS, CAMPAIGN_LABELS, OUTCOMES, OUTREACH_STAGES, campaignShortLabel, isOutcome,
  nextStage, stageLabel, stagesForCampaign, type Campaign,
} from '../../tracker/stages'

interface Lead {
  id: number
  company_name: string
  segment: string
  franchise_brand: string
  contact_name: string
  contact_title: string
  personal_email: string
  company_email: string
  phone: string
  contact_phone: string
  address: string
  city: string
  state: string
  zip: string
  website: string
  linkedin_url: string
  facebook_url: string
  source: string
  notes: string
  campaign: Campaign
  stage: string
  stage_updated_at: string
  skip_website_form: boolean
  skip_facebook_dm: boolean
}

interface HistoryEntry { from_stage: string | null; to_stage: string; source: string; changed_at: string }
interface ImportSummary { rows: number; added: number; updated: number; skippedSuppressed: number; suppressedReasons: string[]; errors: { row: number; message: string }[] }

const FIELDS: [keyof Lead, string][] = [
  ['company_name', 'Company'], ['segment', 'Segment / niche'], ['franchise_brand', 'Brand'],
  ['contact_name', 'Contact'], ['contact_title', 'Title'], ['personal_email', 'Personal email'],
  ['company_email', 'Company email'], ['phone', 'Phone'], ['contact_phone', 'Contact phone (cell / landline)'],
  ['address', 'Address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'],
  ['website', 'Website'], ['linkedin_url', 'LinkedIn URL'], ['facebook_url', 'Facebook URL'],
  ['source', 'Source'], ['notes', 'Notes'],
]
const PAGE = 100

const badgeClass = (stage: string) =>
  stage === 'WON' ? 'verified' : stage === 'LOST' || stage === 'NO CONTACT' ? 'no' : isOutcome(stage) ? 'pending' : 'generic'

export function Tracker() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'all' | 'call' | 'outcomes'>('all')
  const [stageFilter, setStageFilter] = useState('')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<number | null>(null)
  const [history, setHistory] = useState<Record<number, HistoryEntry[]>>({})
  const [draft, setDraft] = useState<Partial<Lead> | null>(null)
  const [adding, setAdding] = useState(false)
  const [newLead, setNewLead] = useState<Partial<Lead>>({ campaign: 'EMAIL' })

  const load = () =>
    fetch('/api/tracker')
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setLeads(j.leads) })
      .catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of leads ?? []) m.set(l.stage, (m.get(l.stage) ?? 0) + 1)
    return m
  }, [leads])

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (leads ?? []).filter((l) => {
      if (view === 'call' && l.stage !== 'CALL OUTREACH') return false
      if (view === 'outcomes' && !isOutcome(l.stage)) return false
      if (stageFilter && l.stage !== stageFilter) return false
      if (f && !Object.values(l).some((v) => typeof v === 'string' && v.toLowerCase().includes(f))) return false
      return true
    })
  }, [leads, view, stageFilter, filter])
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE)

  const patch = async (id: number, body: unknown) => {
    setError('')
    const res = await fetch(`/api/tracker/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setError(j.error ?? 'Save failed'); return null }
    load()
    return j as Lead
  }

  const toggleOpen = async (l: Lead) => {
    if (openId === l.id) { setOpenId(null); setDraft(null); return }
    setOpenId(l.id)
    setDraft({ ...l })
    if (!history[l.id]) {
      const res = await fetch(`/api/tracker/${l.id}`)
      const j = await res.json().catch(() => ({}))
      if (res.ok) setHistory((h) => ({ ...h, [l.id]: j.history ?? [] }))
    }
  }

  const saveDraft = async (l: Lead) => {
    if (!draft) return
    const fields: Record<string, string> = {}
    for (const [k] of FIELDS) fields[k] = String(draft[k] ?? '')
    await patch(l.id, {
      fields,
      campaign: draft.campaign ?? l.campaign,
      skips: { skip_website_form: !!draft.skip_website_form, skip_facebook_dm: !!draft.skip_facebook_dm },
    })
    setOpenId(null)
    setDraft(null)
  }

  const addLead = async () => {
    setError('')
    const res = await fetch('/api/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newLead) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return setError(j.error ?? 'Could not add the lead')
    setAdding(false)
    setNewLead({ campaign: 'EMAIL' })
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
    const res = await fetch('/api/tracker/import', { method: 'POST', body: fd })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    e.target.value = ''
    if (!res.ok) return setError(j.error ?? 'Import failed')
    setSummary(j)
    load()
  }

  const form = (values: Partial<Lead>, set: (v: Partial<Lead>) => void, showSkips: boolean) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
      <label className="small" style={{ display: 'block' }}>
        <span className="muted">Campaign</span>
        <select value={values.campaign ?? 'EMAIL'} onChange={(e) => set({ ...values, campaign: e.target.value as Campaign })} style={{ width: '100%' }}>
          {CAMPAIGNS.map((campaign) => <option key={campaign} value={campaign}>{CAMPAIGN_LABELS[campaign]}</option>)}
        </select>
      </label>
      {FIELDS.map(([k, label]) => (
        <label key={k} className="small" style={{ display: 'block' }}>
          <span className="muted">{label}</span>
          <input value={String(values[k] ?? '')} onChange={(e) => set({ ...values, [k]: e.target.value })} style={{ width: '100%' }} />
        </label>
      ))}
      {showSkips && (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={!!values.skip_website_form} onChange={(e) => set({ ...values, skip_website_form: e.target.checked })} />
            No website form — skip stage 8
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={!!values.skip_facebook_dm} onChange={(e) => set({ ...values, skip_facebook_dm: e.target.checked })} />
            No Facebook page — skip stage 9
          </label>
        </div>
      )}
    </div>
  )

  return (
    <>
      <div className="panel">
        <div className="row" style={{ alignItems: 'center' }}>
          <a className="btn" href="/api/tracker/export">Export tracker (CSV)</a>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>
            {busy ? 'Importing…' : 'Import spreadsheet (CSV)'}
            <input type="file" accept=".csv,text/csv" onChange={importFile} style={{ display: 'none' }} disabled={busy} />
          </label>
          <button className="btn ghost" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add a lead'}</button>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Importing matches rows on company name + phone (email as a fallback) and only refreshes contact details —
          a lead&apos;s stage is never changed by an import. Rows on the do-not-contact or suppression list are skipped.
        </div>
        {adding && (
          <div style={{ marginTop: 14 }}>
            {form(newLead, setNewLead, false)}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={addLead}>Add lead</button>
            </div>
          </div>
        )}
        {summary && (
          <div className="alert ok" style={{ marginTop: 12 }}>
            Imported {summary.rows} rows: {summary.added} added, {summary.updated} updated, {summary.skippedSuppressed} skipped
            (do-not-contact / suppression){summary.suppressedReasons.length > 0 && <> — {summary.suppressedReasons.slice(0, 5).join('; ')}</>}.
            {summary.errors.length > 0 && <> {summary.errors.length} rows had errors ({summary.errors.slice(0, 3).map((e) => `row ${e.row}: ${e.message}`).join('; ')}).</>}
          </div>
        )}
      </div>

      <div className="gridtools">
        <div className="row">
          <button className={view === 'all' ? 'btn' : 'btn ghost'} onClick={() => { setView('all'); setPage(0) }}>All leads</button>
          <button className={view === 'call' ? 'btn' : 'btn ghost'} onClick={() => { setView('call'); setPage(0) }}>Call list ({counts.get('CALL OUTREACH') ?? 0})</button>
          <button className={view === 'outcomes' ? 'btn' : 'btn ghost'} onClick={() => { setView('outcomes'); setPage(0) }}>Outcomes</button>
        </div>
        <select value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(0) }}>
          <option value="">All stages ({leads?.length ?? 0})</option>
          {OUTREACH_STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)} ({counts.get(s) ?? 0})</option>)}
          {OUTCOMES.map((s) => <option key={s} value={s}>{stageLabel(s)} ({counts.get(s) ?? 0})</option>)}
        </select>
        <input placeholder="Filter rows…" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0) }} style={{ minWidth: 200 }} />
        <span className="muted small">{shown.length} of {leads?.length ?? 0} leads</span>
      </div>

      {error && <div className="alert bad">{error}</div>}
      {!leads ? <p className="muted">Loading…</p> : (
        <div className="gridwrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Company</th><th>Campaign</th><th>Contact</th><th>Personal email</th><th>Company email</th><th>Phone</th>
                <th>City</th><th>State</th><th>Stage</th><th>In stage since</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((l) => {
                const next = nextStage(l.stage, l)
                const open = openId === l.id
                return [
                  <tr key={l.id}>
                    <td title={l.company_name}>{l.company_name}</td>
                    <td><span className="badge generic">{campaignShortLabel(l.campaign)}</span></td>
                    <td title={l.contact_name}>{l.contact_name}</td>
                    <td>{l.personal_email ? <a href={`mailto:${l.personal_email}`}>{l.personal_email}</a> : ''}</td>
                    <td>{l.company_email}</td>
                    <td>{l.phone || l.contact_phone}</td>
                    <td>{l.city}</td>
                    <td>{l.state}</td>
                    <td><span className={`badge ${badgeClass(l.stage)}`}>{stageLabel(l.stage)}</span></td>
                    <td>{new Date(l.stage_updated_at).toLocaleDateString()}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {next && <button className="ghost" title={`Next: ${stageLabel(next)}`} onClick={() => patch(l.id, { advance: true })}>Advance ▸</button>}
                      <select value="" title="Set stage / outcome" onChange={(e) => { if (e.target.value) patch(l.id, { stage: e.target.value }) }} style={{ maxWidth: 130 }}>
                        <option value="">Set stage…</option>
                        {stagesForCampaign(l.campaign).map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                        {OUTCOMES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                      </select>
                      <button className="ghost" onClick={() => toggleOpen(l)}>{open ? 'Close' : 'Details'}</button>
                    </td>
                  </tr>,
                  open && draft ? (
                    <tr key={`${l.id}-detail`}>
                      <td colSpan={11} style={{ whiteSpace: 'normal', maxWidth: 'none', background: 'var(--panel-2)' }}>
                        {form(draft, setDraft, true)}
                        <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
                          <button className="btn" onClick={() => saveDraft(l)}>Save changes</button>
                          <span className="small muted">
                            Skipped for this lead: {[l.skip_website_form ? 'website form' : '', l.skip_facebook_dm ? 'Facebook DM' : ''].filter(Boolean).join(', ') || 'none'}
                          </span>
                        </div>
                        {(history[l.id] ?? []).length > 0 && (
                          <div className="small" style={{ marginTop: 12 }}>
                            <div className="muted">Stage history</div>
                            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                              {history[l.id].map((h, i) => (
                                <li key={i}>{new Date(h.changed_at).toLocaleString()}: {h.from_stage ? stageLabel(h.from_stage) : 'new lead'} → {stageLabel(h.to_stage)} <span className="muted">({h.source})</span></li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null,
                ]
              })}
              {!pageRows.length && <tr><td colSpan={11} className="muted">No leads in this view yet. Import a spreadsheet or add a lead.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="pager">
          <button className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span className="small muted">Page {page + 1} of {pages}</span>
          <button className="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}
    </>
  )
}
