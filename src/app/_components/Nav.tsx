'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const LINKS = [
  ['/', 'Search'],
  ['/leads', 'All leads'],
  ['/lists', 'Do-not-contact & suppression'],
  ['/sources', 'Sources & calls'],
]

export function Nav() {
  const path = usePathname()
  const router = useRouter()
  if (path === '/login') return null
  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' })
    router.push('/login')
  }
  return (
    <header className="top">
      <Link href="/" className="brand">Rapid <span>Radar</span> · Lead Digger</Link>
      <nav>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={(href === '/' ? path === '/' || path.startsWith('/searches') : path.startsWith(href)) ? 'on' : ''}>{label}</Link>
        ))}
      </nav>
      <div className="spacer" />
      <button className="ghost" onClick={logout}>Log out</button>
    </header>
  )
}
