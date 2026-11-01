/**
 * Supabase clients.
 *
 * KEY HANDLING
 * ------------
 *  - SUPABASE_ANON_KEY      : public. Only ever handed to the browser through
 *                             GET /api/config. Data is protected by RLS.
 *  - SUPABASE_SERVICE_ROLE_KEY : secret. Read from process.env inside the server
 *                             process only, used exclusively for auth-admin
 *                             tasks (create employee / set password / delete).
 *                             It is never placed on a response, never logged and
 *                             never referenced from frontend code.
 */

import { createClient } from '@supabase/supabase-js'
import { notConfigured, HttpError } from './errors.mjs'

const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')
const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim()
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export const hasSupabase = Boolean(url && anonKey)
export const hasServiceRole = Boolean(url && serviceKey)

/** Public runtime configuration for the SPA. Contains no secret. */
export function publicConfig() {
  return {
    configured: hasSupabase,
    supabaseUrl: url || null,
    supabaseAnonKey: hasSupabase ? anonKey : null,
  }
}

/** Long-lived anon client, used only to verify access tokens with the Auth server. */
const authVerifier = hasSupabase
  ? createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null

/**
 * Client bound to an end-user access token.
 *
 * Every read and write for a signed-in user goes through here, so PostgREST
 * applies the caller's RLS policies. This is what makes a forgotten `where`
 * clause in a route handler harmless rather than a data leak.
 */
export function userClient(accessToken) {
  if (!hasSupabase) throw notConfigured()
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

/**
 * Service-role client. Bypasses RLS - use only for operations that are
 * impossible or unsafe to express as a user action (Auth admin API).
 */
export function serviceClient() {
  if (!hasSupabase) throw notConfigured()
  if (!hasServiceRole) {
    throw new HttpError(
      503,
      'service_role_missing',
      'SUPABASE_SERVICE_ROLE_KEY is not set on the server, so employee accounts cannot be created from here. Add it to the server environment.',
    )
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Verifies a bearer token with Supabase Auth and returns the auth user. */
export async function verifyAccessToken(token) {
  if (!authVerifier) throw notConfigured()
  const { data, error } = await authVerifier.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}
