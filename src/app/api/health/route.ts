import { NextResponse } from 'next/server'
import { configChecks } from '../../../web/env'
import { q, dbConfigured } from '../../../web/db'

export const dynamic = 'force-dynamic'

/** Public: which settings are present (never their values) and whether the database answers. */
export async function GET() {
  let database = 'not configured'
  if (dbConfigured()) {
    try { await q('SELECT 1'); database = 'connected' } catch (e) { database = `error: ${(e as Error).message}` }
  }
  return NextResponse.json({ checks: configChecks().map(({ name, ok, required }) => ({ name, ok, required })), database })
}
