export type SourceName = 'google' | 'overture' | 'cms_hha' | 'cms_owners' | 'nppes' | 'website'
export type Confidence = 'high' | 'medium' | 'low'

/** A person found by any source, with the step that found them. */
export interface Person {
  name: string
  first?: string
  last?: string
  title?: string
  /** The step that found this person, e.g. "website:about", "nppes:authorized_official". */
  step: string
  confidence: Confidence
  email?: string
}

/** One business as one source describes it, already normalized. */
export interface SourceRecord {
  source: SourceName
  sourceId: string
  name: string
  altNames?: string[]
  address?: string
  city?: string
  state?: string
  zip?: string
  phone?: string
  website?: string
  emails?: string[]
  lat?: number
  lng?: number
  categories?: string[]
  closed?: boolean
  /** e.g. "Proprietary", "Non-profit", from CMS. */
  ownership?: string
  people?: Person[]
  /** 0 to 1, from the source when it gives one. */
  sourceConfidence?: number
  /** Other IDs that link sources together, e.g. { ccn: '347001' }. */
  ids?: Record<string, string>
  /** True when the record proves the business is a Medicare-certified or NPI home health agency. */
  homeHealthEvidence?: boolean
}

/** A field value plus where it came from. */
export interface Field<T = string> {
  value: T
  source: string
  confidence: Confidence
}

export interface SearchArea {
  label: string
  centerLat: number
  centerLng: number
  radiusMiles: number
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  /** ZIP codes whose center is inside the radius. Empty when the ZIP list is unavailable. */
  zips: Set<string>
  /** Cities and towns (with state) whose center is inside the radius. */
  places: { name: string; state: string }[]
  states: Set<string>
}

export interface Niche {
  key: string
  label: string
  googleQueries: string[]
  overtureTaxonomies: string[]
  keywords: string[]
  /** Overture categories that rule a keyword match out (e.g. real estate for "home"). */
  excludeCategories: RegExp
  /** A business name with one of these words is likely in the niche. */
  includeNames: RegExp
  /** A name with one of these is clearly in the niche ("home health"), even next to a word like "hospital". */
  strongNames: RegExp
  /** A name with one of these is not in the niche (facilities, unrelated trades), unless it also has a strong name. */
  excludeNames: RegExp
  /** A name with one of these is never in the niche, whatever else it says ("In Home Daycare"). */
  hardExcludeNames: RegExp
  /** Run the CMS and NPPES home health sources. */
  healthcare: boolean
  defaultSegment: string
}

export interface RunContext {
  niche: Niche
  area: SearchArea
  log: (msg: string) => void
}

export interface Provider {
  name: SourceName
  paid: boolean
  search(ctx: RunContext): Promise<SourceRecord[]>
  normalize(raw: unknown): SourceRecord | null
  /** Estimated cost in US dollars of the given number of calls, after any free allowance. */
  estimateCost(calls: number): number
}
