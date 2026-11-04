'use client'
import { useEffect, useMemo, useState } from 'react'
import {
  CAMPAIGNS, CAMPAIGN_LABELS, OUTCOMES, campaignLabel, campaignShortLabel, isOutcome,
  nextStage, stageLabel, stagesForCampaign, type Campaign,
} from '../../tracker/stages'

interface CampaignT {
  id: number
  name: string
  type: Campaign
  lead_count: number
  created_at: string
  updated_at: string
}

interface Lead {
  id: number
  campaign_id: number
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
  ext_lead_id: string
  domain: string
  est_15_employees: string
  email_status: string
  email_source: string
  company_linkedin_url: string
  contact_facebook_url: string
  bbb_url: string
  chamber_url: string
  confidence: string
  automated_flags: string
  source: string
  notes: string
  stage: string
  stage_updated_at: string
  skip_website_form: boolean
  skip_facebook_dm: boolean
}

interface HistoryEntry { from_stage: string | null; to_stage: string; source: string; changed_at: string }
interface ImportSummary { rows: number; added: number; updated: number; skippedSuppressed: number; suppressedReasons: string[]; errors: { row: number; message: string }[] }

type LeadField = keyof Lead
/** 'addressLine' is the combined Address/City/State/ZIP row: one line, four stored fields. */
type FieldSpec = [LeadField, string] | 'addressLine'

const asUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`)

/**
 * The lead detail groups, in John's order (his annotated mock used colors only to
 * tell the groups apart — the app keeps its own styling). Every stored field is here,
 * so the detail form reads and saves the whole lead.
 */
const GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: 'COMPANY INFORMATION',
    fields: [
      ['ext_lead_id', 'Lead ID'], ['company_name', 'Company name'], ['segment', 'Niche'], ['franchise_brand', 'Franchise brand'],
      ['company_email', 'Company email'], ['phone', 'Phone'], 'addressLine',
      ['website', 'Website'], ['domain', 'Domain'], ['est_15_employees', 'Estimate 15 or more employees'],
      ['confidence', 'Confidence score'], ['source', 'Source'],
    ],
  },
  {
    title: 'CONTACT INFORMATION',
    fields: [
      ['contact_name', "Contact's name"], ['contact_title', "Contact's title"], ['contact_phone', 'Contact phone'],
      ['personal_email', "Contact's email"], ['email_status', 'Email status'], ['email_source', 'Email source'],
    ],
  },
  {
    title: 'SOCIAL MEDIA',
    fields: [
      ['company_linkedin_url', 'Company LinkedIn URL'], ['facebook_url', 'Company Facebook URL'],
      ['linkedin_url', "Contact person's LinkedIn URL"], ['contact_facebook_url', "Contact personal's Facebook URL"],
      ['bbb_url', 'BBB URL'], ['chamber_url', 'Chamber of Commerce URL'],
    ],
  },
  { title: 'NOTES', fields: [['notes', 'Notes']] },
  { title: 'AUTOMATED FLAGS', fields: [['automated_flags', 'Automated flags']] },
]

const URL_FIELDS = new Set<LeadField>(['website', 'domain', 'company_linkedin_url', 'facebook_url', 'linkedin_url', 'contact_facebook_url', 'bbb_url', 'chamber_url'])
const WIDE_FIELDS = new Set<LeadField>(['notes', 'automated_flags'])

const ALL_FIELDS: LeadField[] = GROUPS.flatMap((g) =>
  g.fields.flatMap((f) => (f === 'addressLine' ? (['address', 'city', 'state', 'zip'] as LeadField[]) : [f[0]])))
const PAGE = 100

const badgeClass = (stage: string) =>
  stage === 'WON' ? 'verified' : stage === 'LOST' || stage === 'NO CONTACT' ? 'no' : isOutcome(stage) ? 'pending' : 'generic'

export function Tracker() {
  const [campaigns, setCampaigns] = useState<CampaignT[] | null>(null)
  const [openCampaignId, setOpenCampaignId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [newCampaign, setNewCampaign] = useState<{ name: string; type: Campaign }>({ name: '', type: 'EMAIL' })
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
  const [newLead, setNewLead] = useState<Partial<Lead>>({})
  const [pendingCampaignId, setPendingCampaignId] = useState<number | null>(null)
  const [pendingLeadId, setPendingLeadId] = useState<number | null>(null)

  const campaign = campaigns?.find((c) => c.id === openCampaignId) ?? null

  const loadCampaigns = () =>
    fetch('/api/tracker/campaigns')
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setCampaigns(j.campaigns) })
      .catch((e) => setError(e.message))
  useEffect(() => { loadCampaigns() }, [])

  // Deep links (e.g. from the Calls page): /tracker?campaign_id=N&lead=M opens
  // that campaign, and that lead's details, once both have loaded.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const cid = Number(params.get('campaign_id'))
    const lid = Number(params.get('lead'))
    if (Number.isInteger(cid) && cid > 0) setPendingCampaignId(cid)
    if (Number.isInteger(lid) && lid > 0) setPendingLeadId(lid)
  }, [])

  const loadLeads = (campaignId: number) =>
    fetch(`/api/tracker?campaign_id=${campaignId}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setLeads(j.leads) })
      .catch((e) => setError(e.message))

  const load = () => { if (openCampaignId) loadLeads(openCampaignId); loadCampaigns() }

  const openCampaign = (c: CampaignT) => {
    setOpenCampaignId(c.id)
    setLeads(null)
    setView('all')
    setStageFilter('')
    setFilter('')
    setPage(0)
    setOpenId(null)
    setDraft(null)
    setSummary(null)
    setError('')
    loadLeads(c.id)
  }

  const createCampaign = async () => {
    setError('')
    const res = await fetch('/api/tracker/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCampaign) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return setError(j.error ?? 'Could not create the campaign')
    setCreating(false)
    setNewCampaign({ name: '', type: 'EMAIL' })
    await loadCampaigns()
    openCampaign(j as CampaignT)
  }

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

  useEffect(() => {
    if (pendingCampaignId == null || !campaigns) return
    const c = campaigns.find((x) => x.id === pendingCampaignId)
    setPendingCampaignId(null)
    if (c) openCampaign(c)
  }, [campaigns, pendingCampaignId])

  useEffect(() => {
    if (pendingLeadId == null || !leads) return
    const l = leads.find((x) => x.id === pendingLeadId)
    setPendingLeadId(null)
    if (l) toggleOpen(l)
  }, [leads, pendingLeadId])

  const saveDraft = async (l: Lead) => {
    if (!draft) return
    const fields: Record<string, string> = {}
    for (const k of ALL_FIELDS) fields[k] = String(draft[k] ?? '')
    await patch(l.id, {
      fields,
      skips: { skip_website_form: !!draft.skip_website_form, skip_facebook_dm: !!draft.skip_facebook_dm },
    })
    setOpenId(null)
    setDraft(null)
  }

  const addLead = async () => {
    if (!campaign) return
    setError('')
    const res = await fetch('/api/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newLead, campaign_id: campaign.id }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return setError(j.error ?? 'Could not add the lead')
    setAdding(false)
    setNewLead({})
    load()
  }

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !campaign) return
    setBusy(true)
    setError('')
    setSummary(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('campaign_id', String(campaign.id))
    const res = await fetch('/api/tracker/import', { method: 'POST', body: fd })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    e.target.value = ''
    if (!res.ok) return setError(j.error ?? 'Import failed')
    setSummary(j)
    load()
  }

  const fieldCell = (values: Partial<Lead>, set: (v: Partial<Lead>) => void, k: LeadField, label: string) => {
    const v = String(values[k] ?? '')
    return (
      <label className="small" style={{ display: 'block' }}>
        <span className="muted">{label}</span>
        {WIDE_FIELDS.has(k) ? (
          <textarea value={v} rows={3} onChange={(e) => set({ ...values, [k]: e.target.value })} style={{ width: '100%' }} />
        ) : (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={v} onChange={(e) => set({ ...values, [k]: e.target.value })} style={{ flex: 1, width: '100%' }} />
            {URL_FIELDS.has(k) && v.trim() !== '' && (
              <a href={asUrl(v.trim())} target="_blank" rel="noreferrer" title={`Open ${label}`}>↗</a>
            )}
          </span>
        )}
      </label>
    )
  }

  /** The grouped field form (Company / Contact / Social / Notes / Flags), used by Add and Details. */
  const groupedForm = (values: Partial<Lead>, set: (v: Partial<Lead>) => void) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div style={{ fontWeight: 700, letterSpacing: '.05em', fontSize: 12, marginBottom: 8 }}>{g.title}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
            {g.fields.map((f) => {
              if (f === 'addressLine') {
                return (
                  <div key="addressLine" className="small" style={{ gridColumn: '1 / -1' }}>
                    <span className="muted">Address, City, State, ZIP</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input placeholder="Address" value={String(values.address ?? '')} onChange={(e) => set({ ...values, address: e.target.value })} style={{ flex: 3 }} />
                      <input placeholder="City" value={String(values.city ?? '')} onChange={(e) => set({ ...values, city: e.target.value })} style={{ flex: 2 }} />
                      <input placeholder="State" value={String(values.state ?? '')} onChange={(e) => set({ ...values, state: e.target.value })} style={{ flex: '0 0 72px' }} />
                      <input placeholder="ZIP" value={String(values.zip ?? '')} onChange={(e) => set({ ...values, zip: e.target.value })} style={{ flex: '0 0 104px' }} />
                    </div>
                  </div>
                )
              }
              const [k, label] = f
              return (
                <div key={k} style={WIDE_FIELDS.has(k) ? { gridColumn: '1 / -1' } : undefined}>
                  {fieldCell(values, set, k, label)}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )

  if (!campaign) {
    return (
      <>
        {error && <div className="alert bad">{error}</div>}
        <div className="panel">
          <div className="row" style={{ alignItems: 'center' }}>
            <strong>Campaigns</strong>
            <button className="btn ghost" onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : 'New campaign'}</button>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>
            A campaign holds the leads being worked. Its type — Email outreach or DM LinkedIn — is picked
            when the campaign is created, and every lead in it follows that type&apos;s stage ladder.
          </div>
          {creating && (
            <div className="row" style={{ marginTop: 14, alignItems: 'flex-end' }}>
              <label className="small" style={{ display: 'block' }}>
                <span className="muted">Campaign name</span>
                <input value={newCampaign.name} onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })} placeholder="e.g. Charlotte plumbers — Nov" style={{ minWidth: 260 }} />
              </label>
              <label className="small" style={{ display: 'block' }}>
                <span className="muted">Type</span>
                <select value={newCampaign.type} onChange={(e) => setNewCampaign({ ...newCampaign, type: e.target.value as Campaign })}>
                  {CAMPAIGNS.map((t) => <option key={t} value={t}>{CAMPAIGN_LABELS[t]}</option>)}
                </select>
              </label>
              <button className="btn" onClick={createCampaign}>Create campaign</button>
            </div>
          )}
        </div>
        {!campaigns ? <p className="muted">Loading…</p> : !campaigns.length ? (
          <p className="muted">No campaigns yet. Create your first campaign above.</p>
        ) : (
          <div className="gridwrap">
            <table className="grid">
              <thead>
                <tr><th>Campaign</th><th>Type</th><th>Leads</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td title={c.name}>{c.name}</td>
                    <td><span className="badge generic">{CAMPAIGN_LABELS[c.type]}</span></td>
                    <td>{c.lead_count}</td>
                    <td>{new Date(c.created_at).toLocaleDateString()}</td>
                    <td><button className="ghost" onClick={() => openCampaign(c)}>Open ▸</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className="row" style={{ alignItems: 'center', marginBottom: 10 }}>
        <button className="btn ghost" onClick={() => { setOpenCampaignId(null); setLeads(null) }}>‹ All campaigns</button>
        <strong>{campaign.name}</strong>
        <span className="badge generic">{campaignLabel(campaign.type)}</span>
      </div>

      <div className="panel">
        <div className="row" style={{ alignItems: 'center' }}>
          <a className="btn" href={`/api/tracker/export?campaign_id=${campaign.id}`}>Export campaign (CSV)</a>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>
            {busy ? 'Importing…' : 'Import spreadsheet (CSV or Excel)'}
            <input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={importFile} style={{ display: 'none' }} disabled={busy} />
          </label>
          <button className="btn ghost" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add a lead'}</button>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Importing matches rows on LEAD ID first when the sheet carries one, otherwise on company name + phone
          (email as a fallback), inside this campaign only, and only refreshes contact details —
          a lead&apos;s stage is never changed by an import. Rows on the DNC list are skipped.
        </div>
        {adding && (
          <div style={{ marginTop: 14 }}>
            {groupedForm(newLead, setNewLead)}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={addLead}>Add lead</button>
            </div>
          </div>
        )}
        {summary && (
          <div className="alert ok" style={{ marginTop: 12 }}>
            Imported {summary.rows} rows: {summary.added} added, {summary.updated} updated, {summary.skippedSuppressed} skipped
            — on the DNC list{summary.suppressedReasons.length > 0 && <> — {summary.suppressedReasons.slice(0, 5).join('; ')}</>}.
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
          {stagesForCampaign(campaign.type).map((s) => <option key={s} value={s}>{stageLabel(s)} ({counts.get(s) ?? 0})</option>)}
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
                const next = nextStage(l.stage, { campaign: campaign.type, skip_website_form: l.skip_website_form, skip_facebook_dm: l.skip_facebook_dm })
                const open = openId === l.id
                return [
                  <tr key={l.id}>
                    <td title={l.company_name}>{l.company_name}</td>
                    <td><span className="badge generic">{campaignShortLabel(campaign.type)}</span></td>
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
                        {stagesForCampaign(campaign.type).map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                        {OUTCOMES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                      </select>
                      <button className="ghost" onClick={() => toggleOpen(l)}>{open ? 'Close' : 'Details'}</button>
                    </td>
                  </tr>,
                  open && draft ? (
                    <tr key={`${l.id}-detail`}>
                      <td colSpan={11} style={{ whiteSpace: 'normal', maxWidth: 'none', background: 'var(--panel-2)' }}>
                        <div className="row" style={{ alignItems: 'center', marginBottom: 10 }}>
                          <span className="small muted">Campaign: {campaign.name} · {campaignLabel(campaign.type)}</span>
                          <span className={`badge ${badgeClass(l.stage)}`}>{stageLabel(l.stage)}</span>
                          <span className="small muted">in stage since {new Date(l.stage_updated_at).toLocaleDateString()}</span>
                          {next && <button className="ghost" title={`Next: ${stageLabel(next)}`} onClick={() => patch(l.id, { advance: true })}>Advance ▸ {stageLabel(next)}</button>}
                          <select value="" title="Set stage / outcome" onChange={(e) => { if (e.target.value) patch(l.id, { stage: e.target.value }) }} style={{ maxWidth: 150 }}>
                            <option value="">Set stage…</option>
                            {stagesForCampaign(campaign.type).map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                            {OUTCOMES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                          </select>
                        </div>
                        <div className="checks small" style={{ marginBottom: 14 }}>
                          <label>
                            <input type="checkbox" checked={!!draft.skip_website_form} onChange={(e) => setDraft({ ...draft, skip_website_form: e.target.checked })} />
                            No website form — skip stage 8
                          </label>
                          <label>
                            <input type="checkbox" checked={!!draft.skip_facebook_dm} onChange={(e) => setDraft({ ...draft, skip_facebook_dm: e.target.checked })} />
                            No Facebook page — skip stage 9
                          </label>
                          <span className="muted">
                            Skipped for this lead: {[l.skip_website_form ? 'website form' : '', l.skip_facebook_dm ? 'Facebook DM' : ''].filter(Boolean).join(', ') || 'none'}
                          </span>
                        </div>
                        {groupedForm(draft, setDraft)}
                        <div className="row" style={{ marginTop: 12 }}>
                          <button className="btn" onClick={() => saveDraft(l)}>Save changes</button>
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
