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
`
