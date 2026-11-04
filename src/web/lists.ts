import { formatDate } from '../core/dates.js'
import { entryDedupeKey, type ListEntry, type ListKind } from '../match/listEntries.js'
import { q, q1, json } from './db.js'

/**
 * Storage for the two do-not-contact lists (table list_entries): 'client' = existing
 * clients, 'suppression' = people who said leave them alone. The loaders the search,
 * exports and campaign import screen with live in stores.ts (loadDncRows,
 * loadSuppressionSets); this module is the read/write side behind the DNC page.
 */

const COLS = 'id::int AS id, kind, name, brand, address, city, state, email, phone, entry_type, use_for_matching, match_rule, source, added_on'

export async function getListEntries(kind: ListKind): Promise<ListEntry[]> {
  return q<ListEntry>(`SELECT ${COLS} FROM list_entries WHERE kind=$1 ORDER BY id DESC LIMIT 5000`, [kind])
}

export async function countListEntries(kind: ListKind): Promise<number> {
  return (await q1<{ n: number }>('SELECT count(*)::int AS n FROM list_entries WHERE kind=$1', [kind]))?.n ?? 0
}

/**
 * Adds entries to one list, skipping ones already there (same dedupe identity).
 * With `replace`, the list is emptied first — the existing-clients upload pattern.
 * Returns how many rows were actually added and the list's new total.
 */
export async function addListEntries(entries: ListEntry[], source: string, replace: boolean): Promise<{ added: number; total: number }> {
  if (!entries.length) return { added: 0, total: 0 }
  const kind = entries[0].kind
  if (replace) await q('DELETE FROM list_entries WHERE kind=$1', [kind])
  const before = replace ? 0 : await countListEntries(kind)
  const rows = entries.map((e) => ({ ...e, dedupe: entryDedupeKey(e), source, added_on: formatDate() }))
  await q(
    `INSERT INTO list_entries (kind, name, brand, address, city, state, email, phone, entry_type, use_for_matching, match_rule, dedupe, source, added_on)
     SELECT x->>'kind', x->>'name', x->>'brand', x->>'address', x->>'city', x->>'state', x->>'email', x->>'phone',
            x->>'entry_type', x->>'use_for_matching', x->>'match_rule', x->>'dedupe', x->>'source', x->>'added_on'
     FROM jsonb_array_elements($1) AS x
     ON CONFLICT (dedupe) DO NOTHING`,
    [json(rows)],
  )
  const total = await countListEntries(kind)
  return { added: total - before, total }
}

export async function removeListEntry(id: number): Promise<void> {
  await q('DELETE FROM list_entries WHERE id=$1', [id])
}

/** Empties one list; returns how many entries it had. */
export async function clearList(kind: ListKind): Promise<number> {
  const n = await countListEntries(kind)
  await q('DELETE FROM list_entries WHERE kind=$1', [kind])
  return n
}
