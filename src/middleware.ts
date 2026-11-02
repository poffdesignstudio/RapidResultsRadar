import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, validSession } from './web/auth'

/** Every page and API needs a login, except the login page itself and the health check. */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname === '/login' || pathname === '/api/login' || pathname === '/api/health') return NextResponse.next()
  if (await validSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  return NextResponse.redirect(new URL('/login', req.url))
}

export const config = { matcher: ['/((?!_next/|favicon.ico|icon.svg).*)'] }
