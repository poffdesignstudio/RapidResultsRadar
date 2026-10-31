import type { Niche } from './core/types.js'

/** Built-in niches. Any other niche text still works: it is used as the Google query and keyword. */
const PRESETS: Niche[] = [
  {
    key: 'home-care-health',
    label: 'Home care and home health',
    googleQueries: ['home care agency', 'home health agency', 'in-home senior care'],
    overtureTaxonomies: ['home_health_care', 'home_care', 'in_home_care', 'senior_care', 'elder_care', 'personal_care_service', 'nursing_service'],
    keywords: ['home care', 'home health', 'homecare', 'in-home', 'in home', 'caregiver', 'caregivers', 'senior care', 'companion care', 'private duty', 'home instead', 'visiting angels', 'comfort keepers', 'right at home', 'nurse next door'],
    excludeCategories: /real_estate|developer|salon|beauty|barber|spa|pet|veterinar|cleaning|contractor|repair|furniture|insurance|construction|restaurant|store|retail|assisted_living|retirement_home|nursing_home|church|school/,
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
    healthcare: false,
    defaultSegment: t,
  }
}
