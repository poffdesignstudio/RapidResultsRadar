const LEGAL_SUFFIXES = new Set(['llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'pllc', 'pc', 'pa', 'lp', 'llp', 'dba', 'the'])

/** Lowercase, drop punctuation and legal suffixes. "Tender Home Care, LLC" -> "tender home care". */
export function normName(s: string | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bp\.\s?l\.\s?l\.\s?c\.?/g, 'pllc')
    .replace(/\bl\.\s?l\.\s?c\.?/g, 'llc')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !LEGAL_SUFFIXES.has(w))
    .join(' ')
    .replace(/\bhomecare\b/g, 'home care')
    .replace(/\bhomehealth\b/g, 'home health')
    .trim()
}

const WEAK_WORDS = new Set(['home', 'care', 'health', 'healthcare', 'services', 'service', 'agency', 'and', 'of', 'senior', 'in', 'at', 'nursing', 'staffing', 'solutions', 'group', 'llc'])

/** Token similarity between two business names, 0 to 1. Generic words like "home care" count for less. */
export function nameSimilarity(a: string, b: string): number {
  const ta = normName(a).split(' ').filter(Boolean)
  const tb = normName(b).split(' ').filter(Boolean)
  if (!ta.length || !tb.length) return 0
  if (ta.join(' ') === tb.join(' ')) return 1
  const w = (t: string) => (WEAK_WORDS.has(t) ? 0.25 : 1)
  const setB = new Set(tb)
  const setA = new Set(ta)
  let shared = 0
  for (const t of setA) if (setB.has(t)) shared += w(t)
  let total = 0
  for (const t of new Set([...ta, ...tb])) total += w(t)
  // Containment counts too: "Fearless Enterprise In Home Care" vs "Fearless Enterprise".
  const strongA = [...setA].filter((t) => !WEAK_WORDS.has(t))
  const strongB = [...setB].filter((t) => !WEAK_WORDS.has(t))
  const small = strongA.length <= strongB.length ? strongA : strongB
  const big = new Set(strongA.length <= strongB.length ? strongB : strongA)
  const contained = small.length >= 1 && small.every((t) => big.has(t)) && small.join('').length >= 5
  const jac = total ? shared / total : 0
  return contained ? Math.max(jac, 0.85) : jac
}

/** Last 10 digits of a US phone number, or ''. */
export function normPhone(s: string | undefined): string {
  const d = (s || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return d.slice(1)
  return d.length === 10 ? d : ''
}

export function formatPhone(s: string | undefined): string {
  const d = normPhone(s)
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ''
}

export function zip5(s: string | undefined): string {
  const m = (s || '').match(/\b(\d{5})(?:-?\d{4})?\b/)
  return m ? m[1] : ''
}

/** "https://www.Example.com/about" -> "example.com" */
export function domainFromUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function normalizeUrl(url: string | undefined): string {
  if (!url) return ''
  const s = url.trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

/** Directory, social and booking sites that are not the business's own website. */
const NOT_OWN_SITE = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'yelp.com', 'indeed.com',
  'glassdoor.com', 'care.com', 'caring.com', 'aplaceformom.com', 'bbb.org', 'google.com', 'goo.gl',
  'yellowpages.com', 'mapquest.com', 'manta.com', 'youtube.com', 'tiktok.com', 'nextdoor.com', 'medicare.gov',
  'homecare.com', 'seniorly.com', 'agingcare.com', 'npiregistry.cms.hhs.gov', 'npino.com', 'bizapedia.com',
]
export function isOwnWebsite(url: string | undefined): boolean {
  const d = domainFromUrl(url)
  if (!d) return false
  return !NOT_OWN_SITE.some((x) => d === x || d.endsWith(`.${x}`))
}

/** Street number plus first street word, for address matching. "3845 Shopton Rd Ste 300" -> "3845 shopton". */
export function streetKey(address: string | undefined): string {
  const m = (address || '').toLowerCase().match(/^\s*(\d+[a-z]?)\s+(?:(?:n|s|e|w|north|south|east|west)\.?\s+)?([a-z0-9]+)/)
  return m ? `${m[1]} ${m[2]}` : ''
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (_, a: string, b: string) => a.toUpperCase() + b)
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean)
  const suffix = /^(jr|sr|ii|iii|iv|md|rn|bsn|msn|lpn|cna|phd|mba|dnp|np)$/i
  while (parts.length > 2 && suffix.test(parts[parts.length - 1])) parts.pop()
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts[parts.length - 1] }
}

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
