import { config } from '../config.js'
import { normPhone, zip5, titleCase } from '../core/normalize.js'
import { inArea } from '../geo/area.js'
import type { Provider, RunContext, SourceRecord } from '../core/types.js'
import { cachedCsv, col, pdcCsvUrl } from './cmsData.js'

/**
 * CMS Home Health Care Agencies (Provider Data Catalog, dataset 6jpm-sxkc). Medicare-certified
 * agencies only: name, address, phone, ownership type and CCN. Private-pay home care is
 * usually missing. NOT YET TESTED live (data.cms.gov blocked here).
 */
export const cmsHomeHealthProvider: Provider & { errors: string[]; fileDate?: string } = {
  name: 'cms_hha',
  paid: false,
  errors: [],

  async search(ctx: RunContext): Promise<SourceRecord[]> {
    const { area, niche, log } = ctx
    if (!niche.healthcare || !config.cms.enabled) return []
    try {
      const { url, modified } = await pdcCsvUrl(config.cms.homeHealthDatasetId)
      this.fileDate = modified
      const rows = await cachedCsv('home_health_agencies', url)
      const out = rows
        .filter((r) => area.states.has(col(r, /^state$/i).toUpperCase()))
        .map((r) => this.normalize(r))
        .filter((r): r is SourceRecord => !!r && inArea(area, r))
      log(`CMS home health agencies: ${rows.length} nationwide, ${out.length} inside the radius`)
      return out
    } catch (e) {
      this.errors.push((e as Error).message)
      log(`CMS home health agencies: FAILED (${(e as Error).message})`)
      return []
    }
  },

  normalize(raw: unknown): SourceRecord | null {
    const r = raw as Record<string, string>
    const name = col(r, /^provider name$/i, /provider.?name/i, /^name$/i)
    const ccn = col(r, /certification number|ccn/i)
    if (!name || !ccn) return null
    return {
      source: 'cms_hha',
      sourceId: ccn,
      ids: { ccn },
      name: titleCase(name),
      address: titleCase(col(r, /^address$/i, /address/i)),
      city: titleCase(col(r, /city/i)),
      state: col(r, /^state$/i).toUpperCase(),
      zip: zip5(col(r, /zip/i)),
      phone: normPhone(col(r, /telephone|phone/i)) || undefined,
      ownership: col(r, /type of ownership|ownership/i),
      homeHealthEvidence: true,
    }
  },

  estimateCost: () => 0,
}
