'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { campaignShortLabel } from '../../tracker/stages'

interface CallEntry {
  id: number
  campaign_id: number
  campaign_name: string
  campaign_type: string
  company_name: string
  contact_name: string
  phone: string
  contact_phone: string
  stage_updated_at: string
}

/** Every tracker lead sitting at CALL OUTREACH, across all campaigns — ready to be called. */
export function Calls() {
  const [calls, setCalls] = useState<CallEntry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/tracker/calls')
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setCalls(j.calls) })
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div className="alert bad">{error}</div>
  if (!calls) return <p className="muted">Loading…</p>
  if (!calls.length) return <p className="muted">No leads are at the call stage yet. When a lead reaches Call outreach in any campaign, it shows up here.</p>

  return (
    <div className="gridwrap">
      <table className="grid">
        <thead>
          <tr><th>Company</th><th>Contact</th><th>Phone</th><th>Campaign</th><th>In stage since</th><th></th></tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.id}>
              <td title={c.company_name}>{c.company_name}</td>
              <td title={c.contact_name}>{c.contact_name}</td>
              <td>{c.phone || c.contact_phone}</td>
              <td>
                {c.campaign_name} <span className="badge generic">{campaignShortLabel(c.campaign_type)}</span>
              </td>
              <td>{new Date(c.stage_updated_at).toLocaleDateString()}</td>
              <td>
                <Link className="btn ghost" href={`/tracker?campaign_id=${c.campaign_id}&lead=${c.id}`}>Open ▸</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
