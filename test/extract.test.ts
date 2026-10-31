import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPage, looksLikePersonName, decodeCfEmail, titleScore } from '../src/enrich/extract.js'
import { isGenericEmail, patternOf, applyPattern } from '../src/enrich/emails.js'

test('finds people in common page layouts', () => {
  const html = `<html><body>
    <div class="card"><h3>Jane Smith</h3><p>Owner &amp; Administrator</p></div>
    <p>Michael O'Brien, Director of Nursing</p>
    <p>Our agency was founded by Carla Reyes in 2009.</p>
    <h2>Meet Our Team</h2><p>Home Care Services</p>
    <a href="mailto:jsmith@tendercare.com">Email Jane</a>
    <p>Questions? info@tendercare.com</p>
    <a href="/careers">Careers</a>
  </body></html>`
  const f = extractPage(html, 'website:about')
  const names = Object.fromEntries(f.people.map((p) => [p.name, p.title]))
  assert.equal(names['Jane Smith'], 'Owner & Administrator')
  assert.equal(names["Michael O'Brien"], 'Director of Nursing')
  assert.equal(names['Carla Reyes'], 'Founder')
  assert.ok(!('Home Care Services' in names))
  assert.deepEqual(f.emails.sort(), ['info@tendercare.com', 'jsmith@tendercare.com'])
  assert.equal(f.hiring, true)
})

test('name check rejects business phrases', () => {
  assert.ok(looksLikePersonName('Jane Smith'))
  assert.ok(!looksLikePersonName('Home Care Services'))
  assert.ok(!looksLikePersonName('Contact Us'))
  assert.ok(!looksLikePersonName('Charlotte'))
})

test('decodes Cloudflare-protected email', () => {
  // key 0x42 XOR "a@b.co"
  const hex = '42' + [...'a@b.co'].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('')
  assert.equal(decodeCfEmail(hex), 'a@b.co')
})

test('generic vs personal email', () => {
  assert.ok(isGenericEmail('info@x.com'))
  assert.ok(isGenericEmail('tenderhomecare2@gmail.com', 'Tender Home Care Agency'))
  assert.ok(!isGenericEmail('jsmith@tendercare.com', 'Tender Care'))
})

test('email patterns', () => {
  assert.equal(patternOf('jsmith@x.com', { first: 'Jane', last: 'Smith' }), 'flast')
  assert.equal(applyPattern('first.last', { first: 'Bob', last: "O'Neil" }, 'x.com'), 'bob.oneil@x.com')
  assert.ok(titleScore('Owner') > titleScore('Director of Nursing'))
})
