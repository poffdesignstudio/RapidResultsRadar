'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { COLUMNS } from '../../leads/columns'

type Row = Record<string, string>

const MAIN_COLUMNS = [
  'company_name', 'segment', 'franchise_brand', 'city', 'state', 'phone', 'website', 'contact_name', 'contact_title',
  'contact_email', 'email_status', 'email_source', 'hiring_signal', 'confidence', 'flags', 'review_status', 'notes', 'source', 'lead_id',
]
const READ_ONLY = new Set(['lead_id', 'source', 'source_id', 'date_found'])
const LABELS: Record<string, string> = {
  company_name: 'Company', franchise_brand: 'Brand', contact_name: 'Contact', contact_title: 'Title', contact_email: 'Email',
  email_status: 'Email status', email_source: 'Email found by', hiring_signal: 'Hiring', review_status: 'Review', lead_id: 'Lead ID',
  segment: 'Segment', city: 'City', state: 'State', phone: 'Phone', website: 'Website', confidence: 'Confidence',
  flags: 'Flags', notes: 'Notes', source: 'Source', source_id: 'Source ID', date_found: 'Date found', address: 'Address',
  zip: 'ZIP', domain: 'Domain', employee_estimate: 'Employee estimate', contact_phone: 'Contact phone',
  linkedin_company_url: 'LinkedIn company URL', linkedin_contact_url: 'LinkedIn contact URL', facebook_url: 'Facebook URL',
  bbb_url: 'BBB URL', chamber_url: 'Chamber URL', campaign_name: 'Campaign name', campaign_start: 'Campaign start',
}
/** Display label for a column header: explicit label, else the raw key spaced out with its first letter capitalized. */
const headerLabel = (c: string) => LABELS[c] ?? ((s: string) => s.charAt(0).toUpperCase() + s.slice(1))(c.replace(/_/g, ' '))
const QUICK: [string, string, (r: Row) => boolean][] = [
  ['all', 'All', () => true],
  ['email', 'Has email', (r) => !!r.contact_email],
  ['personal', 'Personal email', (r) => !!r.contact_email && r.email_status !== 'generic'],
  ['contact', 'Has contact', (r) => !!r.contact_name],
  ['nocontact', 'No contact', (r) => !r.contact_name],
  ['flagged', 'Flagged', (r) => !!r.flags],
  ['pending', 'Review: pending', (r) => r.review_status === 'pending'],
  ['approved', 'Review: approved', (r) => r.review_status === 'approved'],
]
const PAGE = 100

export function LeadsTable({ rows, onChange, onDeleteSelected }: {
  rows: Row[]
  onChange?: (leadId: string, col: string, value: string) => void
  /** When given (the All leads page), rows get checkboxes and a bulk Delete button appears. */
  onDeleteSelected?: (leadIds: string[]) => Promise<void>
}) {
  const [filter, setFilter] = useState('')
  const [quick, setQuick] = useState('all')
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: 'confidence', dir: -1 })
  const [page, setPage] = useState(0)
  const [allCols, setAllCols] = useState(false)
  const [editing, setEditing] = useState<{ id: string; col: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const masterRef = useRef<HTMLInputElement>(null)

  const cols = allCols ? [...COLUMNS] : MAIN_COLUMNS
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const test = QUICK.find((x) => x[0] === quick)![2]
    const out = rows.filter((r) => test(r) && (!f || Object.values(r).some((v) => v && String(v).toLowerCase().includes(f))))
    const num = sort.col === 'confidence'
    out.sort((a, b) => {
      const x = a[sort.col] ?? ''
      const y = b[sort.col] ?? ''
      return (num ? (Number(x) || 0) - (Number(y) || 0) : x.localeCompare(y)) * sort.dir
    })
    return out
  }, [rows, filter, quick, sort])
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE)

  // Keep selection and edit state pointing at leads that still exist (e.g. after a delete
  // reloads the pool), and never sit on a page past the end.
  useEffect(() => {
    const ids = new Set(rows.map((r) => r.lead_id))
    setSelected((prev) => (prev.size && [...prev].some((id) => !ids.has(id)) ? new Set([...prev].filter((id) => ids.has(id))) : prev))
    setEditing((prev) => (prev && !ids.has(prev.id) ? null : prev))
  }, [rows])
  useEffect(() => { if (page >= pages) setPage(pages - 1) }, [page, pages])

  const pageSelected = pageRows.filter((r) => selected.has(r.lead_id)).length
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = pageSelected > 0 && pageSelected < pageRows.length
  }, [pageSelected, pageRows.length])

  const toggleRow = (id: string, on: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    if (on) next.add(id); else next.delete(id)
    return next
  })
  const togglePage = (on: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    for (const r of pageRows) { if (on) next.add(r.lead_id); else next.delete(r.lead_id) }
    return next
  })

  const deleteSelected = async () => {
    if (!onDeleteSelected || !selected.size || deleting) return
    const ids = [...selected]
    if (!window.confirm(`Delete ${ids.length} selected lead${ids.length === 1 ? '' : 's'} permanently? This removes them from All leads and cannot be undone.`)) return
    setDeleting(true)
    setError('')
    try {
      await onDeleteSelected(ids)
      setSelected(new Set())
    } catch (e) {
      setError((e as Error).message || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const save = async (r: Row, col: string, value: string) => {
    setEditing(null)
    if ((r[col] ?? '') === value) return
    setSaving(`${r.lead_id}|${col}`)
    setError('')
    const res = await fetch(`/api/leads/${encodeURIComponent(r.lead_id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ col, value }) })
    setSaving(null)
    if (!res.ok) { setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Save failed'); return }
    r[col] = value
    onChange?.(r.lead_id, col, value)
  }

  const cell = (r: Row, c: string) => {
    const v = r[c] ?? ''
    const key = `${r.lead_id}|${c}`
    if (editing?.id === r.lead_id && editing.col === c) {
      if (c === 'review_status') {
        return (
          <select autoFocus value={draft} onChange={(e) => save(r, c, e.target.value)} onBlur={() => setEditing(null)}>
            {['pending', 'approved', 'drop'].map((o) => <option key={o}>{o}</option>)}
          </select>
        )
      }
      return (
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => save(r, c, draft)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(r, c, draft); if (e.key === 'Escape') setEditing(null) }} />
      )
    }
    if (c === 'website' && v) return <a href={/^https?:/i.test(v) ? v : `https://${v}`} target="_blank" rel="noreferrer">{v.replace(/^https?:\/\/(www\.)?/, '')}</a>
    if (c === 'contact_email' && v) return <a href={`mailto:${v}`}>{v}</a>
    if (['email_status', 'review_status', 'hiring_signal'].includes(c) && v) return <span className={`badge ${v}`}>{v}</span>
    return saving === key ? '…' : v
  }

  return (
    <div>
      <div className="gridtools">
        <input placeholder="Filter rows…" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0) }} style={{ minWidth: 220 }} />
        <select value={quick} onChange={(e) => { setQuick(e.target.value); setPage(0) }}>
          {QUICK.map(([k, label]) => <option key={k} value={k}>{label} ({rows.filter(QUICK.find((x) => x[0] === k)![2]).length})</option>)}
        </select>
        <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={allCols} onChange={(e) => setAllCols(e.target.checked)} /> Show all CSV columns
        </label>
        {onDeleteSelected && (
          <button className="danger" disabled={!selected.size || deleting} onClick={deleteSelected}>
            {deleting ? 'Deleting…' : `Delete selected${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        )}
        <span className="muted small">{shown.length} of {rows.length} rows · click a cell to edit</span>
      </div>
      {error && <div className="alert bad">{error}</div>}
      <div className="gridwrap">
        <table className="grid">
          <thead>
            <tr>
              {onDeleteSelected && (
                <th style={{ textAlign: 'center' }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <input ref={masterRef} type="checkbox" aria-label="Select all leads on this page"
                      checked={pageRows.length > 0 && pageSelected === pageRows.length}
                      onChange={(e) => togglePage(e.target.checked)} />
                    Select all
                  </label>
                </th>
              )}
              {cols.map((c) => (
                <th key={c} onClick={() => setSort((s) => ({ col: c, dir: s.col === c ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                  {headerLabel(c)}{sort.col === c ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.lead_id}>
                {onDeleteSelected && (
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" aria-label={`Select ${r.company_name || r.lead_id}`}
                      checked={selected.has(r.lead_id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => toggleRow(r.lead_id, e.target.checked)} />
                  </td>
                )}
                {cols.map((c) => {
                  const editable = !READ_ONLY.has(c)
                  return (
                    <td key={c} title={r[c] ?? ''}
                      className={[editable ? 'edit' : '', c === 'flags' ? 'flags' : '', c === 'confidence' ? 'num' : ''].join(' ')}
                      onClick={() => { if (editable && !(editing?.id === r.lead_id && editing.col === c)) { setEditing({ id: r.lead_id, col: c }); setDraft(r[c] ?? (c === 'review_status' ? 'pending' : '')) } }}>
                      {cell(r, c)}
                    </td>
                  )
                })}
              </tr>
            ))}
            {!pageRows.length && <tr><td colSpan={cols.length + (onDeleteSelected ? 1 : 0)} className="muted">No rows</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span className="small muted">Page {page + 1} of {pages}</span>
          <button className="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}
    </div>
  )
}
