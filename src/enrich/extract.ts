import * as cheerio from 'cheerio'
import { splitName, titleCase } from '../core/normalize.js'
import type { Confidence, Person } from '../core/types.js'

/** Titles we look for, best first. Score decides which person becomes the contact. */
export const TITLE_RANKS: { re: RegExp; score: number }[] = [
  { re: /\b(co-?)?owners?\b/i, score: 100 },
  { re: /\b(co-?)?founders?\b/i, score: 95 },
  { re: /\b(ceo|chief executive officer)\b/i, score: 95 },
  { re: /\bpresident\b/i, score: 90 },
  { re: /\bprincipal\b/i, score: 85 },
  { re: /\bmanaging (director|partner|member)\b/i, score: 85 },
  { re: /\bexecutive director\b/i, score: 85 },
  { re: /\b(coo|cfo|chief operating officer|chief financial officer)\b/i, score: 80 },
  { re: /\b(agency |branch )?administrator\b/i, score: 80 },
  { re: /\b(general|branch|agency|office|regional) manager\b/i, score: 70 },
  { re: /\bdirector of (nursing|operations|client services|care services|human resources|hr)\b/i, score: 65 },
  { re: /\b(vice president|vp)\b/i, score: 65 },
  { re: /\bdirector\b/i, score: 55 },
  { re: /\b(hr|human resources) (manager|director|generalist)\b/i, score: 50 },
  { re: /\bmanager\b/i, score: 40 },
]

export function titleScore(title: string | undefined): number {
  if (!title) return 0
  return TITLE_RANKS.find((t) => t.re.test(title))?.score ?? 0
}

const TITLE_ANY = new RegExp(TITLE_RANKS.map((t) => t.re.source).join('|'), 'i')

/** Words that look like names on business sites but are not people. */
const NOT_NAME = new Set(
  ('home care health services service agency senior seniors our team about contact us meet the and of in at for with your you we our ' +
    'leadership staff careers jobs privacy policy terms north south east west carolina charlotte county city company llc inc ' +
    'office main street road suite welcome client clients family families nursing nurse private duty companion personal ' +
    'director owner founder president manager administrator executive chief officer operations hr human resources care giver caregiver ' +
    'read more learn view all call today email phone fax hours monday friday saturday sunday new now hiring apply join business ' +
    'franchise independently owned operated location locations area areas serving quality compassionate trusted ' +
    'eastern western northern southern central greater metro region regional county valley lake mountain ' +
    'alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas ' +
    'kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada hampshire jersey ' +
    'mexico york dakota ohio oklahoma oregon pennsylvania rhode tennessee texas utah vermont virginia washington wisconsin wyoming').split(' '),
)

export function looksLikePersonName(s: string): boolean {
  const t = s.trim().replace(/\s+/g, ' ')
  if (t.length < 5 || t.length > 40) return false
  const words = t.replace(/,?\s+(jr|sr|ii|iii|rn|bsn|msn|lpn|mba|phd|md|cna|dnp|np)\.?$/i, '').split(' ')
  if (words.length < 2 || words.length > 4) return false
  return words.every((w) => /^[A-Z][a-zA-Z'\-]+\.?$|^[A-Z]\.$/.test(w) && !NOT_NAME.has(w.toLowerCase().replace(/\.$/, '')))
}

export interface PageFindings {
  emails: string[]
  people: Person[]
  hiring: boolean
  links: { href: string; text: string }[]
}

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi
const JUNK_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|@(example|domain|email|yourdomain|sentry|wixpress|sentry-next)\.|^[0-9a-f]{16,}@|noreply|no-reply|donotreply/i

/** Cloudflare hides emails behind data-cfemail; this is their public decoding scheme. */
export function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
  return out
}

export function cleanEmails(list: string[]): string[] {
  const out = new Set<string>()
  for (const raw of list) {
    const e = raw.toLowerCase().replace(/^mailto:/, '').split('?')[0].replace(/[.,;:]+$/, '').trim()
    if (/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e) && !JUNK_EMAIL.test(e)) out.add(e)
  }
  return [...out]
}

const HIRING_RE = /\b(now hiring|we('re| are) hiring|join our team|apply (now|today|online)|open positions|current openings|job openings|career opportunities|caregivers? wanted)\b/i
const JOB_BOARD_RE = /indeed\.com|applytojob|workable\.com|bamboohr|paylocity|clearcareonline|wellsky|myworkdayjobs|jobvite|recruiting\.|careers\.|ziprecruiter|hireology|apploi|talentlyft|breezy\.hr/i

export function extractPage(html: string, step: string): PageFindings {
  const $ = cheerio.load(html)
  const emails: string[] = []
  const people: Person[] = []

  $('[data-cfemail]').each((_, el) => { emails.push(decodeCfEmail($(el).attr('data-cfemail') || '')) })
  $('a[href^="mailto:" i]').each((_, el) => { emails.push(($(el).attr('href') || '').slice(7)) })

  // Structured data (schema.org JSON-LD) sometimes names the founder or staff with job titles.
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const walk = (n: unknown): void => {
        if (!n || typeof n !== 'object') return
        if (Array.isArray(n)) return n.forEach(walk)
        const o = n as Record<string, unknown>
        if (o['@type'] === 'Person' && typeof o.name === 'string' && looksLikePersonName(o.name)) {
          people.push(person(o.name, typeof o.jobTitle === 'string' ? o.jobTitle : undefined, `${step}:schema`, 'high'))
        }
        if (o.founder) {
          for (const f of [o.founder].flat()) {
            const nm = typeof f === 'string' ? f : (f as Record<string, unknown>)?.name
            if (typeof nm === 'string' && looksLikePersonName(nm)) people.push(person(nm, 'Founder', `${step}:schema`, 'high'))
          }
        }
        if (typeof o.email === 'string') emails.push(o.email)
        Object.values(o).forEach(walk)
      }
      walk(JSON.parse($(el).text()))
    } catch { /* bad JSON-LD is common; ignore it */ }
  })

  const links: { href: string; text: string }[] = []
  $('a[href]').each((_, el) => { links.push({ href: $(el).attr('href') || '', text: $(el).text().replace(/\s+/g, ' ').trim() }) })

  $('script, style, noscript, svg').remove()
  $('br').replaceWith('\n')
  $('p, div, li, h1, h2, h3, h4, h5, h6, td, th, section, article, span, strong, b, em').each((_, el) => { $(el).append('\n') })
  const text = $('body').text()
  emails.push(...(text.match(EMAIL_RE) ?? []))
  // "jane [at] example [dot] com"
  for (const m of text.matchAll(/([a-z0-9._%+\-]+)\s*[\[(]\s*at\s*[\])]\s*([a-z0-9\-]+)\s*[\[(]\s*dot\s*[\])]\s*([a-z]{2,})/gi)) emails.push(`${m[1]}@${m[2]}.${m[3]}`)

  people.push(...peopleFromText(text, step))
  const hiring = HIRING_RE.test(text) || links.some((l) => JOB_BOARD_RE.test(l.href) || /^(careers?|jobs|employment|join our team|apply)$/i.test(l.text))
  return { emails: cleanEmails(emails), people: dedupePeople(people), hiring, links }
}

function person(name: string, title: string | undefined, step: string, confidence: Confidence): Person {
  let clean = name.replace(/\s+/g, ' ').trim()
  if (clean === clean.toUpperCase()) clean = titleCase(clean) // "MELISSA HENDERSON" -> "Melissa Henderson"
  title = title?.replace(/[:\s]+$/, '')
  const { first, last } = splitName(clean)
  return { name: clean, first, last, title: title?.replace(/\s+/g, ' ').trim(), step, confidence }
}

/**
 * Finds "Name, Title", "Name - Title", "Title: Name", and team cards where the name and title
 * sit on neighboring lines.
 */
export function peopleFromText(text: string, step: string): Person[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const out: Person[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const byPhrase = /\b(founded|owned|started|led) by\b/.test(line)
    if (line.length > (byPhrase ? 400 : 160) || !(byPhrase || TITLE_ANY.test(line))) continue
    // Name, Title | Name - Title | Name | Title
    let m = line.match(/^([A-Z][A-Za-z.'\- ]{3,38}?)\s*(?:,|\s[-–—|]\s)\s*(.{3,70})$/)
    if (m && looksLikePersonName(m[1]) && TITLE_ANY.test(m[2])) { out.push(person(m[1], m[2], step, 'high')); continue }
    // Title: Name | Title - Name
    m = line.match(/^(.{3,60}?)\s*(?::|\s[-–—|]\s)\s*([A-Z][A-Za-z.'\- ]{3,38})$/)
    if (m && TITLE_ANY.test(m[1]) && looksLikePersonName(m[2])) { out.push(person(m[2], m[1], step, 'high')); continue }
    // Owner and founder phrasing inside a sentence: "founded by Jane Smith", "Jane Smith, owner of"
    m = line.match(/(?:founded|owned|started|led) by ([A-Z][a-z'\-]+(?: [A-Z]\.)? [A-Z][a-z'\-]+(?:-[A-Z][a-z'\-]+)?)/)
    if (m && looksLikePersonName(m[1])) { out.push(person(m[1], /founded|started/.test(m[0]) ? 'Founder' : 'Owner', step, 'medium')); continue }
    m = line.match(/([A-Z][a-z'\-]+ [A-Z][a-z'\-]+),? (?:is )?(?:the |our )?((?:co-?)?owner|founder|president|ceo|administrator|executive director)\b/i)
    if (m && looksLikePersonName(m[1])) { out.push(person(m[1], titleCase(m[2]), step, 'medium')); continue }
    // Team card: a short title line with the name on the line just above or below it.
    if (line.length <= 60 && !/[.!?]$/.test(line)) {
      const prev = lines[i - 1]
      const next = lines[i + 1]
      if (prev && looksLikePersonName(prev)) out.push(person(prev, line, step, 'medium'))
      else if (next && looksLikePersonName(next)) out.push(person(next, line, step, 'low'))
    }
  }
  return out
}

export function dedupePeople(list: Person[]): Person[] {
  const rank = { high: 3, medium: 2, low: 1 }
  const by = new Map<string, Person>()
  for (const p of list) {
    const k = p.name.toLowerCase()
    const cur = by.get(k)
    if (!cur || titleScore(p.title) > titleScore(cur.title) || (titleScore(p.title) === titleScore(cur.title) && rank[p.confidence] > rank[cur.confidence])) by.set(k, p)
  }
  return [...by.values()]
}
