'use client'
import { useState } from 'react'

export function LoginForm({ disabled }: { disabled: boolean }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    setBusy(false)
    if (res.ok) window.location.href = '/'
    else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Login failed')
  }
  return (
    <form onSubmit={submit} className="list">
      <label className="f">Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus disabled={disabled} />
      </label>
      {error && <div className="alert bad">{error}</div>}
      <button disabled={disabled || busy || !password}>{busy ? 'Checking…' : 'Log in'}</button>
    </form>
  )
}
