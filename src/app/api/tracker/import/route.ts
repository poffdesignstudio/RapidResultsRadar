import { handle } from '../../../../web/api'
import { importTrackerCsv } from '../../../../web/tracker'

export const maxDuration = 300

/** Imports run inside a campaign: every row lands in the campaign named by campaign_id. */
export const POST = handle(async (req: Request) => {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new Error('Choose a CSV file')
  const campaignId = Number(form.get('campaign_id') ?? new URL(req.url).searchParams.get('campaign_id'))
  if (!Number.isInteger(campaignId) || campaignId <= 0) throw new Error('Choose a campaign first (campaign_id is required)')
  return importTrackerCsv(await file.text(), file.name, campaignId)
})
