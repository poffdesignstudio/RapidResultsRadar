import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import robotsParserModule from 'robots-parser'
import { config, CACHE_DIR, ensureDir } from '../config.js'
import { httpGet, sleep } from '../core/http.js'
import { domainFromUrl } from '../core/normalize.js'
import { formatDate } from '../core/dates.js'
import type { Person } from '../core/types.js'
import { extractPage, dedupePeople } from './extract.js'

export interface SiteResult {
  url: string
  domain: string
  /** ok, blocked_by_robots, unreachable, not_html */
  status: string
  pages: { url: string; kind: string; status: number }[]
  emails: { email: string; page: string }[]
  people: Person[]
  hiring: 'yes' | 'no' | 'unknown'
  careersPage?: string
  crawledOn: string
  crawledAtMs: number
}

const PAGE_KINDS: { kind: string; re: RegExp }[] = [
  { kind: 'team', re: /\b(our[- ]?team|team|leadership|staff|meet[- ]|management|who[- ]we[- ]are|our[- ]people)\b/i },
  { kind: 'about', re: /\b(about|our[- ]story|history|founder|owner)\b/i },
  { kind: 'contact', re: /\b(contact|get[- ]in[- ]touch|locations?)\b/i },
  { kind: 'careers', re: /\b(careers?|jobs|employment|join[- ]our[- ]team|hiring|apply|work[- ]with[- ]us)\b/i },
]
const GUESS_PATHS: [string, string][] = [['/about', 'about'], ['/about-us', 'about'], ['/contact', 'contact'], ['/contact-us', 'contact'], ['/our-team', 'team'], ['/careers', 'careers']]

type RobotsFn = (url: string, txt: string) => { isAllowed(url: string, ua?: string): boolean | undefined }
const robotsParser = robotsParserModule as unknown as RobotsFn

/**
 * Crawls a business website: the start page plus up to `maxPagesPerSite - 1` of its team,
 * about, contact and careers pages, all on the same site. Obeys robots.txt. When the
 * website is a franchise location page (e.g. brand.com/locations/charlotte/), it stays
 * under that path so it does not pick up the brand's head-office contacts.
 */
/** Where crawl results are kept between runs: files for the CLI, Postgres for the web app. */
export interface CrawlCache {
  get(key: string): Promise<SiteResult | null>
  set(key: string, result: SiteResult): Promise<void>
}

export const fileCrawlCache: CrawlCache = {
  async get(key) {
    const f = join(ensureDir(join(CACHE_DIR, 'sites')), `${key.replace(/[^a-z0-9.]+/gi, '_').slice(0, 120)}.json`)
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as SiteResult) : null
  },
  async set(key, result) {
    writeFileSync(join(ensureDir(join(CACHE_DIR, 'sites')), `${key.replace(/[^a-z0-9.]+/gi, '_').slice(0, 120)}.json`), JSON.stringify(result))
  },
}

interface CrawlOpts { stayUnderPath?: boolean; cache?: CrawlCache }

export async function crawlSite(url: string, opts: CrawlOpts = {}): Promise<SiteResult> {
  // Try https first: most sites listed as http:// also answer on https, and some networks allow only https.
  if (/^http:\/\//i.test(url)) {
    const secure = await crawlOnce(url.replace(/^http:/i, 'https:'), opts)
    if (secure.status !== 'unreachable') return secure
  }
  return crawlOnce(url, opts)
}

/** Crawls of the same site run one at a time, so chains with many office pages are not hammered. */
const hostQueue = new Map<string, Promise<unknown>>()
function onePerHost<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const prev = hostQueue.get(host) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  hostQueue.set(host, next.catch(() => undefined))
  return next
}

function crawlOnce(startUrl: string, opts: CrawlOpts): Promise<SiteResult> {
  return onePerHost(new URL(startUrl).host, () => crawlOnceNow(startUrl, opts))
}

async function crawlOnceNow(startUrl: string, opts: CrawlOpts): Promise<SiteResult> {
  const cache = opts.cache ?? fileCrawlCache
  const start = new URL(startUrl)
  const domain = domainFromUrl(startUrl)
  const scopePath = opts.stayUnderPath ? start.pathname.replace(/[^/]*$/, '') : '/'
  const cf = start.host + (scopePath === '/' ? '' : scopePath)
  const cached = await cache.get(cf)
  if (cached && Date.now() - cached.crawledAtMs < config.crawler.cacheDays * 86400000) return cached

  const result: SiteResult = { url: startUrl, domain, status: 'ok', pages: [], emails: [], people: [], hiring: 'unknown', crawledOn: formatDate(), crawledAtMs: Date.now() }
  const robotsUrl = `${start.origin}/robots.txt`
  const robotsRes = await httpGet(robotsUrl, { timeoutMs: 10000 })
  const robots = robotsParser(robotsUrl, robotsRes.ok ? robotsRes.text : '')
  const allowed = (u: string) => robots.isAllowed(u, config.crawler.userAgent) !== false

  if (!allowed(startUrl)) {
    result.status = 'blocked_by_robots'
    await cache.set(cf, result)
    return result
  }

  const seen = new Set<string>()
  const queue: { url: string; kind: string }[] = [{ url: startUrl, kind: 'home' }]
  let origin = start.origin
  let hiring = false
  let sawCareers = false

  while (queue.length && result.pages.length < config.crawler.maxPagesPerSite) {
    const { url, kind } = queue.shift()!
    const key = url.replace(/[#?].*$/, '').replace(/\/$/, '')
    if (seen.has(key) || !allowed(url)) continue
    seen.add(key)
    if (result.pages.length) await sleep(config.crawler.delayBetweenPagesMs)
    let res = await httpGet(url)
    if (res.status === 429) { await sleep(5000); res = await httpGet(url) } // asked to slow down: wait, try once more
    result.pages.push({ url, kind, status: res.status })
    if (!res.ok) {
      if (kind === 'home') { result.status = res.status === 403 || res.status === 429 ? 'blocked_by_site' : 'unreachable'; break }
      continue
    }
    if (!/html/i.test(res.contentType) && kind === 'home') { result.status = 'not_html'; break }
    if (kind === 'home') origin = new URL(res.url).origin // follow www / https redirects
    const f = extractPage(res.text, `website:${kind}`)
    f.emails.forEach((e) => result.emails.push({ email: e, page: url }))
    result.people.push(...f.people)
    if (f.hiring) hiring = true
    if (kind === 'careers') { sawCareers = true; result.careersPage = url }

    if (kind === 'home') {
      const picks = new Map<string, string>()
      for (const l of f.links) {
        let abs: URL
        try { abs = new URL(l.href, res.url) } catch { continue }
        if (abs.origin !== origin || !abs.pathname.startsWith(scopePath)) continue
        if (/\.(pdf|jpe?g|png|gif|docx?|zip)$/i.test(abs.pathname)) continue
        const hay = `${abs.pathname} ${l.text}`
        const k = PAGE_KINDS.find((p) => p.re.test(hay))
        if (k && ![...picks.values()].includes(k.kind) && !picks.has(abs.href)) picks.set(abs.href.replace(/#.*$/, ''), k.kind)
      }
      for (const pk of PAGE_KINDS) for (const [u, kd] of picks) if (kd === pk.kind) queue.push({ url: u, kind: kd })
      // When the home page links to none of these, try the usual paths.
      if (!picks.size) for (const [p, kd] of GUESS_PATHS) queue.push({ url: origin + (scopePath === '/' ? p : scopePath.replace(/\/$/, '') + p), kind: kd })
    }
  }

  result.people = dedupePeople(result.people)
  const cacheable = result.status !== 'unreachable'
  const uniq = new Map(result.emails.map((e) => [e.email, e]))
  result.emails = [...uniq.values()]
  result.hiring = result.status !== 'ok' ? 'unknown' : hiring || sawCareers ? 'yes' : 'no'
  // Failed fetches are not cached, so the next run tries the site again.
  if (cacheable) await cache.set(cf, result)
  return result
}
