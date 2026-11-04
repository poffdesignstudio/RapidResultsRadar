'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const LINKS: [string, string][] = [
  ['/', 'SEARCH'],
  ['/leads', 'ALL LEADS'],
  ['/tracker', 'CAMPAIGN TRACKER'],
  ['/lists', 'DNC'],
  ['/sources', 'SOURCES'],
  ['/calls', 'CALLS'],
]

const isActive = (href: string, path: string) =>
  href === '/' ? path === '/' || path.startsWith('/searches') : path.startsWith(href)

/**
 * The app shell: a fixed black sidebar on the left (logo on top, the section nav
 * under it) and a content region on the right that scrolls on its own, with Log out
 * pinned to its top right corner. The login page gets no shell.
 */
export function Nav({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const router = useRouter()
  if (path === '/login') return <main>{children}</main>
  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' })
    router.push('/login')
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <img src="/rapid-radar-logo.png" alt="Rapid Radar" />
        </Link>
        <nav className="sidenav">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={isActive(href, path) ? 'on' : ''}>{label}</Link>
          ))}
        </nav>
      </aside>
      <div className="content">
        <div className="contentbar">
          <button className="ghost" onClick={logout}>Log out</button>
        </div>
        <main>{children}</main>
      </div>
    </div>
  )
}
