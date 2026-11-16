import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv } from '../src/core/csv.js'
import { emailEntriesFromRows, emailEntriesFromText, summarizeImport } from '../src/match/emailLists.js'
import { entryDedupeKey } from '../src/match/listEntries.js'

const keysOf = (entries: { kind: 'risky' | 'dead'; email: string }[]) =>
  new Set(entries.map((e) => entryDedupeKey({
    kind: e.kind, name: '', brand: '', address: '', city: '', state: '', email: e.email, phone: '',
    entry_type: 'named_business', use_for_matching: 'yes', match_rule: '',
  })))

test('add one: a valid address becomes a lowercased entry on the chosen list', () => {
  const { entries, invalid } = emailEntriesFromText('risky', 'Owner@Example.com')
  assert.equal(invalid, 0)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].kind, 'risky')
  assert.equal(entries[0].email, 'owner@example.com')
})

test('add one: an invalid address is counted invalid and yields no entry', () => {
  for (const bad of ['not-an-email', 'missing@tld', '@domain.com', 'two words@example.com', 'a@b']) {
    const { entries, invalid } = emailEntriesFromText('dead', bad)
    assert.equal(entries.length, 0, bad)
    assert.equal(invalid, 1, bad)
  }
  // Blank lines are skipped, not counted invalid.
  const blank = emailEntriesFromText('dead', '  \n\n')
  assert.equal(blank.entries.length, 0)
  assert.equal(blank.invalid, 0)
})

test('add one: a duplicate is caught against the list and inside the batch', () => {
  const existing = keysOf([{ kind: 'risky', email: 'dup@example.com' }])
  const { entries } = emailEntriesFromText('risky', ['dup@example.com', 'new@example.com', 'NEW@example.com'].join('\n'))
  const { fresh, duplicates } = summarizeImport(existing, entries)
  assert.deepEqual(fresh.map((e) => e.email), ['new@example.com'])
  assert.equal(duplicates, 2)
})

test('CSV import: the email column is used, wherever it sits', () => {
  const rows = parseCsv('Business,Email,Phone\nAcme,One@Example.com,555-0100\nBeta,two@example.com,555-0101\n')
  const { entries, invalid } = emailEntriesFromRows('dead', rows)
  assert.equal(invalid, 0)
  assert.deepEqual(entries.map((e) => e.email), ['one@example.com', 'two@example.com'])
  assert.ok(entries.every((e) => e.kind === 'dead'))
})

test('CSV import: no email header falls back to the first column', () => {
  const rows = parseCsv('Addresses,Note\nfirst@example.com,risky domain\nsecond@example.com,bounced\n')
  const { entries, invalid } = emailEntriesFromRows('risky', rows)
  assert.equal(invalid, 0)
  assert.deepEqual(entries.map((e) => e.email), ['first@example.com', 'second@example.com'])
})

test('CSV import: added / duplicates / invalid counts come out exact', () => {
  const csv = [
    'email',
    'keep@example.com',
    'dupe@example.com',
    'DUPE@example.com',
    'not-an-email',
    '',
    'also-bad@',
    'new@example.com',
  ].join('\n')
  const { entries, invalid } = emailEntriesFromRows('risky', parseCsv(csv))
  assert.equal(invalid, 2)
  const existing = keysOf([{ kind: 'risky', email: 'dupe@example.com' }])
  const { fresh, duplicates } = summarizeImport(existing, entries)
  assert.deepEqual(fresh.map((e) => e.email), ['keep@example.com', 'new@example.com'])
  assert.equal(duplicates, 2)
})

test('the two lists stay independent: the same address can sit on both', () => {
  const riskyKeys = keysOf([{ kind: 'risky', email: 'same@example.com' }])
  const [forDead] = emailEntriesFromText('dead', 'same@example.com').entries
  const { fresh, duplicates } = summarizeImport(riskyKeys, [forDead])
  assert.equal(duplicates, 0)
  assert.equal(fresh.length, 1)
  assert.notEqual(
    entryDedupeKey(forDead),
    entryDedupeKey({ ...forDead, kind: 'risky' }),
  )
})
