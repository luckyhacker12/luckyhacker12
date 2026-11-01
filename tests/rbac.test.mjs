/**
 * Role-guard tests.
 *
 * These exercise the server's authorisation middleware directly, with fake
 * request objects. No Supabase project or network access is required:
 *  - requireAdmin() is a pure function of req.profile.role.
 *  - requireUser() must fail closed (never call next() without an error or a
 *    verified profile) when no session/credentials are available.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { requireAdmin, requireUser } from '../server/lib/auth.mjs'
import { LEAD_STATUSES, normalizeStatus } from '../server/lib/constants.mjs'

function run(middleware, req) {
  const result = { nextArgs: null, called: false }
  middleware(req, {}, (...args) => {
    result.called = true
    result.nextArgs = args
  })
  return result
}

test('requireAdmin allows an admin profile', () => {
  const { called, nextArgs } = run(requireAdmin, { profile: { role: 'admin' } })
  assert.equal(called, true)
  assert.equal(nextArgs.length, 0, 'admin should pass through with no error')
})

test('requireAdmin rejects an employee with 403', () => {
  const { called, nextArgs } = run(requireAdmin, { profile: { role: 'employee' } })
  assert.equal(called, true)
  assert.equal(nextArgs.length, 1)
  assert.equal(nextArgs[0].status, 403)
})

test('requireAdmin rejects a missing profile with 401', () => {
  const { nextArgs } = run(requireAdmin, {})
  assert.equal(nextArgs[0].status, 401)
})

test('requireAdmin ignores a role claim that is not on the profile row', () => {
  // A tampered JWT could claim anything, but the middleware only trusts
  // public.profiles.role, which is read server-side per request.
  const req = { user: { role: 'admin' }, claims: { role: 'admin' }, profile: { role: 'employee' } }
  const { nextArgs } = run(requireAdmin, req)
  assert.equal(nextArgs[0].status, 403)
})

test('requireUser fails closed when Supabase is not configured', async () => {
  const errors = []
  let decided = false

  await requireUser(
    { headers: { authorization: 'Bearer whatever' } },
    {},
    (err) => {
      decided = true
      if (err) errors.push(err)
    },
  )

  assert.equal(decided, true, 'middleware must always resolve the chain')
  assert.equal(errors.length, 1, 'no session must never pass through silently')
  assert.ok([401, 503].includes(errors[0].status), `expected 401/503, got ${errors[0].status}`)
})

test('only the eight supported lead statuses normalise', () => {
  assert.deepEqual(LEAD_STATUSES, [
    'New',
    'Not Answered',
    'Interested',
    'Not Interested',
    'Callback',
    'Follow-up',
    'Converted',
    'Invalid',
  ])

  assert.equal(normalizeStatus('not answered'), 'Not Answered')
  assert.equal(normalizeStatus(' Follow Up '), 'Follow-up')
  assert.equal(normalizeStatus('CONVERTED'), 'Converted')
  assert.equal(normalizeStatus('lost'), null)
  assert.equal(normalizeStatus('admin'), null)
  assert.equal(normalizeStatus(undefined), null)
})
