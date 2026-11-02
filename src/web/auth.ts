/**
 * Single-user login. The session cookie is "<expiry>.<signature>", signed with HMAC-SHA256 using
 * SESSION_SECRET (or ADMIN_PASSWORD when that is not set). Uses Web Crypto so it also runs in
 * Next.js middleware.
 */
export const SESSION_COOKIE = 'rr_session'
const DAYS = 30

const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || ''

async function sign(text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function makeSession(): Promise<{ value: string; maxAge: number }> {
  const exp = String(Date.now() + DAYS * 86400000)
  return { value: `${exp}.${await sign(exp)}`, maxAge: DAYS * 86400 }
}

export async function validSession(value: string | undefined): Promise<boolean> {
  if (!value || !secret()) return false
  const [exp, sig] = value.split('.')
  if (!exp || !sig || Number(exp) < Date.now()) return false
  const expected = await sign(exp)
  if (expected.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

/** Constant-time password check. */
export async function passwordMatches(input: string): Promise<boolean> {
  const want = process.env.ADMIN_PASSWORD
  if (!want) return false
  const [a, b] = await Promise.all([sign(`pw:${input}`), sign(`pw:${want}`)])
  return a === b
}
