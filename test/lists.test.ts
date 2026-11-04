import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entryDedupeKey, entryToDncRow, linesToEntries, rowsToEntries } from '../src/match/listEntries.js'
import { checkDnc } from '../src/match/doNotContact.js'

test('lead-shaped sheet rows give name, email, phone, city and state', () => {
  const [e] = rowsToEntries('client', [{
    'LEAD ID': 'RR-XXXX', 'COMPANY NAME': 'Amedisys Home Health Care', 'CITY': 'Chapel Hill', 'STATE': 'NC',
    'PHONE': '(919) 341-4177', "CONTACT'S EMAIL": 'Josh@Example.com', 'WEBSITE': 'https://example.com',
  }])
  assert.equal(e.name, 'Amedisys Home Health Care')
  assert.equal(e.email, 'josh@example.com')
  assert.equal(e.phone, '9193414177')
  assert.equal(e.city, 'Chapel Hill')
  assert.equal(e.state, 'NC')
  assert.equal(e.entry_type, 'named_business')
  assert.equal(e.use_for_matching, 'yes')
})

test('legacy do-not-contact rows keep their matching flavor', () => {
  const [e] = rowsToEntries('client', [{
    client_name_raw: 'Visiting Angels Aiea', brand: 'Visiting Angels', location_raw: 'Aiea, HI', city: 'Aiea', state: 'HI',
    entry_type: 'franchise_office', use_for_matching: 'yes', match_rule: 'brand_state_city',
  }])
  assert.equal(e.entry_type, 'franchise_office')
  assert.equal(e.match_rule, 'brand_state_city')
  const row = entryToDncRow(e)
  assert.equal(checkDnc([row], { names: ['Visiting Angels'], brand: 'Visiting Angels', city: 'Aiea', state: 'HI' }).action, 'drop')
  assert.equal(checkDnc([row], { names: ['Visiting Angels'], brand: 'Visiting Angels', city: 'Charlotte', state: 'NC' }).action, 'none')
})

test('simple one-column lists become name entries; email-only sheets become email entries', () => {
  const names = rowsToEntries('suppression', [{ Businesses: 'Sunrise Caregivers LLC' }, { Businesses: 'Kindly Home' }])
  assert.deepEqual(names.map((e) => e.name), ['Sunrise Caregivers LLC', 'Kindly Home'])
  const emails = rowsToEntries('suppression', [{ email: 'a@b.com' }, { email: '@spammy.com' }])
  assert.deepEqual(emails.map((e) => e.email), ['a@b.com', '@spammy.com'])
  assert.deepEqual(rowsToEntries('client', [{ 'LEAD ID': 'RR-1', NOTES: 'nothing usable' }]), [])
})

test('pasted lines are classified: email, domain, phone, name', () => {
  const es = linesToEntries('suppression', ['Owner@Example.com', '@bad-domain.com', '(704) 555-1234', 'Sunrise Caregivers LLC', '  ', '12345'].join('\n'))
  assert.equal(es.length, 4)
  assert.equal(es[0].email, 'owner@example.com')
  assert.equal(es[1].email, '@bad-domain.com')
  assert.equal(es[2].phone, '7045551234')
  assert.equal(es[3].name, 'Sunrise Caregivers LLC')
})

test('dedupe keys: same business twice is one entry, another city is another', () => {
  const [a] = rowsToEntries('client', [{ 'COMPANY NAME': 'Sunrise Caregivers, LLC', CITY: 'Charlotte', STATE: 'NC' }])
  const [b] = rowsToEntries('client', [{ 'COMPANY NAME': 'Sunrise Caregivers', CITY: 'Charlotte', STATE: 'NC' }])
  const [c] = rowsToEntries('client', [{ 'COMPANY NAME': 'Sunrise Caregivers', CITY: 'Raleigh', STATE: 'NC' }])
  const [s] = rowsToEntries('suppression', [{ 'COMPANY NAME': 'Sunrise Caregivers', CITY: 'Charlotte', STATE: 'NC' }])
  assert.equal(entryDedupeKey(a), entryDedupeKey(b))
  assert.notEqual(entryDedupeKey(a), entryDedupeKey(c))
  assert.notEqual(entryDedupeKey(a), entryDedupeKey(s))
})

test('a named suppression entry drops an exact-name lead through checkDnc', () => {
  const [e] = linesToEntries('suppression', 'Sunrise Caregivers LLC')
  const r = checkDnc([entryToDncRow(e)], { names: ['Sunrise Caregivers, L.L.C.'], city: 'Charlotte', state: 'NC' })
  assert.equal(r.action, 'drop')
})
