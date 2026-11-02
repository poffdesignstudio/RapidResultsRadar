import { config } from '../config.js'
import { httpGet, mapLimit } from '../core/http.js'
import { normPhone, zip5, titleCase } from '../core/normalize.js'
import { inArea } from '../geo/area.js'
import type { Provider, RunContext, SourceRecord } from '../core/types.js'

/**
 * NPPES NPI Registry API (free, no key). Organizations (NPI-2) with home health or in-home care
 * taxonomies. Each record names an "authorized official" with a title, which is often the owner
 * or administrator. NPPES has no emails.
 *
 * The API returns at most 200 per call. The source check on 11-01-2026 showed skip working past
 * 1,200, so we page up to skip 2000. We query one city at a time for every town in the radius, which stays far
 * below that, then keep only records whose ZIP is inside the radius.
 *
 * Tested live on 11-01-2026: authorized official name and title present, no email field.
 */
export const NPPES_TAXONOMIES: Record<string, string> = {
  '251E00000X': 'Home Health',
  '253Z00000X': 'In Home Supportive Care',
  '251J00000X': 'Nursing Care',
}

interface NpiResult {
  number: number | string
  basic?: {
    organization_name?: string
    authorized_official_first_name?: string
    authorized_official_last_name?: string
    authorized_official_title_or_position?: string
    authorized_official_telephone_number?: string
    status?: string
    last_updated?: string
  }
  other_names?: { organization_name?: string; type?: string }[]
  addresses?: { address_purpose?: string; address_1?: string; address_2?: string; city?: string; state?: string; postal_code?: string; telephone_number?: string }[]
  taxonomies?: { code?: string; desc?: string; primary?: boolean; state?: string; license?: string }[]
}

export async function nppesQuery(params: Record<string, string>): Promise<{ results: NpiResult[]; count: number; error?: string }> {
  const qs = new URLSearchParams({ version: '2.1', enumeration_type: 'NPI-2', limit: '200', ...params })
  const res = await httpGet(`${config.nppes.apiUrl}?${qs}`, { timeoutMs: 30000 })
  if (!res.ok) return { results: [], count: 0, error: `HTTP ${res.status}: ${res.text.slice(0, 200)}` }
  try {
    const j = JSON.parse(res.text) as { result_count?: number; results?: NpiResult[]; Errors?: { description?: string }[] }
    if (j.Errors?.length) return { results: [], count: 0, error: j.Errors.map((e) => e.description).join('; ') }
    return { results: j.results ?? [], count: j.result_count ?? 0 }
  } catch {
    return { results: [], count: 0, error: `Not JSON: ${res.text.slice(0, 200)}` }
  }
}

export const nppesProvider: Provider & { errors: string[]; calls: number } = {
  name: 'nppes',
  paid: false,
  errors: [],
  calls: 0,

  async search(ctx: RunContext): Promise<SourceRecord[]> {
    const { area, niche, log } = ctx
    if (!niche.healthcare || !config.nppes.enabled) return []
    const jobs: { city: string; state: string; desc: string }[] = []
    for (const p of area.places) for (const desc of Object.values(NPPES_TAXONOMIES)) jobs.push({ city: p.name, state: p.state, desc })
    log(`NPPES: ${jobs.length} queries (${area.places.length} towns x ${Object.keys(NPPES_TAXONOMIES).length} care types)`)
    const byNpi = new Map<string, NpiResult>()
    await mapLimit(jobs, config.nppes.concurrency, async (j) => {
      for (let skip = 0; skip <= 2000; skip += 200) {
        this.calls++
        const r = await nppesQuery({ taxonomy_description: j.desc, city: j.city, state: j.state, skip: String(skip) })
        if (r.error) {
          // "No results" style messages are normal for small towns; anything else is worth reporting.
          if (!/no (matching )?(results|records)/i.test(r.error)) this.errors.push(`${j.city}, ${j.state} / ${j.desc}: ${r.error}`)
          return
        }
        r.results.forEach((x) => byNpi.set(String(x.number), x))
        if (r.results.length < 200) return
      }
    })
    const wanted = new Set(Object.keys(NPPES_TAXONOMIES))
    const out = [...byNpi.values()]
      .filter((r) => r.taxonomies?.some((t) => t.code && wanted.has(t.code)))
      .map((r) => this.normalize(r))
      .filter((r): r is SourceRecord => !!r && inArea(area, r))
    log(`NPPES: ${this.calls} calls, ${byNpi.size} organizations, ${out.length} with a care taxonomy inside the radius${this.errors.length ? `, ${this.errors.length} errors` : ''}`)
    return out
  },

  normalize(raw: unknown): SourceRecord | null {
    const r = raw as NpiResult
    const b = r.basic
    if (!b?.organization_name) return null
    if (b.status && b.status !== 'A') return null
    const loc = r.addresses?.find((a) => a.address_purpose === 'LOCATION') ?? r.addresses?.[0]
    const first = b.authorized_official_first_name ? titleCase(b.authorized_official_first_name) : ''
    const last = b.authorized_official_last_name ? titleCase(b.authorized_official_last_name) : ''
    const codes = new Set((r.taxonomies ?? []).map((t) => t.code))
    return {
      source: 'nppes',
      sourceId: String(r.number),
      ids: { npi: String(r.number) },
      name: titleCase(b.organization_name),
      altNames: (r.other_names ?? []).map((o) => o.organization_name).filter((n): n is string => !!n).map(titleCase),
      address: [loc?.address_1, loc?.address_2].filter(Boolean).map((s) => titleCase(s!)).join(' '),
      city: loc?.city ? titleCase(loc.city) : undefined,
      state: loc?.state,
      zip: zip5(loc?.postal_code),
      phone: normPhone(loc?.telephone_number) || undefined,
      categories: (r.taxonomies ?? []).map((t) => `${t.code} ${t.desc}`),
      homeHealthEvidence: codes.has('251E00000X'),
      people: first || last
        ? [{
            name: `${first} ${last}`.trim(),
            first,
            last,
            title: b.authorized_official_title_or_position ? titleCase(b.authorized_official_title_or_position) : undefined,
            step: 'nppes:authorized_official',
            confidence: 'medium',
          }]
        : [],
    }
  },

  estimateCost: () => 0,
}
