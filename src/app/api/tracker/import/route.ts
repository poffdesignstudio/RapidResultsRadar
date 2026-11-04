import { handle } from '../../../../web/api'
import { importTrackerCsv } from '../../../../web/tracker'

export const maxDuration = 300

export const POST = handle(async (req: Request) => {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new Error('Choose a CSV file')
  return importTrackerCsv(await file.text(), file.name)
})
