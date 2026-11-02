import { configChecks } from '../../web/env'

/** Names any missing Vercel setting and how to add it, so nothing fails silently. */
export function ConfigAlert({ showOptional = true }: { showOptional?: boolean }) {
  const checks = configChecks().filter((c) => !c.ok && (c.required || showOptional))
  if (!checks.length) return null
  return (
    <>
      {checks.map((c) => (
        <div key={c.name} className={`alert ${c.required ? 'bad' : ''}`}>
          <strong>{c.required ? 'Missing setting' : 'Optional setting not set'}: <code>{c.name}</code></strong>
          <div className="small" style={{ marginTop: 4 }}>{c.fix}</div>
        </div>
      ))}
    </>
  )
}
