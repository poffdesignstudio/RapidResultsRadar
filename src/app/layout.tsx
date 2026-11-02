import type { Metadata } from 'next'
import './globals.css'
import { Nav } from './_components/Nav'

export const metadata: Metadata = {
  title: 'Rapid Radar',
  description: 'Lead Digger: find the right contact at local businesses.',
  icons: { icon: '/icon.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main>{children}</main>
      </body>
    </html>
  )
}
