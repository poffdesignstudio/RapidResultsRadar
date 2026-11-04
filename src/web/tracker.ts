import { randomBytes } from 'node:crypto'
import { parseCsv } from '../core/csv.js'
import { domainFromUrl, normName, normPhone, streetKey, zip5 } from '../core/normalize.js'
import { LEAD_ID_ALPHABET } from '../leads/ledger.js'
import { checkDnc, type DncRow } from '../match/doNotContact.js'
import { isSuppressed, type Suppression } from '../pipeline.js'
import {
  ALL_STAGES, firstStageForCampaign, isStage, nextStage, parseCampaign,
  type Campaign,
} from '../tracker/stages.js'
import { q, q1 } from './db.js'
import { loadDncRows, loadSuppressionSets } from './stores.js'

/**
 * The Campaign Tracker: named campaigns hold the leads Leah works through the outreach ladder
 * in src/tracker/stages.ts. A campaign carries one of the two types (EMAIL = "Email outreach",
 * LINKEDIN = "DM LinkedIn"), chosen when the campaign is created, and every lead inside
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
  ext_lead_id: string
  domain: string
  est_15_employees: string
  email_status: string
  email_source: string
  company_linkedin_url: string
  contact_facebook_url: string
  bbb_url: string
  chamber_url: string
  confidence: string
  automated_flags: string
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
  'ext_lead_id', 'domain', 'est_15_employees', 'email_status', 'email_source', 'company_linkedin_url',
  'contact_facebook_url', 'bbb_url', 'chamber_url', 'confidence', 'automated_flags',
] as const
export type TrackerField = (typeof TRACKER_FIELDS)[number]

const SELECT = `SELECT id::int AS id, campaign_id::int AS campaign_id, company_name, segment, franchise_brand, contact_name, contact_title,
  personal_email, company_email, phone, contact_phone, address, city, state, zip, website,
  linkedin_url, facebook_url, ext_lead_id, domain, est_15_employees, email_status, email_source,
  company_linkedin_url, contact_facebook_url, bbb_url, chamber_url, confidence, automated_flags,
  source, notes, stage, stage_updated_at, skip_website_form,
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

/**
 * The do-not-contact screening every lead entering a campaign goes through, in the order
 * the checks have always run: suppression by email or domain, the existing-clients list,
 * suppression by phone, then suppression by business name. Both lists count — a client
 * "drop" match or any suppression match keeps the lead out. Returns why the lead is
 * blocked (the suffix the import summary has always shown), or null when it may be worked.
 */
export function trackerDncBlock(
  data: Partial<Record<TrackerField, string>>,
  dnc: DncRow[] | null,
  sup: Suppression,
): string | null {
  const emails = [data.personal_email, data.company_email].filter(Boolean) as string[]
  const domain = domainFromUrl(data.website ?? '')
  if (emails.some((e) => isSuppressed(sup, e)) || (domain && isSuppressed(sup, undefined, domain))) {
    return 'on the DNC list'
  }
  if (dnc) {
    const d = checkDnc(dnc, { names: [data.company_name ?? ''], brand: data.franchise_brand || undefined, city: data.city, state: data.state })
    if (d.action === 'drop') return d.reason ?? 'on the DNC list'
  }
  // Both lists screen on phone too, and suppression entries with a business
  // name screen on name — the same coverage the search applies.
  const phones = [normPhone(data.phone ?? ''), normPhone(data.contact_phone ?? '')].filter(Boolean)
  if (phones.some((p) => sup.phones?.has(p))) return 'on the DNC list'
  if (sup.names?.length) {
    const s = checkDnc(sup.names, { names: [data.company_name ?? ''], brand: data.franchise_brand || undefined, city: data.city, state: data.state })
    if (s.action === 'drop') return 'on the suppression list'
  }
  return null
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

/** A hand-entered lead gets a clearly manual LEAD ID, in the app's usual ID shape, unique across campaigns. */
async function newManualExtLeadId(): Promise<string> {
  for (let tries = 0; tries < 10; tries++) {
    const candidate = 'MANUAL-' + [...randomBytes(8)].map((x) => LEAD_ID_ALPHABET[x % 32]).join('')
    const taken = await q1('SELECT 1 FROM tracker_leads WHERE ext_lead_id=$1', [candidate])
    if (!taken) return candidate
  }
  throw new Error('Could not assign a lead ID — please try again')
}

/**
 * One lead typed in by hand (the Add lead forms). Same record shape as an imported lead —
 * first stage of the campaign's ladder, name + phone dedupe within the campaign — plus the
 * housekeeping a spreadsheet row normally brings with it: the domain comes from the
 * website, the source reads "Manual entry", and the lead gets a MANUAL- lead ID so Leah's
 * sheets can match it on LEAD ID later. A lead on either do-not-contact list is refused
 * with the reason instead of being added.
 */
export async function createManualTrackerLead(
  campaignId: number,
  input: Partial<Record<TrackerField, string>>,
): Promise<TrackerLead> {
  const data = clean(input)
  if (!data.company_name) throw new Error('Company name is required')
  if (!data.domain && data.website) data.domain = domainFromUrl(data.website)
  if (!data.source) data.source = 'Manual entry'
  const block = trackerDncBlock(data, await loadDncRows(), await loadSuppressionSets())
  if (block) throw new Error(`"${data.company_name}" was not added — it matches the do-not-contact list (${block}).`)
  if (!data.ext_lead_id) data.ext_lead_id = await newManualExtLeadId()
  return createTrackerLead(campaignId, data, 'manual')
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
 * "BusinessName" all match — and so do John's exact sheet headers, apostrophes and all
 * ("CONTACT'S EMAIL" -> "contactsemail", "CONTACT PERSON'S  LINKEDIN URL" ->
 * "contactpersonslinkedinurl"). The Radar sheet shape (company_name, contact_email, ...)
 * is covered too.
 */
const HEADER_FIELDS: [TrackerField, string[]][] = [
  ['ext_lead_id', ['leadid']],
  ['company_linkedin_url', ['companylinkedinurl', 'linkedincompanyurl']],
  ['linkedin_url', ['contactpersonslinkedinurl', 'contactpersonlinkedinurl', 'linkedincontacturl', 'contactlinkedinurl', 'linkedinurl', 'linkedin', 'linkedinprofile']],
  ['contact_facebook_url', ['contactpersonalsfacebookurl', 'contactpersonsfacebookurl', 'contactpersonalfacebookurl', 'contactfacebookurl', 'personalfacebookurl']],
  ['facebook_url', ['companyfacebookurl', 'facebookurl', 'facebookpage', 'facebook']],
  ['personal_email', ['contactsemail', 'personalemail', 'contactemail', 'owneremail', 'directemail', 'email', 'emailaddress']],
  ['company_email', ['companyemail', 'businessemail', 'genericemail', 'infoemail', 'officeemail']],
  ['email_status', ['emailstatus']],
  ['email_source', ['emailsource']],
  ['contact_phone', ['contactphone', 'cellphone', 'cell', 'mobilephone', 'mobile', 'directphone', 'landline', 'personalphone']],
  ['phone', ['phone', 'phonenumber', 'businessphone', 'companyphone', 'mainphone', 'telephonenumber', 'telephone']],
  ['company_name', ['companyname', 'businessname', 'business', 'company', 'clientname', 'name']],
  ['segment', ['segment', 'niche', 'industry', 'category']],
  ['franchise_brand', ['franchisebrand', 'brand']],
  ['contact_name', ['contactsname', 'contactname', 'contact', 'ownername', 'owner', 'decisionmaker', 'contactperson', 'fullname']],
  ['contact_title', ['contactstitle', 'contacttitle', 'title', 'jobtitle', 'role']],
  ['address', ['address', 'streetaddress', 'street', 'mailingaddress']],
  ['city', ['city']],
  ['state', ['state']],
  ['zip', ['zip', 'zipcode', 'postalcode']],
  ['website', ['website', 'websiteurl', 'site', 'url', 'webaddress']],
  ['domain', ['domain']],
  ['est_15_employees', ['estimate15ormoreemployees', 'estimate15ormoreemployee', 'est15ormoreemployees', 'employeeestimate']],
  ['bbb_url', ['bbburl', 'bbb']],
  ['chamber_url', ['chamberofcommerceurl', 'chamberurl']],
  ['confidence', ['confidencescore', 'confidence']],
  ['automated_flags', ['automatedflags', 'flags']],
  ['source', ['source']],
  ['notes', ['notes', 'note', 'comments', 'comment']],
]

export function mapTrackerRow(raw: Record<string, string>): Partial<Record<TrackerField, string>> {
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
 * CAMPAIGN first on the sheet's LEAD ID when the row carries one, then on the dedupe key
 * (name + phone, email as fallback), and only refresh business/contact fields — the stage,
 * outcome, skip flags and stage history are never touched, and any campaign column in the
 * sheet is ignored: the campaign comes from where the import is run. Rows on either
 * do-not-contact list (a client "drop" match, or a suppression match on email, domain,
 * phone or business name) are skipped and counted.
 */
export async function importTrackerCsv(text: string, fileName: string, campaignId: number): Promise<TrackerImportSummary> {
  return importTrackerRows(parseCsv(text), fileName, campaignId)
}

/**
 * The shared import pipeline. `raw` is header-keyed row objects from either a
 * CSV (parseCsv) or the first worksheet of an Excel file (parseSheetRows) —
 * both normalized to trimmed string values, so everything downstream (header
 * mapping, dedupe, DNC screening) treats the two formats identically.
 */
export async function importTrackerRows(raw: Record<string, string>[], fileName: string, campaignId: number): Promise<TrackerImportSummary> {
  await requireTrackerCampaign(campaignId)
  if (!raw.length) throw new Error('The file has no rows')
  const dnc = await loadDncRows()
  const sup = await loadSuppressionSets()
  const summary: TrackerImportSummary = { rows: raw.length, added: 0, updated: 0, skippedSuppressed: 0, suppressedReasons: [], errors: [] }
  const noteSuppressed = (reason: string) => {
    summary.skippedSuppressed++
    if (summary.suppressedReasons.length < 50 && !summary.suppressedReasons.includes(reason)) summary.suppressedReasons.push(reason)
  }
  for (let i = 0; i < raw.length; i++) {
    const data = mapTrackerRow(raw[i])
    try {
      if (!data.company_name) throw new Error('No company/business name column matched this row')
      const emails = [data.personal_email, data.company_email].filter(Boolean) as string[]
      const block = trackerDncBlock(data, dnc, sup)
      if (block) { noteSuppressed(`${data.company_name}: ${block}`); continue }
      // A LEAD ID in the sheet is the row's identity: it wins over the name/phone keys.
      let existing: { id: number } | undefined
      if (data.ext_lead_id) {
        existing = await q1<{ id: number }>(
          'SELECT id::int AS id FROM tracker_leads WHERE campaign_id=$1 AND ext_lead_id=$2', [campaignId, data.ext_lead_id])
      }
      if (!existing) {
        const key = dedupeKeyFor(data)
        existing = await q1<{ id: number }>('SELECT id::int AS id FROM tracker_leads WHERE campaign_id=$1 AND dedupe_key=$2', [campaignId, key])
      }
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

/**
 * The export sheet shape is John's: his 28 columns, his exact headers, in his order —
 * the same headers the import maps — followed by the campaign and stage columns.
 * (CONTACT PERSON'S  LINKEDIN URL keeps the double space of his sheet; the import
 * normalization ignores spacing, so an exported file re-imports cleanly.)
 */
export const SHEET_EXPORT_FIELDS: [TrackerField, string][] = [
  ['ext_lead_id', 'LEAD ID'],
  ['company_name', 'COMPANY NAME'],
  ['segment', 'NICHE'],
  ['franchise_brand', 'FRANCHISE BRAND'],
  ['address', 'ADDRESS'],
  ['city', 'CITY'],
  ['state', 'STATE'],
  ['zip', 'ZIP'],
  ['phone', 'PHONE'],
  ['website', 'WEBSITE'],
  ['domain', 'DOMAIN'],
  ['company_email', 'COMPANY EMAIL'],
  ['est_15_employees', 'ESTIMATE 15 or MORE EMPLOYEES'],
  ['contact_name', "CONTACT'S NAME"],
  ['contact_title', "CONTACT'S TITLE"],
  ['personal_email', "CONTACT'S EMAIL"],
  ['email_status', 'EMAIL STATUS'],
  ['email_source', 'EMAIL SOURCE'],
  ['contact_phone', 'CONTACT PHONE'],
  ['company_linkedin_url', 'COMPANY LINKEDIN URL'],
  ['linkedin_url', "CONTACT PERSON'S  LINKEDIN URL"],
  ['contact_facebook_url', "CONTACT PERSONAL'S FACEBOOK URL"],
  ['bbb_url', 'BBB URL'],
  ['chamber_url', 'CHAMBER OF COMMERCE URL'],
  ['confidence', 'CONFIDENCE SCORE'],
  ['automated_flags', 'AUTOMATED FLAGS'],
  ['notes', 'NOTES'],
  ['facebook_url', 'COMPANY FACEBOOK URL'],
]

export const TRACKER_EXPORT_COLUMNS = [...SHEET_EXPORT_FIELDS.map(([, h]) => h), 'campaign_name', 'campaign_type', 'stage', 'stage_updated_at'] as const

/** One campaign's leads as flat rows for the CSV export, campaign name and type included. */
export async function trackerExportRows(campaignId: number): Promise<Record<string, string>[]> {
  const campaign = await requireTrackerCampaign(campaignId)
  const leads = await listTrackerLeads(campaignId)
  return leads.map((l) => {
    const row: Record<string, string> = {}
    for (const [f, h] of SHEET_EXPORT_FIELDS) row[h] = l[f]
    row.campaign_name = campaign.name
    row.campaign_type = campaign.type
    row.stage = l.stage
    row.stage_updated_at = l.stage_updated_at
    return row
  })
}

export interface CallListEntry {
  id: number
  campaign_id: number
  campaign_name: string
  campaign_type: Campaign
  company_name: string
  contact_name: string
  phone: string
  contact_phone: string
  stage_updated_at: string
}

/** Every lead at CALL OUTREACH, across all campaigns, longest-waiting first — the Calls page. */
export async function listCallList(): Promise<CallListEntry[]> {
  const rows = await q<CallListEntry & { stage_updated_at: Date | string }>(
    `SELECT l.id::int AS id, l.campaign_id::int AS campaign_id, c.name AS campaign_name, c.type AS campaign_type,
       l.company_name, l.contact_name, l.phone, l.contact_phone, l.stage_updated_at
     FROM tracker_leads l JOIN tracker_campaigns c ON c.id = l.campaign_id
     WHERE l.stage = 'CALL OUTREACH'
     ORDER BY l.stage_updated_at, l.company_name`)
  return rows.map((r) => ({ ...r, stage_updated_at: iso(r.stage_updated_at) }))
}
