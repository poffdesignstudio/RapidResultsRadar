import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compare } from '../src/match/cluster.js'
import { checkDnc, type DncRow } from '../src/match/doNotContact.js'
import { stateInUrlMismatch } from '../src/leads/build.js'
import { isGenericEmail } from '../src/enrich/emails.js'
import { formatDate } from '../src/core/dates.js'
import type { SourceRecord } from '../src/core/types.js'

const rec = (o: Partial<SourceRecord>): SourceRecord => ({ source: 'overture', sourceId: Math.random().toString(), name: 'x', ...o })
const shared = new Set(['visitingangels.com'])

test('same business across sources is merged', () => {
  const a = rec({ name: 'Tender Home Care Agency', phone: '7045551234', address: '2025 Wade Hampton Cir', zip: '28012' })
  const b = rec({ source: 'nppes', name: 'TENDER HOME CARE AGENCY LLC', phone: '7045559999', address: '2025 Wade Hampton Circle', zip: '28012' })
  assert.equal(compare(a, b, shared), 'same')
})

test('two offices of one brand are not merged or called duplicates', () => {
  const a = rec({ name: 'Visiting Angels', phone: '7048411160', address: '7301 Carmel Executive Park Dr', zip: '28226', city: 'Charlotte', website: 'https://www.visitingangels.com/charlotte' })
  const b = rec({ name: 'Visiting Angels', phone: '7045494010', address: '416 McCullough Dr', zip: '28262', city: 'Charlotte', website: 'https://www.visitingangels.com/university' })
  assert.equal(compare(a, b, shared), 'different')
})

const dnc: DncRow[] = [
  { client_name_raw: 'Visiting Angels Aiea', brand: 'Visiting Angels', location_raw: 'Aiea, HI', city: 'Aiea', state: 'HI', entry_type: 'franchise_office', use_for_matching: 'yes', match_rule: 'brand_state_city', notes: '' },
  { client_name_raw: 'Home Instead Fayetteville', brand: 'Home Instead', location_raw: 'Fayetteville', city: 'Fayetteville', state: '', entry_type: 'franchise_office', use_for_matching: 'yes', match_rule: 'brand_state_city', notes: '' },
  { client_name_raw: 'Sunrise Caregivers LLC', brand: '', location_raw: '', city: '', state: 'NC', entry_type: 'named_business', use_for_matching: 'yes', match_rule: 'company_name', notes: '' },
  { client_name_raw: 'Kindly Home', brand: '', location_raw: '', city: '', state: '', entry_type: 'named_business', use_for_matching: 'yes', match_rule: 'place_name_only', notes: '' },
  { client_name_raw: 'Test Agency', brand: '', location_raw: '', city: '', state: '', entry_type: 'demo_or_test', use_for_matching: 'yes', match_rule: '', notes: '' },
  { client_name_raw: 'Ignored Co', brand: '', location_raw: '', city: '', state: '', entry_type: 'named_business', use_for_matching: 'no', match_rule: '', notes: '' },
]

test('do-not-contact: franchise office matches only its own location', () => {
  assert.equal(checkDnc(dnc, { names: ['Visiting Angels'], brand: 'Visiting Angels', city: 'Aiea', state: 'HI' }).action, 'drop')
  assert.equal(checkDnc(dnc, { names: ['Visiting Angels'], brand: 'Visiting Angels', city: 'Charlotte', state: 'NC' }).action, 'none')
})

test('do-not-contact: franchise row with no state is flagged, never dropped', () => {
  assert.equal(checkDnc(dnc, { names: ['Home Instead'], brand: 'Home Instead', city: 'Charlotte', state: 'NC' }).action, 'flag')
})

test('do-not-contact: named business exact drops, close name flags, excluded rows never match', () => {
  assert.equal(checkDnc(dnc, { names: ['Sunrise Caregivers, L.L.C.'], city: 'Charlotte', state: 'NC' }).action, 'drop')
  assert.equal(checkDnc(dnc, { names: ['Sunrise Caregivers of Charlotte'], city: 'Charlotte', state: 'NC' }).action, 'flag')
  assert.equal(checkDnc(dnc, { names: ['Kindly Home'] }).action, 'none')
  assert.equal(checkDnc(dnc, { names: ['Test Agency'] }).action, 'none')
  assert.equal(checkDnc(dnc, { names: ['Ignored Co'] }).action, 'none')
})

test('chain location page in another state is detected', () => {
  assert.equal(stateInUrlMismatch('https://www.comforcare.com/texas/rio-grande-valley-e', 'SC'), 'Texas')
  assert.equal(stateInUrlMismatch('https://www.comforcare.com/south-carolina/rock-hill', 'SC'), '')
  assert.equal(stateInUrlMismatch('https://example.com/virginia-beach', 'NC'), '')
})

test('shared inboxes count as generic', () => {
  for (const e of ['leadssc06@synergyhomecare.com', '59049@homehelpershomecare.com', 'wecare@x.com']) assert.ok(isGenericEmail(e), e)
  assert.ok(isGenericEmail('charlotte@brightstarcare.com', 'BrightStar Care', ['Charlotte']))
  assert.ok(!isGenericEmail('linda.bilong@preservescare.com', 'Preserve Home Care'))
})

test('dates are MM-DD-YYYY', () => {
  assert.equal(formatDate(new Date(2026, 9, 31)), '10-31-2026')
})
