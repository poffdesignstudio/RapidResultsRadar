import { normPhone } from '../../core/normalize'

/**
 * A stored phone number as a tel: href, or null when it can't be dialed as-is.
 * US numbers go through the app's own normPhone (10 digits, leading 1 dropped) and
 * get the +1 country code; anything else with 7–15 plain digits and no extension
 * is passed through as-is.
 */
export function telHref(raw: string | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  const d = normPhone(v)
  if (d) return `tel:+1${d}`
  if (/\b(ext|x)\.?\s*\d/i.test(v)) return null
  const digits = v.replace(/\D/g, '')
  if (digits.length >= 7 && digits.length <= 15) return `tel:${digits.length > 10 ? '+' : ''}${digits}`
  return null
}

/**
 * A phone number kept readable as text, with a large tap-to-call button beside it —
 * John works the call list from his phone, so the button is a generous tap target.
 * The button stops click propagation so it never triggers a parent row/cell action
 * (e.g. the leads grid's click-to-edit).
 */
export function PhoneCell({ value }: { value?: string }) {
  const v = (value ?? '').trim()
  if (!v) return null
  const href = telHref(v)
  return (
    <span className="phonecell">
      <span>{v}</span>
      {href && (
        <a className="callbtn" href={href} onClick={(e) => e.stopPropagation()}
          aria-label={`Call ${v}`} title={`Tap to call ${v}`}>📞 Call</a>
      )}
    </span>
  )
}

/** Both numbers of a lead (company phone, then contact phone), each tap-to-call. */
export function PhoneStack({ phone, contactPhone }: { phone?: string; contactPhone?: string }) {
  const p = (phone ?? '').trim()
  const c = (contactPhone ?? '').trim()
  if (!p && !c) return null
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      {p && <PhoneCell value={p} />}
      {c && c !== p && <PhoneCell value={c} />}
    </span>
  )
}
