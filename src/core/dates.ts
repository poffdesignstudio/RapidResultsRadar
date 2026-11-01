const pad = (n: number) => String(n).padStart(2, '0')

/** MM-DD-YYYY, the only date format this app displays or exports. */
export function formatDate(d: Date = new Date()): string {
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`
}

/** MM-YYYY, used to key monthly call counters. */
export function monthKey(d: Date = new Date()): string {
  return `${pad(d.getMonth() + 1)}-${d.getFullYear()}`
}

/** Converts YYYY-MM-DD or YYYY-MM-DDTHH... (as some sources send) to MM-DD-YYYY. Returns '' if unparseable. */
export function isoToDisplay(s: string | undefined): string {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[2]}-${m[3]}-${m[1]}` : ''
}
