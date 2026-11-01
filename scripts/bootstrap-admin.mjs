#!/usr/bin/env node
/**
 * CALLPRO CRM — first administrator bootstrap.
 *
 * The application never ships a default/anonymous admin, and public sign-up
 * always creates role='employee' (see handle_new_user() in 001_schema.sql).
 * The first admin therefore has to be provisioned once, out-of-band, by an
 * operator who holds the Supabase service-role key.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run bootstrap:admin -- --email owner@example.com --name "Owner" --password 'a-long-password'
 *
 * Options:
 *   --email <address>     required. The admin's login email.
 *   --name "<full name>"  optional. Display name (defaults to the email local part).
 *   --password <value>    optional. If omitted, ADMIN_PASSWORD env is used.
 *                         The script never invents or stores a password.
 *   --phone <value>       optional.
 *
 * The script is idempotent: if the auth user already exists it is reused and
 * its public.profiles row is promoted to role='admin'.
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
function arg(name) {
  const idx = args.indexOf(`--${name}`)
  if (idx === -1) return undefined
  const value = args[idx + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function fail(message, hint) {
  console.error(`\n✖ ${message}`)
  if (hint) console.error(`  ${hint}`)
  process.exit(1)
}

const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')
const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim()
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!url) fail('SUPABASE_URL is not set.', 'Copy .env.example to .env and fill in your project values.')
if (!anonKey) fail('SUPABASE_ANON_KEY is not set.')
if (!serviceKey) {
  fail(
    'SUPABASE_SERVICE_ROLE_KEY is not set.',
    'This one-off bootstrap needs the service role to create the auth user. Keep it server-side only.',
  )
}

const email = (arg('email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase()
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  fail('A valid --email is required.', 'Example: npm run bootstrap:admin -- --email owner@example.com --password "..."')
}

const password = arg('password') || process.env.ADMIN_PASSWORD || ''
if (!password || password.length < 8) {
  fail(
    'A password of at least 8 characters is required (--password or ADMIN_PASSWORD).',
    'No password is generated or stored by this script — choose your own.',
  )
}

const fullName = (arg('name') || email.split('@')[0]).trim()
const phone = (arg('phone') || '').trim()

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

/** Finds an existing auth user by email (paged, since the admin API is paginated). */
async function findUserByEmail(address) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const users = data?.users ?? []
    const match = users.find((u) => (u.email || '').toLowerCase() === address)
    if (match) return match
    if (users.length < 200) return null
  }
  return null
}

async function main() {
  console.log(`CALLPRO bootstrap → ${url}`)
  console.log(`  email: ${email}`)

  let userId = null

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (createError) {
    const alreadyExists = /already|registered|exists/i.test(createError.message)
    if (!alreadyExists) {
      fail(`Could not create the auth user: ${createError.message}`)
    }
    const existing = await findUserByEmail(email)
    if (!existing) fail('Auth reports the email as taken but it could not be found. Check the Supabase dashboard.')
    userId = existing.id
    console.log('  auth user already existed — reusing it')

    // Keep the provided password authoritative for this account.
    const { error: pwError } = await service.auth.admin.updateUserById(userId, { password })
    if (pwError) fail(`Could not update the password: ${pwError.message}`)
    console.log('  password updated from --password/ADMIN_PASSWORD')
  } else {
    userId = created.user.id
    console.log('  auth user created (email confirmed)')
  }

  const { error: profileError } = await service.from('profiles').upsert(
    {
      id: userId,
      email,
      full_name: fullName,
      phone: phone || null,
      role: 'admin',
      active: true,
    },
    { onConflict: 'id' },
  )

  if (profileError) {
    const missingTable = /relation .*profiles.* does not exist|42P01/i.test(profileError.message)
    if (missingTable) {
      fail(
        'public.profiles does not exist yet.',
        'Run supabase/migrations/001_schema.sql, then 002_rls.sql and 003_functions.sql, and try again.',
      )
    }
    fail(`Could not write the admin profile: ${profileError.message}`)
  }

  const { data: check, error: checkError } = await service
    .from('profiles')
    .select('id, email, full_name, role, active')
    .eq('id', userId)
    .maybeSingle()

  if (checkError) fail(`Profile verification failed: ${checkError.message}`)
  if (!check || check.role !== 'admin' || check.active !== true) {
    fail('Profile was written but does not read back as an active admin. Check RLS/trigger definitions.')
  }

  console.log('\n✔ Admin ready')
  console.log(`  id:    ${check.id}`)
  console.log(`  email: ${check.email}`)
  console.log(`  role:  ${check.role}`)
  console.log('\nSign in at /admin/login with this email and the password you supplied.')
}

main().catch((err) => fail(err?.message || String(err)))
