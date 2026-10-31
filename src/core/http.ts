import { config } from '../config.js'

export interface FetchResult {
  ok: boolean
  status: number
  text: string
  url: string
  contentType: string
}

/** GET with a timeout and our user agent. Never throws: network errors come back as status 0. */
export async function httpGet(url: string, opts: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<FetchResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? config.crawler.timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': config.crawler.userAgent, Accept: 'text/html,application/json,text/plain,*/*', ...opts.headers },
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text, url: res.url || url, contentType: res.headers.get('content-type') || '' }
  } catch (e) {
    return { ok: false, status: 0, text: String((e as Error)?.message || e), url, contentType: '' }
  } finally {
    clearTimeout(timer)
  }
}

export async function httpGetBuffer(url: string, timeoutMs = 300000): Promise<Uint8Array> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': config.crawler.userAgent } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return new Uint8Array(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Runs fn over items with at most `limit` running at once, keeping input order in the results. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}
