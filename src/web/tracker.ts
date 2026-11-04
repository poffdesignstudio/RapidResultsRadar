import { parseCsv } from '../core/csv.js'
import { domainFromUrl, normName, normPhone, streetKey, zip5 } from '../core/normalize.js'
import { checkDnc } from '../match/doNotContact.js'
import { isSuppressed } from '../pipeline.js'
import {
  ALL_STAGES, firstStageForCampaign, isStage, nextStage, parseCampaign,
  type Campaign,
} from '../tracker/stages.js'
import { q, q1 } from './db.js'
import { loadDncRows, loadSuppressionSets } from './stores.js'

/**
 * The Campaign Tracker: named campaigns hold the leads Leah works through the outreach ladder
 * in src/tracker/stages.ts. A campaign carries one of the two types (EMAIL = "Email outreach",
 * LINKEDIN = "LinkedIn outreach"), chosen when the campaign is created, and every lead inside
 * it follows that type's ladder. Separate from the search `leads` table — these rows carry a
 * stage, and the stage (plus its history) belongs to the tracker alone: CSV imports refresh
 * contact data, never the stage.
 */
export interface TrackerCampaign {
  id: number
  name: string
  type: Campaign
  lead_count: number
  created_at: string
  updated_at: string
}

export interface TrackerLead {
  id: number
  campaign_id: number
  company_name: string
  segment: string
  franchise_brand: string
  contact_name: string
  contact_title: string
  personal_email: string
  company_email: string
  phone: string
  contact_phone: string
  address: string
  city: string
  state: string
  zip: string
  website: string
  linkedin_url: string
  facebook_url: string
  source: string
  notes: string
  stage: string
  stage_updated_at: string
  skip_website_form: boolean
  skip_facebook_dm: boolean
  created_at: string
  updated_at: string
}

/** Business/contact fields a person or a spreadsheet may set. Stage is NOT one of them. */
export const TRACKER_FIELDS = [
  'company_name', 'segment', 'franchise_brand', 'contact_name', 'contact_title', 'personal_email',
  'company_email', 'phone', 'contact_phone', 'address', 'city', 'state', 'zip', 'website',
  'linkedin_url', 'facebook_url', 'source', 'notes',
] as const
export type TrackerField = (typeof TRACKER_FIELDS)[number]

const SELECT = `SELECT id::int AS id, campaign_id::int AS campaign_id, company_name, segment, franchise_brand, contact_name, contact_title,
  personal_email, company_email, phone, contact_phone, address, city, state, zip, website,
  linkedin_url, facebook_url, source, notes, stage, stage_updated_at, skip_website_form,
  skip_facebook_dm, created_at, updated_at FROM tracker_leads`

const CAMPAIGN_SELECT = `SELECT c.id::int AS id, c.name, c.type, count(l.id)::int AS lead_count, c.created_at, c.updated_at
  FROM tracker_campaigns c LEFT JOIN tracker_leads l ON l.campaign_id = c.id`

type RawLead = Omit<TrackerLead, 'stage_updated_at' | 'created_at' | 'updated_at'> & {
  stage_updated_at: Date | string
  created_at: Date | string
  updated_at: Date | string
}

type RawCampaign = Omit<TrackerCampaign, 'created_at' | 'updated_at'> & {
  created_at: Date | string
  updated_at: Date | string
}

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v))
const asLead = (r: RawLead): TrackerLead => ({ ...r, stage_updated_at: iso(r.stage_updated_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at) })
const asCampaign = (r: RawCampaign): TrackerCampaign => ({ ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at) })

export async function listTrackerCampaigns(): Promise<TrackerCampaign[]> {
  const rows = await q<RawCampaign>(`${CAMPAIGN_SELECT} GROUP BY c.id ORDER BY c.created_at, c.id`)
  return rows.map(asCampaign)
}

export async function getTrackerCampaign(id: number): Promise<TrackerCampaign | undefined> {
  const row = await q1<RawCampaign>(`${CAMPAIGN_SELECT} WHERE c.id=$1 GROUP BY c.id`, [id])
  return row ? asCampaign(row) : undefined
}

async function requireTrackerCampaign(id: number): Promise<TrackerCampaign> {
  const campaign = await getTrackerCampaign(id)
  if (!campaign) throw new Error('Campaign not found')
  return campaign
}

export async function createTrackerCampaign(name: string, type: unknown): Promise<TrackerCampaign> {
  const cleanName = String(name ?? '').trim()
  if (!cleanName) throw new Error('Campaign name is required')
  const parsed = parseCampaign(type)
  if (!parsed) throw new Error('Campaign type must be EMAIL or LINKEDIN')
  const inserted = await q1<{ id: number }>(
    'INSERT INTO tracker_campaigns (name, type) VALUES ($1, $2) RETURNING id::int AS id', [cleanName, parsed])
  if (!inserted) throw new Error('Could not create the campaign')
  return (await getTrackerCampaign(inserted.id))!
}

export async function listTrackerLeads(campaignId: number): Promise<TrackerLead[]> {
  const rows = await q<RawLead>(`${SELECT} WHERE campaign_id=$1 ORDER BY company_name, id LIMIT 10000`, [campaignId])
  return rows.map(asLead)
}

export interface StageHistoryEntry { from_stage: string | null; to_stage: string; source: string; changed_at: string }

export async function getTrackerLead(id: number): Promise<(TrackerLead & { history: StageHistoryEntry[] }) | undefined> {
  const row = await q1<RawLead>(`${SELECT} WHERE id=$1`, [id])
  if (!row) return undefined
  const history = await q<{ from_stage: string | null; to_stage: string; source: string; changed_at: Date | string }>(
    'SELECT from_stage, to_stage, source, changed_at FROM tracker_stage_history WHERE lead_id=$1 ORDER BY id DESC LIMIT 30', [id])
  return { ...asLead(row), history: history.map((h) => ({ ...h, changed_at: iso(h.changed_at) })) }
}

/** The identity a spreadsheet row is matched on within its campaign: normalized company name + phone, email as fallback. */
export function dedupeKeyFor(d: Partial<Record<TrackerField, string>>): string {
  const name = normName(d.company_name ?? '')
  const phone = normPhone(d.phone ?? '') || normPhone(d.contact_phone ?? '')
  if (name && phone) return `${name}|${phone}`
  const email = (d.personal_email || d.company_email || '').trim().toLowerCase()
  if (email) return `email:${email}`
  const where = `${streetKey(d.address ?? '')} ${(d.city ?? '').trim().toLowerCase()} ${(d.state ?? '').trim().toUpperCase()} ${zip5(d.zip ?? '')}`.trim()
  return `${name}|${where}`
}

const clean = (patch: Partial<Record<TrackerField, string>>) => {
  const out: Partial<Record<TrackerField, string>> = {}
  for (const f of TRACKER_FIELDS) if (patch[f] !== undefined) out[f] = String(patch[f]).trim()
  return out
}

/** A new lead starts at stage 1 of its campaign's ladder (LINKEDIN campaigns start at INITIAL LINKEDIN DM). */
export async function createTrackerLead(
  campaignId: number,
  input: Partial<Record<TrackerField, string>>,
  source = 'manual',
): Promise<TrackerLead> {
  const campaign = await requireTrackerCampaign(campaignId)
  const data = clean(input)
  if (!data.company_name) throw new Error('Company name is required')
  const firstStage = firstStageForCampaign(campaign.type)
  const key = dedupeKeyFor(data)
  const dupe = await q1('SELECT 1 FROM tracker_leads WHERE campaign_id=$1 AND dedupe_key=$2', [campaignId, key])
  if (dupe) throw new Error('A lead with this company name and phone (or email) already exists in this campaign')
  const params: unknown[] = [key, campaignId, ...TRACKER_FIELDS.map((f) => data[f] ?? ''), firstStage]
  const inserted = await q1<{ id: number }>(
    `INSERT INTO tracker_leads (dedupe_key, campaign_id, ${TRACKER_FIELDS.join(', ')}, stage)
     VALUES (${params.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id::int AS id`,
    params)
  if (!inserted) throw new Error('Could not create the lead')
  await q('INSERT INTO tracker_stage_history (lead_id, from_stage, to_stage, source) VALUES ($1, NULL, $2, $3)', [inserted.id, firstStage, source])
  return asLead((await q1<RawLead>(`${SELECT} WHERE id=$1`, [inserted.id]))!)
}

/**
 * Edits contact data and skip flags. A lead's campaign (and therefore its ladder) is set by
 * where the lead lives and is not editable here. Stage changes go through setTrackerStage so
 * they are logged.
 */
export async function updateTrackerLead(
  id: number,
  patch: Partial<Record<TrackerField, string>>,
  skips?: { skip_website_form?: boolean; skip_facebook_dm?: boolean },
): Promise<TrackerLead> {
  const data = clean(patch)
  const sets: string[] = []
  const params: unknown[] = [id]
  for (const f of TRACKER_FIELDS) {
    if (data[f] === undefined) continue
    params.push(data[f])
    sets.push(`${f}=$${params.length}`)
  }
  for (const flag of ['skip_website_form', 'skip_facebook_dm'] as const) {
    if (skips?.[flag] === undefined) continue
    params.push(skips[flag])
    sets.push(`${flag}=$${params.length}`)
  }
  if (sets.length) await q(`UPDATE tracker_leads SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params)
  const row = await q1<RawLead>(`${SELECT} WHERE id=$1`, [id])
  if (!row) throw new Error('Lead not found')
  return asLead(row)
}

export async function setTrackerStage(id: number, to: string, source = 'manual'): Promise<TrackerLead> {
  if (!isStage(to)) throw new Error(`Unknown stage "${to}". Use one of: ${ALL_STAGES.join(', ')}`)
  const row = await q1<RawLead>(`${SELECT} WHERE id=$1`, [id])
  if (!row) throw new Error('Lead not found')
  if (row.stage === to) return asLead(row)
  await q('UPDATE tracker_leads SET stage=$2, stage_updated_at=now(), updated_at=now() WHERE id=$1', [id, to])
  await q('INSERT INTO tracker_stage_history (lead_id, from_stage, to_stage, source) VALUES ($1,$2,$3,$4)', [id, row.stage, to, source])
  return asLead((await q1<RawLead>(`${SELECT} WHERE id=$1`, [id]))!)
}

/** Moves a lead one outreach step forward on its campaign's ladder, honoring its skip flags. */
export async function advanceTrackerLead(id: number): Promise<TrackerLead> {
  const row = await q1<RawLead>(`${SELECT} WHERE id=$1`, [id])
  if (!row) throw new Error('Lead not found')
  const campaign = await getTrackerCampaign(row.campaign_id)
  const next = nextStage(row.stage, {
    campaign: campaign?.type,
    skip_website_form: row.skip_website_form,
    skip_facebook_dm: row.skip_facebook_dm,
  })
  if (!next) throw new Error(`"${row.company_name}" is at the last outreach step (${row.stage}). Set an outcome instead.`)
  return setTrackerStage(id, next)
}

/**
 * Header aliases for Leah's spreadsheet, most specific first. Headers are compared with
 * spaces, underscores and punctuation removed, so "Business Name", "business_name" and
 * "BusinessName" all match. The Radar sheet shape (company_name, contact_email, ...) is covered.
 */
const HEADER_FIELDS: [TrackerField, string[]][] = [
  ['linkedin_url', ['linkedincontacturl', 'linkedinurl', 'linkedin', 'linkedincompanyurl', 'linkedinprofile']],
  ['personal_email', ['personalemail', 'contactemail', 'owneremail', 'directemail', 'email', 'emailaddress']],
  ['company_email', ['companyemail', 'businessemail', 'genericemail', 'infoemail', 'officeemail']],
  ['contact_phone', ['contactphone', 'cellphone', 'cell', 'mobilephone', 'mobile', 'directphone', 'landline', 'personalphone']],
  ['phone', ['phone', 'phonenumber', 'businessphone', 'companyphone', 'mainphone', 'telephonenumber', 'telephone']],
  ['company_name', ['companyname', 'businessname', 'business', 'company', 'clientname', 'name']],
  ['segment', ['segment', 'niche', 'industry', 'category']],
  ['franchise_brand', ['franchisebrand', 'brand']],
  ['contact_name', ['contactname', 'contact', 'ownername', 'owner', 'decisionmaker', 'contactperson', 'fullname']],
  ['contact_title', ['contacttitle', 'title', 'jobtitle', 'role']],
  ['address', ['address', 'streetaddress', 'street', 'mailingaddress']],
  ['city', ['city']],
  ['state', ['state']],
  ['zip', ['zip', 'zipcode', 'postalcode']],
  ['website', ['website', 'websiteurl', 'site', 'url', 'webaddress']],
  ['facebook_url', ['facebookurl', 'facebookpage', 'facebook']],
  ['source', ['source']],
  ['notes', ['notes', 'note', 'comments', 'comment']],
]

function mapRow(raw: Record<string, string>): Partial<Record<TrackerField, string>> {
  const byNorm = new Map<string, string>()
  for (const [h, v] of Object.entries(raw)) {
    const n = h.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (n && !byNorm.has(n)) byNorm.set(n, v)
  }
  const out: Partial<Record<TrackerField, string>> = {}
  const claimed = new Set<string>()
  for (const [field, candidates] of HEADER_FIELDS) {
    for (const c of candidates) {
      if (claimed.has(c)) continue
      const v = byNorm.get(c)
      if (v !== undefined) { out[field] = v.trim(); claimed.add(c); break }
    }
  }
  return out
}

export interface TrackerImportSummary {
  rows: number
  added: number
  updated: number
  skippedSuppressed: number
  suppressedReasons: string[]
  errors: { row: number; message: string }[]
}

/**
 * Leah's spreadsheet, merged into one campaign. Rows match an existing lead IN THE SAME
 * CAMPAIGN on the dedupe key (name + phone, email as fallback) and only refresh
 * business/contact fields — the stage, outcome, skip flags and stage history are never
 * touched, and any campaign column in the sheet is ignored: the campaign comes from where
 * the import is run. Rows on the DNC list (a "drop" match or a suppression match) are
 * skipped and counted.
 */
export async function importTrackerCsv(text: string, fileName: string, campaignId: number): Promise<TrackerImportSummary> {
  await requireTrackerCampaign(campaignId)
  const raw = parseCsv(text)
  if (!raw.length) throw new Error('The file has no rows')
  const dnc = await loadDncRows()
  const sup = await loadSuppressionSets()
  const summary: TrackerImportSummary = { rows: raw.length, added: 0, updated: 0, skippedSuppressed: 0, suppressedReasons: [], errors: [] }
  const noteSuppressed = (reason: string) => {
    summary.skippedSuppressed++
    if (summary.suppressedReasons.length < 50 && !summary.suppressedReasons.includes(reason)) summary.suppressedReasons.push(reason)
  }
  for (let i = 0; i < raw.length; i++) {
    const data = mapRow(raw[i])
    try {
      if (!data.company_name) throw new Error('No company/business name column matched this row')
      const emails = [data.personal_email, data.company_email].filter(Boolean) as string[]
      const domain = domainFromUrl(data.website ?? '')
      if (emails.some((e) => isSuppressed(sup, e)) || (domain && isSuppressed(sup, undefined, domain))) {
        noteSuppressed(`${data.company_name}: on the DNC list`)
        continue
      }
      if (dnc) {
        const d = checkDnc(dnc, { names: [data.company_name], brand: data.franchise_brand || undefined, city: data.city, state: data.state })
        if (d.action === 'drop') { noteSuppressed(`${data.company_name}: ${d.reason}`); continue }
      }
      const key = dedupeKeyFor(data)
      let existing = await q1<{ id: number }>('SELECT id::int AS id FROM tracker_leads WHERE campaign_id=$1 AND dedupe_key=$2', [campaignId, key])
      if (!existing && emails.length) {
        existing = await q1<{ id: number }>(
          'SELECT id::int AS id FROM tracker_leads WHERE campaign_id=$1 AND (lower(personal_email) = ANY($2) OR lower(company_email) = ANY($2)) LIMIT 1',
          [campaignId, emails.map((e) => e.toLowerCase())])
      }
      if (existing) {
        // Non-empty cells win; blank cells never erase. Stage fields are not in TRACKER_FIELDS,
        // so an import cannot move a lead backwards (or forwards).
        const patch: Partial<Record<TrackerField, string>> = {}
        for (const f of TRACKER_FIELDS) if (data[f]) patch[f] = data[f]
        await updateTrackerLead(existing.id, patch)
        summary.updated++
      } else {
        await createTrackerLead(campaignId, data, `import:${fileName}`)
        summary.added++
      }
    } catch (e) {
      summary.errors.push({ row: i + 2, message: (e as Error).message })
    }
  }
  return summary
}

export const TRACKER_EXPORT_COLUMNS = [...TRACKER_FIELDS, 'campaign_name', 'campaign_type', 'stage', 'stage_updated_at'] as const

/** One campaign's leads as flat rows for the CSV export, campaign name and type included. */
export async function trackerExportRows(campaignId: number): Promise<Record<string, string>[]> {
  const campaign = await requireTrackerCampaign(campaignId)
  const leads = await listTrackerLeads(campaignId)
  return leads.map((l) => {
    const row: Record<string, string> = {}
    for (const f of TRACKER_FIELDS) row[f] = l[f]
    row.campaign_name = campaign.name
    row.campaign_type = campaign.type
    row.stage = l.stage
    row.stage_updated_at = l.stage_updated_at
    return row
  })
}
