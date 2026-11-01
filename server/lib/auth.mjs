/**
 * Authentication + authorisation middleware.
 *
 * The role is ALWAYS re-read from public.profiles for the current request.
 * A role claim in the client token (or any client-supplied header) is ignored,
 * so a tampered token payload cannot promote an employee to admin.
 */

import { userClient, verifyAccessToken, hasSupabase } from './supabase.mjs'
import { forbidden, notConfigured, unauthorized, HttpError } from './errors.mjs'

function bearerToken(req) {
  const header = req.headers.authorization || ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  return token || null
}

export async function requireUser(req, _res, next) {
  try {
    if (!hasSupabase) throw notConfigured()

    const token = bearerToken(req)
    if (!token) throw unauthorized('Missing bearer token')

    const authUser = await verifyAccessToken(token)
    if (!authUser) throw unauthorized('Invalid or expired session')

    // RLS lets a user read their own profile row, and an admin read all rows.
    const db = userClient(token)
    const { data: profile, error } = await db
      .from('profiles')
      .select('id, email, full_name, phone, role, active, created_at')
      .eq('id', authUser.id)
      .maybeSingle()

    if (error) throw new HttpError(500, 'profile_lookup_failed', error.message)
    if (!profile) {
      throw forbidden(
        'No CRM profile exists for this account. Ask an administrator to provision it.',
      )
    }
    if (!profile.active) {
      throw forbidden('This account has been deactivated. Contact an administrator.')
    }

    req.accessToken = token
    req.db = db
    req.profile = profile
    next()
  } catch (err) {
    next(err)
  }
}

export function requireAdmin(req, _res, next) {
  try {
    if (!req.profile) throw unauthorized()
    // Same source of truth as the RLS helpers: public.profiles.role.
    if (req.profile.role !== 'admin') {
      throw forbidden('Administrator access required')
    }
    next()
  } catch (err) {
    next(err)
  }
}
