import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR, ensureDir } from '../config.js'
import { monthKey } from '../core/dates.js'

/**
 * Call counter for every paid source. Monthly counts are saved to state/usage.json after
 * every call, so the monthly cap holds across runs.
 */
type UsageFile = Record<string, Record<string, number>> // month -> source -> calls

const file = () => join(ensureDir(STATE_DIR), 'usage.json')

function read(): UsageFile {
  return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {}
}

export class CallCounter {
  runCalls = 0
  stoppedAtCap: string | null = null

  constructor(
    readonly source: string,
    public maxPerRun: number,
    readonly maxPerMonth: number,
  ) {}

  monthCalls(): number {
    return read()[monthKey()]?.[this.source] ?? 0
  }

  /** True if one more call stays within both caps. Records why when it does not. */
  canCall(): boolean {
    if (this.runCalls >= this.maxPerRun) {
      this.stoppedAtCap = `per-run cap of ${this.maxPerRun} calls`
      return false
    }
    if (this.monthCalls() >= this.maxPerMonth) {
      this.stoppedAtCap = `monthly cap of ${this.maxPerMonth} calls`
      return false
    }
    return true
  }

  record() {
    this.runCalls++
    const u = read()
    const m = monthKey()
    u[m] ??= {}
    u[m][this.source] = (u[m][this.source] ?? 0) + 1
    writeFileSync(file(), JSON.stringify(u, null, 2))
  }
}
