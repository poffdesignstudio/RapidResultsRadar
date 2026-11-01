import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = join(ROOT, 'data')
export const OUTPUT_DIR = join(ROOT, 'output')
export const STATE_DIR = join(ROOT, 'state')
export const CACHE_DIR = join(STATE_DIR, 'cache')

/** Loads KEY=value lines from .env into process.env without overriding values already set. */
function loadDotEnv() {
  const p = join(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadDotEnv()

type Config = typeof import('../config/default.json')
export const config: Config = JSON.parse(readFileSync(join(ROOT, 'config', 'default.json'), 'utf8'))

export const googleApiKey = () => process.env.GOOGLE_PLACES_API_KEY?.trim() || ''

export function ensureDir(p: string) {
  mkdirSync(p, { recursive: true })
  return p
}
