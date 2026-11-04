import { configChecks } from '../../web/env'

/** Names any missing required Vercel setting and how to add it, so nothing fails silently. */
export function ConfigAlert({ showOptional: _showOptional = true }: { showOptional?: boolean } = {}) {
  const checks = configChecks().filter((c) => !c.ok && c.required)
  if (!checks.length) return null
  return (
    <>
      {checks.map((c) => (
        <div key={c.name} className="alert bad">
          <strong>Missing setting: <code>{c.name}</code></strong>
          <div className="small" style={{ marginTop: 4 }}>{c.fix}</div>
        </div>
      ))}
    </>
  )
}
