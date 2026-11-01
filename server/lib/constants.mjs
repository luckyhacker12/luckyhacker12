/**
 * Shared constants. Kept in one place on the server so CSV import validation and
 * API validation cannot drift apart.
 */

export const LEAD_STATUSES = [
  'New',
  'Not Answered',
  'Interested',
  'Not Interested',
  'Callback',
  'Follow-up',
  'Converted',
  'Invalid',
]

export const FOLLOW_UP_STATUSES = ['pending', 'done', 'missed']

export const ATTENDANCE_STATUSES = ['present', 'absent', 'half-day', 'leave']

export const CALL_OUTCOMES = [
  'Answered',
  'Not Answered',
  'Busy',
  'Wrong Number',
  'Voicemail',
  'Callback Scheduled',
]

export const ROLES = ['admin', 'employee']

/** Case/format-insensitive lookup of a lead status, e.g. "not answered" -> "Not Answered". */
export function normalizeStatus(value) {
  if (value === null || value === undefined) return null
  const raw = String(value).trim().toLowerCase().replace(/[\s_-]+/g, '')
  const match = LEAD_STATUSES.find(
    (s) => s.toLowerCase().replace(/[\s_-]+/g, '') === raw,
  )
  return match ?? null
}

/** Canonical phone form used as the de-duplication key. */
export function normalizePhone(value) {
  if (value === null || value === undefined) return ''
  let raw = String(value).trim()
  if (!raw) return ''
  const plus = raw.startsWith('+')
  raw = raw.replace(/[^\d]/g, '')
  if (!raw) return ''
  // Drop a redundant 00 international prefix.
  if (!plus && raw.startsWith('00')) raw = raw.slice(2)
  return (plus ? '+' : '') + raw
}

export function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}
