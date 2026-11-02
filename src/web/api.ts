import { NextResponse } from 'next/server'
import { MissingConfigError } from './db'

/** Wraps an API handler: errors come back as JSON with a plain message instead of a blank 500. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown>) {
  return async (...args: A): Promise<Response> => {
    try {
      const out = await fn(...args)
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true })
    } catch (e) {
      const missing = e instanceof MissingConfigError
      console.error(e)
      return NextResponse.json({ error: (e as Error).message, missingConfig: missing }, { status: missing ? 503 : 400 })
    }
  }
}

export const csvResponse = (text: string, fileName: string) =>
  new Response(text, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"` } })
