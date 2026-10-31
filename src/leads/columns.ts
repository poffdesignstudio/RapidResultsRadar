/** The shared CSV schema for Lead Digger, Leia and the Lead Tracker. Order matters. */
export const COLUMNS = [
  'lead_id', 'source', 'source_id', 'date_found', 'company_name', 'segment', 'franchise_brand',
  'address', 'city', 'state', 'zip', 'phone', 'website', 'domain', 'employee_estimate', 'hiring_signal',
  'contact_name', 'contact_title', 'contact_email', 'email_status', 'email_source', 'contact_phone',
  'linkedin_company_url', 'linkedin_contact_url', 'facebook_url', 'bbb_url', 'chamber_url',
  'confidence', 'flags', 'review_status', 'campaign_name', 'campaign_start', 'notes',
] as const
export type Column = (typeof COLUMNS)[number]

/** Columns Rapid Radar fills and tracks the source of. */
export const TRACKED: Column[] = [
  'company_name', 'address', 'city', 'state', 'zip', 'phone', 'website', 'domain', 'franchise_brand',
  'hiring_signal', 'contact_name', 'contact_title', 'contact_email', 'segment',
]
