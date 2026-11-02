import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { STATE_DIR, ensureDir } from '../config.js'
import { parseCsv, toCsv } from '../core/csv.js'
import { formatDate } from '../core/dates.js'

/**
 * Permanent lead IDs. Each business gets an ID the first time it is found; later runs look
 * it up by any key it is known by (Google place ID, NPI, CCN, Overture ID, phone, website,
 * name + ZIP), so the same business keeps the same ID and no ID is ever reused.
 * The CLI keeps them in state/lead_ledger.csv; the web app keeps them in Postgres.
 */
const FILE = () => join(ensureDir(STATE_DIR), 'lead_ledger.csv')

/** Permanent lead IDs: a file for the CLI, Postgres for the web app. */
export interface LeadLedger {
  idFor(keys: string[]): Promise<string>
  firstSeen(id: string): Promise<string>
}

export const LEAD_ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export function newLeadId(): string {
  const b = randomBytes(8)
  return 'RR-' + [...b].map((x) => LEAD_ID_ALPHABET[x % 32]).join('')
}

export class Ledger implements LeadLedger {
  private byKey = new Map<string, string>()
  private rows: { lead_id: string; keys: string; first_seen: string }[] = []
  private ids = new Set<string>()

  constructor() {
    if (existsSync(FILE())) {
      this.rows = parseCsv(readFileSync(FILE(), 'utf8')) as typeof this.rows
      for (const r of this.rows) {
        this.ids.add(r.lead_id)
        for (const k of r.keys.split(' ')) if (k) this.byKey.set(k, r.lead_id)
      }
    }
  }

  private newId(): string {
    let id: string
    do id = newLeadId()
    while (this.ids.has(id))
    this.ids.add(id)
    return id
  }

  /** Returns the lead's ID, creating one if none of the keys is known. Strongest keys first. */
  async idFor(keys: string[]): Promise<string> {
    const clean = keys.filter(Boolean)
    const existing = clean.map((k) => this.byKey.get(k)).find(Boolean)
    const id = existing ?? this.newId()
    let row = this.rows.find((r) => r.lead_id === id)
    if (!row) { row = { lead_id: id, keys: '', first_seen: formatDate() }; this.rows.push(row) }
    const have = new Set(row.keys.split(' ').filter(Boolean))
    for (const k of clean) if (!this.byKey.has(k)) { this.byKey.set(k, id); have.add(k) }
    row.keys = [...have].join(' ')
    return id
  }

  async firstSeen(id: string): Promise<string> {
    return this.rows.find((r) => r.lead_id === id)?.first_seen ?? formatDate()
  }

  save() {
    writeFileSync(FILE(), toCsv(['lead_id', 'keys', 'first_seen'], this.rows))
  }
}
