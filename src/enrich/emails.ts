import { promises as dns } from 'node:dns'
import { normName } from '../core/normalize.js'
import type { Person } from '../core/types.js'

const GENERIC_LOCAL = /^(info|office|contact|admin|administration|hello|hi|support|sales|careers?|jobs|hr|humanresources|billing|accounts?|intake|referrals?|scheduling|schedule|care|service|services|team|mail|inquir(y|ies)|frontdesk|reception|marketing|help|general|staff|webmaster|enquiries|recruiting|recruitment|hiring|apply|employment|homecare|homehealth|clientservices|questions|customerservice|operations|main|agency|nurse|nursing|payroll)\d*$/

export const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|aol|icloud|me|msn|live|comcast|att|bellsouth|ymail|protonmail)\.(com|net)$/

/**
 * "generic" for shared inboxes (info@, office@, or a local part that repeats the company
 * name, like tenderhomecare2@gmail.com). Anything else is treated as a person's address.
 */
export function isGenericEmail(email: string, companyName = '', placeNames: string[] = []): boolean {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  if (GENERIC_LOCAL.test(local)) return true
  if ((local.match(/\d/g) ?? []).length >= 3) return true // e.g. 59049@, leadssc06@
  if (/^(leads?|wecare|teams?|ourteam|location|branch|office\w*|care\w*team|homecare\w*|clients?)/.test(local)) return true
  if (placeNames.some((p) => p.length >= 4 && local.startsWith(p.toLowerCase().replace(/[^a-z]/g, '')))) return true // charlotte@
  if (/(info|office|contact|admin|careers?|jobs|hr|intake|referral)/.test(local) && local.length > 4) return true
  const tokens = normName(companyName).split(' ').filter((t) => t.length >= 4 && !['home', 'care', 'health'].includes(t))
  return tokens.some((t) => local.includes(t)) || /homecare|homehealth|seniorcare|caregiv/.test(local)
}

type Pattern = (f: string, l: string) => string
export const PATTERNS: Record<string, Pattern> = {
  'first': (f) => f,
  'first.last': (f, l) => `${f}.${l}`,
  'firstlast': (f, l) => `${f}${l}`,
  'flast': (f, l) => `${f[0]}${l}`,
  'f.last': (f, l) => `${f[0]}.${l}`,
  'first_last': (f, l) => `${f}_${l}`,
  'firstl': (f, l) => `${f}${l[0]}`,
  'last': (_f, l) => l,
  'lastf': (f, l) => `${l}${f[0]}`,
}

const clean = (s: string | undefined) => (s || '').toLowerCase().replace(/[^a-z]/g, '')

/** Which pattern produced this email for this person, if any. */
export function patternOf(email: string, p: Pick<Person, 'first' | 'last'>): string | null {
  const local = email.split('@')[0].toLowerCase()
  const f = clean(p.first)
  const l = clean(p.last)
  if (!f || !l) return null
  for (const [k, fn] of Object.entries(PATTERNS)) if (fn(f, l) === local) return k
  return null
}

export function applyPattern(pattern: string, p: Pick<Person, 'first' | 'last'>, domain: string): string | null {
  const f = clean(p.first)
  const l = clean(p.last)
  if (!f || !l || !PATTERNS[pattern]) return null
  return `${PATTERNS[pattern](f, l)}@${domain}`
}

const mxCache = new Map<string, Promise<boolean | null>>()

/**
 * Looks up the domain's mail servers over HTTPS (Google's public DNS), which works in cloud
 * sessions where ordinary DNS lookups are blocked. Falls back to ordinary DNS if that fails.
 */
async function mxOverHttps(domain: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const j = (await res.json()) as { Status?: number; Answer?: { type: number }[] }
    if (j.Status === 3) return false // the domain does not exist
    if (j.Status !== 0) return null
    return (j.Answer ?? []).some((a) => a.type === 15)
  } catch {
    return null
  }
}

/** True if the domain has a mail server, false if it has none, null if the lookup failed. */
export function hasMx(domain: string): Promise<boolean | null> {
  if (!mxCache.has(domain)) {
    mxCache.set(
      domain,
      mxOverHttps(domain).then((viaHttps) =>
        viaHttps !== null
          ? viaHttps
          : dns.resolveMx(domain).then(
              (r) => r.length > 0,
              (e: NodeJS.ErrnoException) => (e.code === 'ENODATA' || e.code === 'ENOTFOUND' ? false : null),
            ),
      ),
    )
  }
  return mxCache.get(domain)!
}
