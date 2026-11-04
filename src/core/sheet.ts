import * as XLSX from 'xlsx'

/**
 * Reads the FIRST worksheet of an Excel file (.xlsx/.xls) into the same shape
 * parseCsv produces: one object per data row, keyed by the (trimmed) header
 * row, with every value a trimmed string. Blank rows are dropped, exactly like
 * the CSV reader, so both formats feed the tracker import identically.
 */
export function parseSheetRows(data: ArrayBuffer | Uint8Array): Record<string, string>[] {
  const wb = XLSX.read(data, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  // raw:false gives each cell's formatted text, so numbers, dates and phones
  // arrive as the strings a person sees in the sheet — the CSV equivalent.
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })
  return rows
    .map((r) => {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(r)) out[k.trim()] = String(v ?? '').trim()
      return out
    })
    .filter((r) => Object.values(r).some((v) => v !== ''))
}
