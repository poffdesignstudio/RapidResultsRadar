import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { crawlSite } from '../src/enrich/crawler.js'

const PAGES: Record<string, string> = {
  '/robots.txt': 'User-agent: *\nDisallow: /private\n',
  '/': '<html><body><a href="/about-us">About Us</a><a href="/contact">Contact</a><a href="/careers">Careers</a><a href="/private/team">Our Team</a></body></html>',
  '/about-us': '<html><body><h2>Our Leadership</h2><div><h3>Dana Whitfield</h3><p>Founder &amp; CEO</p></div></body></html>',
  '/contact': '<html><body><p>Email: <a href="mailto:dwhitfield@caretest.com">dwhitfield@caretest.com</a> or office@caretest.com</p></body></html>',
  '/careers': '<html><body><h1>Now hiring caregivers</h1></body></html>',
  '/private/team': '<html><body><p>Secret Person, Owner</p></body></html>',
}

test('crawls about, contact and careers pages and obeys robots.txt', async () => {
  const hits: string[] = []
  const server = createServer((req, res) => {
    hits.push(req.url!)
    const body = PAGES[req.url!]
    res.writeHead(body ? 200 : 404, { 'Content-Type': req.url === '/robots.txt' ? 'text/plain' : 'text/html' })
    res.end(body ?? 'not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  try {
    const site = await crawlSite(`http://127.0.0.1:${port}/`)
    assert.equal(site.status, 'ok')
    assert.ok(!hits.includes('/private/team'), 'robots.txt was not respected')
    assert.deepEqual(site.people.map((p) => [p.name, p.title]), [['Dana Whitfield', 'Founder & CEO']])
    assert.deepEqual(site.emails.map((e) => e.email).sort(), ['dwhitfield@caretest.com', 'office@caretest.com'])
    assert.equal(site.hiring, 'yes')
    assert.match(site.crawledOn, /^\d{2}-\d{2}-\d{4}$/)
  } finally {
    server.close()
  }
})
