import { handle } from '../../../../web/api'
import { importLeiaCsv } from '../../../../web/leads'

export const maxDuration = 300

export const POST = handle(async (req: Request) => {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new Error('Choose a CSV file')
  return importLeiaCsv(await file.text(), file.name)
})
