import { handle } from '../../../../web/api'
import { parseSheetRows } from '../../../../core/sheet'
import { importTrackerCsv, importTrackerRows } from '../../../../web/tracker'

export const maxDuration = 300

/** Imports run inside a campaign: every row lands in the campaign named by campaign_id. */
export const POST = handle(async (req: Request) => {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new Error('Choose a CSV or Excel file')
  const campaignId = Number(form.get('campaign_id') ?? new URL(req.url).searchParams.get('campaign_id'))
  if (!Number.isInteger(campaignId) || campaignId <= 0) throw new Error('Choose a campaign first (campaign_id is required)')
  const name = file.name.toLowerCase()
  const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls')
    || file.type.includes('spreadsheetml') || file.type === 'application/vnd.ms-excel'
  const isCsv = name.endsWith('.csv') || file.type.includes('csv')
  // CSVs keep the original text path; Excel files are parsed from the upload
  // buffer into the same header-keyed rows and run through the same import.
  if (isCsv && !isExcel) return importTrackerCsv(await file.text(), file.name, campaignId)
  if (isExcel) return importTrackerRows(parseSheetRows(await file.arrayBuffer()), file.name, campaignId)
  throw new Error('Upload a CSV or Excel file')
})
