'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface S {
  id: number; created_at: string; status: string; error: string | null
  params: { niche: string; city?: string; state?: string; zip?: string; radius: number; profile?: string }
  state: { counts?: { kept: number; excluded: number } }
  progress: { pct: number; label: string }
}

const mmddyyyy = (iso: string) => { const d = new Date(iso); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}` }

export function RecentSearches() {
  const [rows, setRows] = useState<S[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch('/api/searches').then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setRows(j) }).catch((e) => setError(e.message))
  }, [])
  if (error) return <div className="alert bad">{error}</div>
  if (!rows) return <p className="muted">Loading…</p>
  if (!rows.length) return <p className="muted">No searches yet.</p>
  return (
    <div className="list">
      {rows.map((s) => (
        <Link key={s.id} href={`/searches/${s.id}`} className="item" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="muted small">#{s.id} · {mmddyyyy(s.created_at)}</span>
          <span className="grow">
            <strong>{s.params.niche}</strong> within {s.params.radius} mi of {s.params.zip ? `ZIP ${s.params.zip}` : `${s.params.city}, ${s.params.state}`}
            {s.params.profile && <span className="muted small"> · profile: {s.params.profile}</span>}
          </span>
          {s.state.counts && <span className="small">{s.state.counts.kept} leads</span>}
          <span className={`badge ${s.status}`}>{s.status === 'running' || s.status === 'queued' ? `${s.progress.label} (${s.progress.pct}%)` : s.status}</span>
        </Link>
      ))}
    </div>
  )
}
