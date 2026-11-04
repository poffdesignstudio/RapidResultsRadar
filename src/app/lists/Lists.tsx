'use client'
import { useEffect, useState } from 'react'

interface Entry {
  id: number
  name: string
  brand: string
  address: string
  city: string
  state: string
  email: string
  phone: string
  source: string
  added_on: string
}
interface ListData { total: number; entries: Entry[] }
type Kind = 'client' | 'suppression'

const ACCEPT = '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'

const label = (e: Entry) => e.name || e.email || e.phone || '(entry)'

function ListSection({ kind, title, blurb, data, replaceOnUpload, notify, reload }: {
  kind: Kind
  title: string
  blurb: string
  data: ListData | null
  /** Existing-clients uploads replace the whole list (with a confirm); suppression uploads add. */
  replaceOnUpload: boolean
  notify: (ok: boolean, text: string) => void
  reload: () => void
}) {
  const [typed, setTyped] = useState('')
  const total = data?.total ?? 0

  const send = async (fd: FormData, done: (j: { added: number; total: number }) => string) => {
    fd.append('kind', kind)
    const res = await fetch('/api/lists', { method: 'POST', body: fd })
    const j = await res.json()
    notify(res.ok, res.ok ? done(j) : j.error)
    if (res.ok) reload()
  }
  const upload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (replaceOnUpload && total > 0 && !window.confirm(`Replace the current list (${total} entries) with ${f.name}?`)) { e.target.value = ''; return }
    const fd = new FormData()
    fd.append('file', f)
    if (replaceOnUpload) fd.append('mode', 'replace')
    send(fd, (j) => replaceOnUpload
      ? `Imported ${j.added} entries. The ${title.toLowerCase()} list now holds ${j.total}.`
      : `Added ${j.added} entries. The ${title.toLowerCase()} list now holds ${j.total}.`)
    e.target.value = ''
  }
  const addTyped = () => {
    const fd = new FormData()
    fd.append('values', typed)
    send(fd, (j) => { setTyped(''); return `Added ${j.added} entries. The ${title.toLowerCase()} list now holds ${j.total}.` })
  }
  const remove = async (entry: Entry) => {
    if (!window.confirm(`Remove ${label(entry)} from the ${title.toLowerCase()} list? It could then appear in search results and exports again.`)) return
    await fetch(`/api/lists?id=${entry.id}`, { method: 'DELETE' })
    reload()
  }
  const clear = async () => {
    if (!window.confirm(`Remove all ${total} entries from the ${title.toLowerCase()} list?`)) return
    const res = await fetch(`/api/lists?kind=${kind}`, { method: 'DELETE' })
    const j = await res.json()
    notify(res.ok, res.ok ? `Cleared ${j.cleared} entries from the ${title.toLowerCase()} list.` : j.error)
    if (res.ok) reload()
  }

  return (
    <div className="panel" style={{ marginBottom: 0 }}>
      <h2 style={{ marginTop: 0, textAlign: 'center' }}>{title} ({total})</h2>
      {/* Blurb is left-aligned (John, Nov 4). minHeight reserves the taller
          (Existing Clients) blurb's height in both panels so the paste
          textareas and everything below them start at the same level and
          the two panels stay symmetrical. */}
      <p className="small muted" style={{ textAlign: 'left', minHeight: '6lh' }}>{blurb}</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <textarea value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="one entry per line — a business name, an email, @domain.com, or a phone number" rows={3} style={{ minWidth: 340, flex: 1 }} />
      </div>
      <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
        <button onClick={addTyped} disabled={!typed.trim()}>Add</button>
        <label className="btn ghost" style={{ cursor: 'pointer' }}>Upload CSV or Excel<input type="file" accept={ACCEPT} onChange={upload} style={{ display: 'none' }} /></label>
        {total > 0 && <button className="danger" onClick={clear}>Clear list</button>}
      </div>
      {data && total === 0 && <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>No entries yet.</p>}
      {data && total > 0 && (
        <div className="gridwrap" style={{ marginTop: 12, maxHeight: 360 }}>
          <table className="grid">
            <thead><tr><th>Entry</th><th>City</th><th>State</th><th>Email</th><th>Phone</th><th>Source</th><th>Added</th><th></th></tr></thead>
            <tbody>{data.entries.map((e) => (
              <tr key={e.id}>
                <td>{e.name || e.email || e.phone}{e.brand ? <span className="muted"> ({e.brand})</span> : null}{e.address ? <div className="small muted">{e.address}</div> : null}</td>
                <td>{e.city}</td><td>{e.state}</td><td>{e.name ? e.email : ''}</td><td>{e.phone}</td><td>{e.source}</td><td>{e.added_on}</td>
                <td><button className="ghost" onClick={() => remove(e)}>Remove</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function Lists() {
  const [lists, setLists] = useState<{ client: ListData; suppression: ListData } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => {
    fetch('/api/lists').then((r) => r.json()).then(setLists).catch(() => {})
  }
  useEffect(load, [])
  const notify = (ok: boolean, text: string) => setMsg({ ok, text })

  return (
    <>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(430px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
        <ListSection
          kind="client"
          title="EXISTING CLIENTS"
          blurb="Businesses that already buy from Rapid Results. Searches, exports and campaign imports screen every lead against this list and leave matches out — matched on business name (franchise brands match on brand plus city and state), email, or phone. Uploading a file replaces the whole list; a spreadsheet can be a full lead sheet or a simple list of names."
          data={lists?.client ?? null}
          replaceOnUpload
          notify={notify}
          reload={load}
        />
        <ListSection
          kind="suppression"
          title="SUPPRESSION LIST"
          blurb="People and businesses who said leave them alone. They are left out of every search, export and campaign import — matched on email, a whole domain (@domain.com), business name, or phone. Uploads and pasted lines add to the list; nothing is removed unless you remove it."
          data={lists?.suppression ?? null}
          replaceOnUpload={false}
          notify={notify}
          reload={load}
        />
      </div>
    </>
  )
}
