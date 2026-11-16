'use client'
import { useEffect, useState } from 'react'
import { EMAIL_LIST_LABELS, type EmailListKind } from '../../match/emailLists'

interface Entry { id: number; email: string; source: string; added_on: string }
interface ListData { total: number; entries: Entry[] }
interface ImportResult { added: number; duplicates: number; invalid: number; total: number }

const ACCEPT = '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'

/**
 * One of the email-only reference lists (Risky / Dead) as a tab on All Leads:
 * the entries in a table, a one-at-a-time add, and a CSV/Excel import that
 * reports added / duplicates skipped / invalid skipped. These lists are records
 * only — nothing in the app screens leads against them.
 */
export function EmailListPanel({ kind }: { kind: EmailListKind }) {
  const label = EMAIL_LIST_LABELS[kind]
  const [data, setData] = useState<ListData | null>(null)
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    fetch('/api/email-lists')
      .then((r) => r.json())
      .then((j) => setData(j[kind]))
      .catch(() => {})
  }
  useEffect(load, [kind])

  const post = async (fd: FormData) => {
    fd.append('kind', kind)
    const res = await fetch('/api/email-lists', { method: 'POST', body: fd })
    const j = await res.json()
    if (!res.ok) throw new Error(j.error ?? 'Something went wrong')
    return j as ImportResult
  }

  const addOne = async () => {
    setMsg(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('values', email)
      const j = await post(fd)
      setEmail('')
      setMsg({ ok: true, text: `Added. The ${label} list now holds ${j.total}.` })
      load()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    setBusy(false)
  }

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setMsg(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const j = await post(fd)
      const skipped = [
        j.duplicates > 0 ? `${j.duplicates} duplicate${j.duplicates === 1 ? '' : 's'} skipped` : '',
        j.invalid > 0 ? `${j.invalid} invalid skipped` : '',
      ].filter(Boolean).join(', ')
      setMsg({ ok: true, text: `Imported ${f.name}: added ${j.added}${skipped ? `; ${skipped}` : ''}. The ${label} list now holds ${j.total}.` })
      load()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    }
    setBusy(false)
    e.target.value = ''
  }

  const remove = async (entry: Entry) => {
    if (!window.confirm(`Remove ${entry.email} from the ${label} list?`)) return
    await fetch(`/api/email-lists?id=${entry.id}`, { method: 'DELETE' })
    load()
  }

  const total = data?.total ?? 0

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{label} ({total})</h2>
      <p className="small muted" style={{ textAlign: 'left' }}>
        Addresses the bulk email searches turned up as {kind === 'risky' ? 'risky — deliverable, but flagged by the verifier' : 'dead — undeliverable'}.
        Add them one at a time, or import a CSV or Excel file (the email column is used; duplicates and invalid rows are skipped and counted).
        This list is a record only — nothing is screened against it.
      </p>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'bad'}`} style={{ marginTop: 12 }}>{msg.text}</div>}
      <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && email.trim() && !busy) addOne() }}
          placeholder="one email address"
          style={{ minWidth: 300, flex: '0 1 420px' }}
        />
        <button onClick={addOne} disabled={!email.trim() || busy}>Add</button>
        <label className="btn ghost" style={{ cursor: 'pointer' }}>
          {busy ? 'Working…' : 'Import CSV or Excel'}
          <input type="file" accept={ACCEPT} onChange={upload} style={{ display: 'none' }} disabled={busy} />
        </label>
      </div>
      {data && total === 0 && <p className="muted" style={{ marginTop: 12 }}>No entries yet.</p>}
      {data && total > 0 && (
        <div className="gridwrap" style={{ marginTop: 12, maxHeight: 480 }}>
          <table className="grid">
            <thead><tr><th>Email</th><th>Source</th><th>Added</th><th></th></tr></thead>
            <tbody>{data.entries.map((e) => (
              <tr key={e.id}>
                <td>{e.email}</td><td>{e.source}</td><td>{e.added_on}</td>
                <td><button className="ghost" onClick={() => remove(e)}>Remove</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
