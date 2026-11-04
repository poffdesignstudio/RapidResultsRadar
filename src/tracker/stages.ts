/**
 * The Campaign Tracker pipelines, in the order Leah works them (set by John, Nov 3 2026).
 * The tracker only records outreach Leah performs elsewhere; it never sends anything.
 *
 * Leads live inside a named campaign, and the campaign carries one of two types, chosen
 * when the campaign is created. Both types use the same ten outreach steps and the same
 * outcome statuses. They differ only in which channel block comes first: personal email or
 * LinkedIn. The company-email tail, including the final CALL OUTREACH step, is shared.
 * Stored stage values are the exact uppercase names; the UI shows them title-cased.
 */
export const CAMPAIGNS = ['EMAIL', 'LINKEDIN'] as const
export type Campaign = (typeof CAMPAIGNS)[number]

export const CAMPAIGN_LABELS: Record<Campaign, string> = {
  EMAIL: 'Email outreach',
  LINKEDIN: 'LinkedIn outreach',
}

export const CAMPAIGN_SHORT_LABELS: Record<Campaign, string> = {
  EMAIL: 'Email',
  LINKEDIN: 'LinkedIn',
}

const EMAIL_STAGES = [
  'INITIAL PERSONAL EMAIL',
  'FU PERSONAL EMAIL',
  '2ND FU PERSONAL EMAIL',
] as const

const LINKEDIN_STAGES = [
  'INITIAL LINKEDIN DM',
  'FU LINKEDIN DM',
  '2ND FU LINKEDIN DM',
] as const

const SHARED_TAIL_STAGES = [
  'INITIAL COMPANY EMAIL',
  'INITIAL COMPANY WEBSITE FORM',
  'COMPANY FACEBOOK DM',
  'CALL OUTREACH',
] as const

export const EMAIL_OUTREACH_STAGES = [...EMAIL_STAGES, ...LINKEDIN_STAGES, ...SHARED_TAIL_STAGES] as const
export const LINKEDIN_OUTREACH_STAGES = [...LINKEDIN_STAGES, ...EMAIL_STAGES, ...SHARED_TAIL_STAGES] as const

/** The EMAIL campaign ladder, retained as the default/canonical stage list. */
export const OUTREACH_STAGES = EMAIL_OUTREACH_STAGES

export const OUTREACH_STAGES_BY_CAMPAIGN: Record<Campaign, readonly string[]> = {
  EMAIL: EMAIL_OUTREACH_STAGES,
  LINKEDIN: LINKEDIN_OUTREACH_STAGES,
}

export const OUTCOMES = ['CONTACTED', 'MEETING SCHEDULED', 'WON', 'LOST', 'NO CONTACT'] as const

export const ALL_STAGES: string[] = [...new Set([...EMAIL_OUTREACH_STAGES, ...LINKEDIN_OUTREACH_STAGES]), ...OUTCOMES]

export const FIRST_STAGE: string = EMAIL_OUTREACH_STAGES[0]

export const isCampaign = (value: unknown): value is Campaign => (CAMPAIGNS as readonly unknown[]).includes(value)

/** Accepts stored campaign values and their display labels, case-insensitively. */
export function parseCampaign(value: unknown): Campaign | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toUpperCase().replace(/[^A-Z]/g, '')
  if (normalized === 'EMAIL' || normalized === 'EMAILOUTREACH') return 'EMAIL'
  if (normalized === 'LINKEDIN' || normalized === 'LINKEDINOUTREACH') return 'LINKEDIN'
  return undefined
}

export const campaignOrDefault = (value: unknown): Campaign => parseCampaign(value) ?? 'EMAIL'
export const campaignLabel = (campaign: unknown): string => CAMPAIGN_LABELS[campaignOrDefault(campaign)]
export const campaignShortLabel = (campaign: unknown): string => CAMPAIGN_SHORT_LABELS[campaignOrDefault(campaign)]
export const stagesForCampaign = (campaign: unknown): readonly string[] => OUTREACH_STAGES_BY_CAMPAIGN[campaignOrDefault(campaign)]
export const firstStageForCampaign = (campaign: unknown): string => stagesForCampaign(campaign)[0]

/** Stages a given lead can skip: the website-form step and the Facebook step are conditional. */
export const SKIPPABLE: Record<string, 'skip_website_form' | 'skip_facebook_dm'> = {
  'INITIAL COMPANY WEBSITE FORM': 'skip_website_form',
  'COMPANY FACEBOOK DM': 'skip_facebook_dm',
}

export const isStage = (s: string): boolean => ALL_STAGES.includes(s)
export const isOutcome = (s: string): boolean => (OUTCOMES as readonly string[]).includes(s)

/** "2ND FU PERSONAL EMAIL" -> "2nd FU personal email" for display. */
const KEEP_UPPER = new Set(['FU', 'DM'])
export function stageLabel(stage: string): string {
  return stage
    .split(' ')
    .map((w) => (KEEP_UPPER.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ')
}

interface StageLead {
  campaign?: unknown
  skip_website_form?: boolean
  skip_facebook_dm?: boolean
}

/**
 * The next outreach step for a lead on its own campaign ladder, honoring its skip flags.
 * Returns null when the lead is already at (or past) the last outreach step, or is in an
 * outcome status.
 */
export function nextStage(stage: string, lead: StageLead): string | null {
  const ladder = stagesForCampaign(lead.campaign)
  const i = ladder.indexOf(stage)
  if (i < 0) return null
  for (let j = i + 1; j < ladder.length; j++) {
    const s: string = ladder[j]
    const flag = SKIPPABLE[s]
    if (flag && lead[flag]) continue
    return s
  }
  return null
}
