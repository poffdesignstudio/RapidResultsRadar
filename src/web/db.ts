import postgres from 'postgres'

/**
 * Postgres (Neon or Supabase) through DATABASE_URL. The tables are created on first use, so a
 * new empty database works with no setup step.
 */
let client: postgres.Sql | null = null
let ready: Promise<void> | null = null

export class MissingConfigError extends Error {}

export function dbConfigured(): boolean {
  return !!(process.env.DATABASE_URL || process.env.POSTGRES_URL)
}

function sql(): postgres.Sql {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) throw new MissingConfigError('DATABASE_URL is not set. Connect a Postgres database (see the setup page).')
  // One connection per serverless instance; prepare:false works with poolers (Neon, Supabase).
  client ??= postgres(url, { max: 1, prepare: false, idle_timeout: 20, onnotice: () => {} })
  return client
}

/** Runs a query with $1, $2 parameters and returns the rows. */
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema()
  return (await sql().unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[]
}

export async function q1<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0]
}

/** JSON values must be passed through this so postgres.js sends them as jsonb. */
export const json = (v: unknown) => sql().json(v as postgres.JSONValue)

function ensureSchema(): Promise<void> {
  ready ??= sql().unsafe(SCHEMA).then(() => undefined).catch((e) => { ready = null; throw e })
  return ready
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  lead_id text PRIMARY KEY,
  data jsonb NOT NULL,            -- one value per CSV column
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb, -- source and confidence per field
  first_seen text NOT NULL,       -- MM-DD-YYYY
  last_search_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lead_keys (
  key text PRIMARY KEY,           -- google:<place id>, npi:<n>, ccn:<n>, phone:<10 digits>, ...
  lead_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_keys_lead ON lead_keys (lead_id);
CREATE TABLE IF NOT EXISTS lead_changes (
  id bigserial PRIMARY KEY,
  lead_id text NOT NULL,
  col text NOT NULL,
  old_value text,
  new_value text,
  source text NOT NULL,           -- manual, import:<file name>
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_changes_lead ON lead_changes (lead_id);
CREATE TABLE IF NOT EXISTS searches (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  params jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',   -- queued, running, done, failed
  phase text NOT NULL DEFAULT 'start',
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  report text,
  error text,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS search_records (
  search_id integer NOT NULL,
  source text NOT NULL,
  records jsonb NOT NULL,
  PRIMARY KEY (search_id, source)
);
CREATE TABLE IF NOT EXISTS search_leads (
  search_id integer NOT NULL,
  lead_id text NOT NULL,
  lead jsonb NOT NULL,            -- the working lead between steps
  needs_crawl boolean NOT NULL DEFAULT false,
  excluded text,
  PRIMARY KEY (search_id, lead_id)
);
CREATE TABLE IF NOT EXISTS profiles (
  id serial PRIMARY KEY,
  name text UNIQUE NOT NULL,
  params jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_settings (
  source text PRIMARY KEY,
  enabled boolean NOT NULL,
  max_per_run integer NOT NULL DEFAULT 0,
  max_per_month integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS provider_usage (
  month text NOT NULL,            -- MM-YYYY
  source text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  PRIMARY KEY (month, source)
);
CREATE TABLE IF NOT EXISTS do_not_contact (
  id serial PRIMARY KEY,
  row jsonb NOT NULL,
  file_name text,
  imported_on text NOT NULL       -- MM-DD-YYYY
);
CREATE TABLE IF NOT EXISTS suppression (
  value text PRIMARY KEY,         -- an email address, or @domain.com for a whole domain
  reason text,
  added_on text NOT NULL          -- MM-DD-YYYY
);
CREATE TABLE IF NOT EXISTS crawl_cache (
  key text PRIMARY KEY,
  result jsonb NOT NULL,
  crawled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tracker_leads (
  id bigserial PRIMARY KEY,
  dedupe_key text NOT NULL,  -- normalized company name + phone, or email when there is no phone; unique per campaign (see index below)
  campaign_id integer,       -- the campaign (src/web/tracker.ts TrackerCampaign) this lead is worked in
  company_name text NOT NULL DEFAULT '',
  segment text NOT NULL DEFAULT '',
  franchise_brand text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_title text NOT NULL DEFAULT '',
  personal_email text NOT NULL DEFAULT '',
  company_email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  zip text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  linkedin_url text NOT NULL DEFAULT '',
  facebook_url text NOT NULL DEFAULT '',
  ext_lead_id text NOT NULL DEFAULT '',  -- the LEAD ID from John's spreadsheet; the primary import match when present
  domain text NOT NULL DEFAULT '',
  est_15_employees text NOT NULL DEFAULT '',
  email_status text NOT NULL DEFAULT '',
  email_source text NOT NULL DEFAULT '',
  company_linkedin_url text NOT NULL DEFAULT '',
  contact_facebook_url text NOT NULL DEFAULT '',
  bbb_url text NOT NULL DEFAULT '',
  chamber_url text NOT NULL DEFAULT '',
  confidence text NOT NULL DEFAULT '',
  automated_flags text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  campaign text NOT NULL DEFAULT 'EMAIL',  -- legacy per-lead type from before named campaigns; unused, the type now lives on tracker_campaigns
  stage text NOT NULL DEFAULT 'INITIAL PERSONAL EMAIL',  -- one of src/tracker/stages.ts
  stage_updated_at timestamptz NOT NULL DEFAULT now(),
  skip_website_form boolean NOT NULL DEFAULT false,  -- stage 8 does not apply to this lead
  skip_facebook_dm boolean NOT NULL DEFAULT false,  -- stage 9 does not apply to this lead
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS campaign text NOT NULL DEFAULT 'EMAIL';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS ext_lead_id text NOT NULL DEFAULT '';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT '';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS est_15_employees text NOT NULL DEFAULT '';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT '';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS email_source text NOT NULL DEFAULT '';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS company_linkedin_url text NOT NULL DEFAULT '';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS contact_facebook_url text NOT NULL DEFAULT '';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS bbb_url text NOT NULL DEFAULT '';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS chamber_url text NOT NULL DEFAULT '';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS confidence text NOT NULL DEFAULT '';
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS automated_flags text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS tracker_campaigns (
  id serial PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'EMAIL',  -- EMAIL or LINKEDIN: which outreach ladder the campaign's leads follow
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tracker_leads ADD COLUMN IF NOT EXISTS campaign_id integer;
-- Leads from before campaigns existed join one auto-created "General" campaign (Email outreach).
INSERT INTO tracker_campaigns (name, type)
  SELECT 'General', 'EMAIL'
  WHERE EXISTS (SELECT 1 FROM tracker_leads WHERE campaign_id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM tracker_campaigns WHERE name = 'General');
UPDATE tracker_leads
  SET campaign_id = (SELECT id FROM tracker_campaigns WHERE name = 'General' ORDER BY id LIMIT 1)
  WHERE campaign_id IS NULL;
-- Dedupe identity is per campaign: the same business may be worked in two campaigns at once.
ALTER TABLE tracker_leads DROP CONSTRAINT IF EXISTS tracker_leads_dedupe_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS tracker_leads_campaign_dedupe ON tracker_leads (campaign_id, dedupe_key);
CREATE INDEX IF NOT EXISTS tracker_leads_campaign_ext ON tracker_leads (campaign_id, ext_lead_id);
CREATE INDEX IF NOT EXISTS tracker_leads_campaign ON tracker_leads (campaign_id);
CREATE INDEX IF NOT EXISTS tracker_leads_stage ON tracker_leads (stage);
CREATE TABLE IF NOT EXISTS tracker_stage_history (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL,
  from_stage text,
  to_stage text NOT NULL,
  source text NOT NULL,           -- manual, import:<file name>
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tracker_stage_history_lead ON tracker_stage_history (lead_id);
`
