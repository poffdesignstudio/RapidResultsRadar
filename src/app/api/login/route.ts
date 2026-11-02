import { NextResponse } from 'next/server'
import { makeSession, passwordMatches, SESSION_COOKIE } from '../../../web/auth'

export async function POST(req: Request) {
  if (!process.env.ADMIN_PASSWORD) return NextResponse.json({ error: 'ADMIN_PASSWORD is not set in Vercel, so nobody can log in yet.' }, { status: 503 })
  const { password } = (await req.json().catch(() => ({}))) as { password?: string }
  if (!password || !(await passwordMatches(password))) return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  const s = await makeSession()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, s.value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: s.maxAge })
  return res
}
