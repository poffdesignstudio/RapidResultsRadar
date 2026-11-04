import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackerDncBlock } from '../src/web/tracker.js'
import type { DncRow } from '../src/match/doNotContact.js'
import type { Suppression } from '../src/pipeline.js'

const clients: DncRow[] = [
  { client_name_raw: 'Sunrise Caregivers LLC', brand: '', location_raw: '', city: '', state: 'NC', entry_type: 'named_business', use_for_matching: 'yes', match_rule: 'company_name', notes: '' },
  { client_name_raw: 'Home Instead Fayetteville', brand: 'Home Instead', location_raw: 'Fayetteville', city: 'Fayetteville', state: '', entry_type: 'franchise_office', use_for_matching: 'yes', match_rule: 'brand_state_city', notes: '' },
]

const sup = (over: Partial<Suppression> = {}): Suppression => ({
  emails: new Set(), domains: new Set(), phones: new Set(), names: [], entries: 0, ...over,
})

const lead = { company_name: 'Acme Home Care', personal_email: 'owner@acmehomecare.com', phone: '(919) 555-0100', website: 'https://www.acmehomecare.com', city: 'Raleigh', state: 'NC' }

test('manual-entry screening: a clean lead is not blocked', () => {
  assert.equal(trackerDncBlock(lead, clients, sup()), null)
  assert.equal(trackerDncBlock(lead, null, sup()), null)
})

test('manual-entry screening: a suppressed email or website domain blocks', () => {
  assert.equal(trackerDncBlock(lead, clients, sup({ emails: new Set(['owner@acmehomecare.com']) })), 'on the DNC list')
  assert.equal(trackerDncBlock(lead, clients, sup({ domains: new Set(['acmehomecare.com']) })), 'on the DNC list')
})

test('manual-entry screening: an existing-client name match blocks with the client reason', () => {
  assert.equal(trackerDncBlock({ ...lead, company_name: 'Sunrise Caregivers LLC' }, clients, sup()), 'Existing client: Sunrise Caregivers LLC')
})

test('manual-entry screening: a suppressed phone blocks, on either phone field', () => {
  const phones = new Set(['9195550100'])
  assert.equal(trackerDncBlock(lead, clients, sup({ phones })), 'on the DNC list')
  assert.equal(trackerDncBlock({ ...lead, phone: '', contact_phone: '919-555-0100' }, clients, sup({ phones })), 'on the DNC list')
})

test('manual-entry screening: a suppression entry with a business name blocks', () => {
  assert.equal(trackerDncBlock({ ...lead, company_name: 'Sunrise Caregivers LLC' }, null, sup({ names: clients })), 'on the suppression list')
})

test('manual-entry screening: a possible match (flag, not drop) does not block', () => {
  // Same brand as a client whose row has no state: checkDnc flags it, never drops it.
  assert.equal(trackerDncBlock({ ...lead, company_name: 'Home Instead', franchise_brand: 'Home Instead', city: 'Charlotte' }, clients, sup()), null)
})
