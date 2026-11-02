import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR, ensureDir } from '../config.js'
import { monthKey } from '../core/dates.js'

/** Where monthly call counts live: a file for the CLI, Postgres for the web app. */
export interface UsageStore {
  get(source: string, month: string): Promise<number>
  add(source: string, month: string): Promise<void>
}

/** state/usage.json: month -> source -> calls. */
export class FileUsageStore implements UsageStore {
  private file = () => join(ensureDir(STATE_DIR), 'usage.json')
  private read(): Record<string, Record<string, number>> {
    return existsSync(this.file()) ? JSON.parse(readFileSync(this.file(), 'utf8')) : {}
  }
  async get(source: string, month: string) {
    return this.read()[month]?.[source] ?? 0
  }
  async add(source: string, month: string) {
    const u = this.read()
    u[month] ??= {}
    u[month][source] = (u[month][source] ?? 0) + 1
    writeFileSync(this.file(), JSON.stringify(u, null, 2))
  }
}

/**
 * Call counter for one paid source. The monthly count is saved after every call, so the
 * monthly cap holds across runs.
 */
export class CallCounter {
  runCalls = 0
  stoppedAtCap: string | null = null

  constructor(
    readonly source: string,
    public maxPerRun: number,
    public maxPerMonth: number,
    private store: UsageStore = new FileUsageStore(),
  ) {}

  monthCalls(): Promise<number> {
    return this.store.get(this.source, monthKey())
  }

  /** True if one more call stays within both caps. Records why when it does not. */
  async canCall(): Promise<boolean> {
    if (this.runCalls >= this.maxPerRun) {
      this.stoppedAtCap = `per-run cap of ${this.maxPerRun} calls`
      return false
    }
    if ((await this.monthCalls()) >= this.maxPerMonth) {
      this.stoppedAtCap = `monthly cap of ${this.maxPerMonth} calls`
      return false
    }
    return true
  }

  async record() {
    this.runCalls++
    await this.store.add(this.source, monthKey())
  }
}
