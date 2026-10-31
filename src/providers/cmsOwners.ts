import { config } from '../config.js'
import { zip5, titleCase, normPhone } from '../core/normalize.js'
import { inArea } from '../geo/area.js'
import type { Person, Provider, RunContext, SourceRecord } from '../core/types.js'
import { cachedCsv, catalogCsvUrl, col } from './cmsData.js'

/**
 * CMS Home Health Agency All Owners, joined to CMS Home Health Agency Enrollments on
 * ENROLLMENT ID. Enrollments give the agency's CCN and practice address; owners give the
 * people (and companies) that own or run it. Company owners are skipped as contacts.
 * NOT YET TESTED live (data.cms.gov blocked here).
 */
const ENROLLMENTS_TITLE = 'Home Health Agency Enrollments'

export const cmsOwnersProvider: Provider & { errors: string[]; files: string[] } = {
  name: 'cms_owners',
  paid: false,
  errors: [],
  files: [],

  async search(ctx: RunContext): Promise<SourceRecord[]> {
    const { area, niche, log } = ctx
    if (!niche.healthcare || !config.cms.enabled) return []
    try {
      const ownersUrl = config.cms.ownersCsvUrl || (await catalogCsvUrl(config.cms.ownersDatasetTitle)).url
      const enrUrl = (await catalogCsvUrl(ENROLLMENTS_TITLE)).url
      this.files = [ownersUrl, enrUrl]
      const [owners, enrollments] = await Promise.all([cachedCsv('hha_all_owners', ownersUrl), cachedCsv('hha_enrollments', enrUrl)])

      const local = new Map<string, Record<string, string>>()
      for (const e of enrollments) {
        const st = col(e, /^state$/i, /state/i).toUpperCase()
        if (!area.states.has(st)) continue
        const rec = { zip: zip5(col(e, /zip/i)), state: st }
        if (inArea(area, rec)) local.set(col(e, /^enrollment id$/i, /enrollment.?id/i), e)
      }
      const peopleBy = new Map<string, Person[]>()
      for (const o of owners) {
        const enr = col(o, /^enrollment id$/i, /enrollment.?id/i)
        if (!local.has(enr)) continue
        const type = col(o, /^type - owner$/i, /type.*owner/i).toUpperCase()
        const first = titleCase(col(o, /^first name - owner$/i, /first name/i))
        const last = titleCase(col(o, /^last name - owner$/i, /last name/i))
        if (type === 'O' || (!first && !last)) continue // a company owner, not a person
        const role = col(o, /^role text - owner$/i, /role text/i)
        const pct = col(o, /percentage ownership/i)
        const title = [col(o, /^title - owner$/i) || simplifyRole(role), pct && Number(pct) > 0 ? `${Number(pct)}% owner` : ''].filter(Boolean).join(', ')
        const list = peopleBy.get(enr) ?? []
        list.push({ name: `${first} ${last}`.trim(), first, last, title, step: `cms_owners:${role || 'owner'}`, confidence: /ownership|owner/i.test(role) ? 'high' : 'medium' })
        peopleBy.set(enr, list)
      }
      const out: SourceRecord[] = []
      for (const [enr, e] of local) {
        const rec = this.normalize({ ...e, __people: JSON.stringify(peopleBy.get(enr) ?? []) })
        if (rec) out.push(rec)
      }
      log(`CMS owners: ${local.size} enrolled agencies inside the radius, ${[...peopleBy.values()].flat().length} named owners or officers`)
      return out
    } catch (e) {
      this.errors.push((e as Error).message)
      log(`CMS owners: FAILED (${(e as Error).message})`)
      return []
    }
  },

  normalize(raw: unknown): SourceRecord | null {
    const e = raw as Record<string, string>
    const name = col(e, /^organization name$/i, /organization name/i)
    const enr = col(e, /^enrollment id$/i, /enrollment.?id/i)
    if (!name || !enr) return null
    const ccn = col(e, /^ccn$/i, /certification number|ccn/i)
    const dba = col(e, /doing business as/i)
    return {
      source: 'cms_owners',
      sourceId: enr,
      ids: ccn ? { ccn } : undefined,
      name: titleCase(name),
      altNames: dba ? [titleCase(dba)] : undefined,
      address: titleCase([col(e, /address line 1/i), col(e, /address line 2/i)].filter(Boolean).join(' ')),
      city: titleCase(col(e, /^city$/i, /city/i)),
      state: col(e, /^state$/i, /state/i).toUpperCase(),
      zip: zip5(col(e, /zip/i)),
      phone: normPhone(col(e, /telephone|phone/i)) || undefined,
      homeHealthEvidence: true,
      people: JSON.parse(e.__people || '[]'),
    }
  },

  estimateCost: () => 0,
}

function simplifyRole(role: string): string {
  if (/5% or greater direct ownership/i.test(role)) return 'Owner'
  if (/5% or greater indirect ownership/i.test(role)) return 'Indirect owner'
  if (/officer/i.test(role)) return 'Officer'
  if (/director/i.test(role)) return 'Director'
  if (/managing employee/i.test(role)) return 'Managing employee'
  if (/operational|managerial control/i.test(role)) return 'Operational control'
  if (/partner/i.test(role)) return 'Partner'
  return titleCase(role)
}
