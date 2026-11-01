/**
 * Unit tests for the CSV import/export helpers.
 * Pure functions only — no network, no database, no Supabase credentials.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { parseCsv, parseCsvObjects, escapeCell, toCsv } from '../server/lib/csv.mjs'

test('parseCsv keeps quoted commas, quotes and newlines intact', () => {
  const text = 'name,notes\n"Sharma, R.","Said ""call later"""\n"Multi","line one\nline two"\n'
  const rows = parseCsv(text)

  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0], ['name', 'notes'])
  assert.deepEqual(rows[1], ['Sharma, R.', 'Said "call later"'])
  assert.deepEqual(rows[2], ['Multi', 'line one\nline two'])
})

test('parseCsv handles BOM, CRLF and a missing trailing newline', () => {
  const text = '\uFEFFname,phone\r\nAsha,9876543210\r\nRavi,9876500000'
  const rows = parseCsv(text)

  assert.deepEqual(rows, [
    ['name', 'phone'],
    ['Asha', '9876543210'],
    ['Ravi', '9876500000'],
  ])
})

test('parseCsv drops blank lines and tolerates non-string input', () => {
  assert.deepEqual(parseCsv('a,b\n\n\nc,d\n'), [
    ['a', 'b'],
    ['c', 'd'],
  ])
  assert.deepEqual(parseCsv(null), [])
})

test('parseCsvObjects normalises headers and tracks source line numbers', () => {
  const text = 'Full Name,Phone Number,E-mail\nAsha,9876543210,asha@example.com\n'
  const { headers, records } = parseCsvObjects(text)

  assert.deepEqual(headers, ['full_name', 'phone_number', 'e_mail'])
  assert.equal(records.length, 1)
  assert.equal(records[0].full_name, 'Asha')
  assert.equal(records[0].phone_number, '9876543210')
  assert.equal(records[0].__line, 2)
})

test('parseCsvObjects pads short rows with empty strings', () => {
  const { records } = parseCsvObjects('name,phone,email\nAsha,9876543210\n')
  assert.equal(records[0].email, '')
})

test('escapeCell quotes only fields that need it', () => {
  assert.equal(escapeCell('plain'), 'plain')
  assert.equal(escapeCell(null), '')
  assert.equal(escapeCell(undefined), '')
  assert.equal(escapeCell('a,b'), '"a,b"')
  assert.equal(escapeCell('say "hi"'), '"say ""hi"""')
  assert.equal(escapeCell(42), '42')
})

test('toCsv -> parseCsv round-trips awkward values', () => {
  const rows = [
    { name: 'Sharma, R.', notes: 'line one\nline two', phone: '+91 98765 43210' },
    { name: 'Quote "Q"', notes: '', phone: '000' },
  ]
  const csv = toCsv(['name', 'notes', 'phone'], rows)

  assert.ok(csv.endsWith('\r\n'))
  const parsed = parseCsv(csv)
  assert.deepEqual(parsed[0], ['name', 'notes', 'phone'])
  assert.deepEqual(parsed[1], ['Sharma, R.', 'line one\nline two', '+91 98765 43210'])
  assert.deepEqual(parsed[2], ['Quote "Q"', '', '000'])
})
