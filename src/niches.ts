import type { Niche } from './core/types.js'

/** Built-in niches. Any other niche text still works: it is used as the Google query and keyword. */
const PRESETS: Niche[] = [
  {
    key: 'home-care-health',
    label: 'Home care and home health',
    // Two queries, not three: "in-home senior care" mostly returned senior living facilities.
    googleQueries: ['home health care agency', 'home care agency'],
    overtureTaxonomies: ['home_health_care', 'home_care', 'in_home_care', 'senior_care', 'elder_care', 'personal_care_service', 'nursing_service'],
    keywords: ['home care', 'home health', 'homecare', 'in-home', 'in home', 'caregiver', 'caregivers', 'senior care', 'companion care', 'private duty', 'home instead', 'visiting angels', 'comfort keepers', 'right at home', 'nurse next door'],
    excludeCategories: /real_estate|developer|salon|beauty|barber|spa|pet|veterinar|cleaning|contractor|repair|furniture|insurance|construction|restaurant|store|retail|assisted_living|retirement_home|nursing_home|church|school/,
    includeNames: /care|caire|caring|health|in[- ]home|(at|@) home|nurs|senior|elder|companion|hospice|private duty|\baides?\b|attendant|respite|angels?\b|helpers?\b|helping hands?/i,
    strongNames: /home ?care|home ?health|in[- ]home care|private duty|hospice/i,
    excludeNames: new RegExp([
      'assisted living', 'memory care', 'nursing (home|center|facility)', 'nursing (and|&) rehab', 'rehab', 'long[- ]?term care',
      'skilled nursing', 'group homes?', 'residential', 'retirement', 'senior living', 'independent living', 'family services',
      'case management', 'developmental', 'behavioral', 'therapeutic', 'therapy', 'counsel', 'wellness center', '\\baco\\b',
      'medical supply', 'home medical', 'oxygen', 'pharmacy', '\\biv\\b', 'staffing', 'hospital', 'clinic',
      'peak resources', 'brookdale', '\\brha\\b', '\\bucp\\b', 'council on aging', 'area agency', 'girls home', 'boys home',
    ].join('|'), 'i'),
    hardExcludeNames: /day ?care|\bchild|\byouth|\bkids?\b|walmart|transport|mobility|scooter|home loans?|\bhomes\b|designs?\b|crawl ?space|log cabin|affordable home\b|construction|realty|real estate|chiropract|allergy|lincare|rotech|american homepatient|apria|adapthealth/i,
    healthcare: true,
    defaultSegment: 'home care',
  },
  {
    key: 'staffing',
    label: 'Staffing agencies',
    googleQueries: ['staffing agency', 'employment agency', 'temp agency'],
    overtureTaxonomies: ['employment_agencies', 'staffing_agency', 'temporary_employment_agencies', 'employment_agency'],
    keywords: ['staffing', 'employment agency', 'temp agency', 'recruit'],
    excludeCategories: /real_estate|restaurant|store|retail|church|school/,
    includeNames: /staffing|employment|temp\b|recruit|personnel|workforce|talent/i,
    strongNames: /staffing/i,
    excludeNames: /^$/,
    hardExcludeNames: /^$/,
    healthcare: false,
    defaultSegment: 'staffing',
  },
]

const ALIASES: Record<string, string> = {
  'home care': 'home-care-health',
  'home health': 'home-care-health',
  'home care and home health': 'home-care-health',
  'home-care': 'home-care-health',
  'home-health': 'home-care-health',
  staffing: 'staffing',
  'staffing agency': 'staffing',
  'staffing agencies': 'staffing',
}

export function resolveNiche(text: string): Niche {
  const t = text.trim().toLowerCase()
  const key = ALIASES[t] ?? t
  const preset = PRESETS.find((p) => p.key === key)
  if (preset) return preset
  return {
    key: t.replace(/\s+/g, '-'),
    label: text.trim(),
    googleQueries: [text.trim()],
    overtureTaxonomies: [t.replace(/\s+/g, '_')],
    keywords: [t],
    excludeCategories: /^$/,
    includeNames: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    strongNames: /^$/,
    excludeNames: /^$/,
    hardExcludeNames: /^$/,
    healthcare: false,
    defaultSegment: t,
  }
}

export interface NicheEvidence {
  names: string[]
  /** CMS or NPPES confirms it is a home health or home care agency. */
  government: boolean
  /** It matches a brand on the franchise list (all home care or home health brands). */
  brand: boolean
  /** Overture's own category for it is in the niche (e.g. home_health_care). */
  category: boolean
}

/** '' when the business belongs in the niche, else a plain-language reason it does not. */
export function nicheMismatch(niche: Niche, ev: NicheEvidence): string {
  if (ev.government) return ''
  const label = niche.label.toLowerCase()
  const hard = ev.names.find((n) => niche.hardExcludeNames.test(n))
  if (hard) return `Not ${label}: "${hard}" looks like ${describe(niche.hardExcludeNames.exec(hard)?.[0] ?? '')}`
  const strong = ev.names.some((n) => niche.strongNames.test(n))
  const soft = ev.names.find((n) => niche.excludeNames.test(n))
  if (soft && !strong && !ev.brand) return `Not ${label}: "${soft}" looks like ${describe(niche.excludeNames.exec(soft)?.[0] ?? '')}`
  if (ev.brand || ev.category || ev.names.some((n) => niche.includeNames.test(n))) return ''
  return `Not ${niche.label.toLowerCase()}: nothing in the name or category says it is`
}

function describe(word: string): string {
  const w = word.toLowerCase()
  if (/assisted|memory|nursing|rehab|long|skilled|retire|living|brookdale|peak|group|residential|girls|boys/.test(w)) return 'a care facility, not in-home care'
  if (/walmart|transport|mobility|scooter|supply|medical|oxygen|pharmacy|^iv$/.test(w)) return 'a supplier or transport business'
  if (/day ?care|child|youth|kid/.test(w)) return 'child care or youth services'
  if (/staffing/.test(w)) return 'a staffing agency'
  return `an unrelated business ("${word}")`
}
