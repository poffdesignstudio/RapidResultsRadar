import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import defaults from '../config/default.json'

/** The project folder. The CLI runs from it; Vercel runs the web app from it too. */
export const ROOT = process.env.RR_ROOT || process.cwd()
export const DATA_DIR = join(ROOT, 'data')
export const OUTPUT_DIR = join(ROOT, 'output')
export const STATE_DIR = join(ROOT, 'state')
/** Downloaded files (Census, CMS). Vercel only allows writing to /tmp, which lasts while an instance is warm. */
export const CACHE_DIR = process.env.VERCEL ? '/tmp/rr-cache' : join(STATE_DIR, 'cache')

/** Loads KEY=value lines from .env into process.env without overriding values already set. */
function loadDotEnv() {
  const p = join(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
if (!process.env.VERCEL) loadDotEnv()

export type Config = typeof defaults
export const config: Config = defaults

export const googleApiKey = () => process.env.GOOGLE_PLACES_API_KEY?.trim() || ''

export function ensureDir(p: string) {
  mkdirSync(p, { recursive: true })
  return p
}
