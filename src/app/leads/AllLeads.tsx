'use client'
import { useEffect, useState } from 'react'
import { CAMPAIGN_LABELS, firstStageForCampaign, stageLabel, type Campaign } from '../../tracker/stages'
import { LeadsTable } from '../_components/LeadsTable'

interface ImportSummary { rows: number; matched: number; unknown: string[]; changed: Record<string, number>; cellsChanged: number }
interface CampaignT { id: number; name: string; type: Campaign; lead_count: number }
interface AddedLead { company: string; campaignName: string; stage: string; href: string }

const COMPANY_FIELDS: [string, string][] = [
  ['company_name', 'Company name *'],
  ['segment', 'Niche'],
  ['phone', 'Company phone'],
  ['website', 'Website'],
]
const CONTACT_FIELDS: [string, string][] = [
  ['contact_name', "Contact's name"],
  ['contact_title', "Contact's title"],
  ['personal_email', "Contact's email"],
  ['contact_phone', 'Contact phone'],
]
/** The four profile URLs from the 28-column sheet format — the same stored fields the
 *  Campaign Tracker's Social Media group and the lead detail read and write. */
const SOCIAL_FIELDS: [string, string][] = [
  ['company_linkedin_url', 'Company LinkedIn URL'],
  ['linkedin_url', "Contact's LinkedIn URL"],
  ['facebook_url', 'Company Facebook URL'],
  ['contact_facebook_url', "Contact's Facebook URL"],
]

export function AllLeads() {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [campaigns, setCampaigns] = useState<CampaignT[] | null>(null)
  const [campaignId, setCampaignId] = useState<number | ''>('')
  const [form, setForm] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [added, setAdded] = useState<AddedLead | null>(null)

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

  const fetchCampaigns = async (): Promise<CampaignT[]> => {
    const r = await fetch('/api/tracker/campaigns')
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? 'Could not load the campaigns')
    return j.campaigns as CampaignT[]
  }

  /** Opens the Add lead form. The default campaign is "General" (Email outreach) — the
   *  container the app itself creates for leads with no campaign — made here through the
   *  campaigns API if it somehow does not exist yet. */
  const openAdd = async () => {
    setForm({})
    setFormError('')
    setAdded(null)
    setCampaigns(null)
    setCampaignId('')
    setAdding(true)
    try {
      let list = await fetchCampaigns()
      if (!list.some((c) => c.name.toLowerCase() === 'general')) {
        const res = await fetch('/api/tracker/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'General', type: 'EMAIL' }) })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error ?? 'Could not create the General campaign')
        list = await fetchCampaigns()
      }
      setCampaigns(list)
      const general = list.find((c) => c.name.toLowerCase() === 'general') ?? list[0]
      if (general) setCampaignId(general.id)
    } catch (e) {
      setFormError((e as Error).message)
    }
  }

  const saveLead = async () => {
    setFormError('')
    if (!String(form.company_name ?? '').trim()) return setFormError('Company name is required')
    if (!campaignId) return setFormError('Choose a campaign')
    setSaving(true)
    const res = await fetch('/api/tracker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, campaign_id: Number(campaignId) }) })
    const j = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setFormError(j.error ?? 'Could not add the lead')
    const camp = campaigns?.find((c) => c.id === Number(campaignId))
    setAdded({
      company: j.company_name,
      campaignName: camp?.name ?? 'the campaign',
      stage: j.stage,
      href: `/tracker?campaign_id=${j.campaign_id}&lead=${j.id}`,
    })
    setAdding(false)
    setSummary(null)
    load()
  }

  const field = (k: string, label: string) => (
    <label className="small" style={{ display: 'block' }} key={k}>
      <span className="muted">{label}</span>
      <input value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} style={{ width: '100%' }} />
    </label>
  )

  const group = (title: string, fields: [string, string][], extra?: React.ReactNode) => (
    <div key={title}>
      <div style={{ fontWeight: 700, letterSpacing: '.05em', fontSize: 12, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
        {fields.map(([k, label]) => field(k, label))}
        {extra}
      </div>
    </div>
  )

  const chosen = campaigns?.find((c) => c.id === Number(campaignId)) ?? null

  return (
    <>
      <div className="panel">
        <div className="row" style={{ alignItems: 'center' }}>
          <a className="btn" href="/api/leads/export">Export all leads (CSV)</a>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>
            {busy ? 'Importing…' : "Import Leia's CSV"}
            <input type="file" accept=".csv,text/csv" onChange={importFile} style={{ display: 'none' }} disabled={busy} />
          </label>
          <button className="btn ghost" onClick={openAdd}>Add lead</button>
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
        {added && (
          <div className="alert ok" style={{ marginTop: 12 }}>
            Added <strong>{added.company}</strong> to the <strong>{added.campaignName}</strong> campaign at {stageLabel(added.stage)}.{' '}
            <a href={added.href}>View it in the Campaign Tracker</a>
          </div>
        )}
      </div>
      {error && <div className="alert bad">{error}</div>}
      {rows ? <LeadsTable rows={rows} onDeleteSelected={deleteSelected} /> : <p className="muted">Loading…</p>}

      {adding && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setAdding(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, .65)', zIndex: 60, overflowY: 'auto', padding: '5vh 12px' }}
        >
          <div className="panel" style={{ maxWidth: 880, margin: '0 auto' }}>
            <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 16 }}>Add lead</strong>
              <button className="btn ghost" onClick={() => setAdding(false)}>Close</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 14 }}>
              <div>
                <div style={{ fontWeight: 700, letterSpacing: '.05em', fontSize: 12, marginBottom: 8 }}>CAMPAIGN</div>
                <label className="small" style={{ display: 'block' }}>
                  <span className="muted">Campaign</span>
                  <select value={campaignId} onChange={(e) => setCampaignId(Number(e.target.value))} style={{ width: '100%' }} disabled={!campaigns}>
                    {!campaigns && <option value="">Loading campaigns…</option>}
                    {campaigns?.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} — {CAMPAIGN_LABELS[c.type] ?? c.type}</option>
                    ))}
                  </select>
                </label>
                <div className="small muted" style={{ marginTop: 6 }}>
                  {chosen
                    ? <>The lead is added to this campaign in the Campaign Tracker, starting at {stageLabel(firstStageForCampaign(chosen.type))}.</>
                    : 'The lead is added to the chosen campaign in the Campaign Tracker, at its first stage.'}
                </div>
              </div>
              {group('COMPANY INFORMATION', COMPANY_FIELDS, (
                <div className="small" style={{ gridColumn: '1 / -1' }}>
                  <span className="muted">Address, City, State, ZIP</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input placeholder="Address" value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} style={{ flex: 3 }} />
                    <input placeholder="City" value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} style={{ flex: 2 }} />
                    <input placeholder="State" value={form.state ?? ''} onChange={(e) => setForm({ ...form, state: e.target.value })} style={{ flex: '0 0 72px' }} />
                    <input placeholder="ZIP" value={form.zip ?? ''} onChange={(e) => setForm({ ...form, zip: e.target.value })} style={{ flex: '0 0 104px' }} />
                  </div>
                </div>
              ))}
              {group('CONTACT INFORMATION', CONTACT_FIELDS)}
              {group('PROFILES / SOCIAL', SOCIAL_FIELDS)}
              <div>
                <div style={{ fontWeight: 700, letterSpacing: '.05em', fontSize: 12, marginBottom: 8 }}>NOTES</div>
                <label className="small" style={{ display: 'block' }}>
                  <span className="muted">Notes</span>
                  <textarea value={form.notes ?? ''} rows={3} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ width: '100%' }} />
                </label>
              </div>
            </div>
            {formError && <div className="alert bad" style={{ marginTop: 14, marginBottom: 0 }}>{formError}</div>}
            <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
              <button className="btn" onClick={saveLead} disabled={saving || !campaigns}>{saving ? 'Adding…' : 'Add lead'}</button>
              <button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
              <span className="small muted">* required</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
