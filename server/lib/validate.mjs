import { badRequest } from './errors.mjs'
import { LEAD_STATUSES, normalizeStatus } from './constants.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function requireUuid(value, field = 'id') {
  if (!isUuid(value)) throw badRequest(`${field} must be a valid id`)
  return value
}

/**
 * Strips characters that carry meaning in a PostgREST `or=` filter so a search
 * box cannot be used to inject extra filter clauses.
 */
export function sanitizeSearch(term) {
  if (term === undefined || term === null) return ''
  return String(term)
    .trim()
    .replace(/[,()"%\\*'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

export function pagination(query, defaultSize = 25, maxSize = 100) {
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1)
  const requested = Number.parseInt(query.page_size ?? String(defaultSize), 10) || defaultSize
  const pageSize = Math.min(maxSize, Math.max(1, requested))
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 }
}

/**
 * Applies the shared lead filters used by both the list endpoint and CSV export,
 * so an export always matches what the admin is looking at.
 */
export function applyLeadFilters(builder, query, { me } = {}) {
  let qb = builder

  const term = sanitizeSearch(query.q)
  if (term) {
    qb = qb.or(
      [
        `name.ilike.%${term}%`,
        `phone.ilike.%${term}%`,
        `company.ilike.%${term}%`,
        `email.ilike.%${term}%`,
        `city.ilike.%${term}%`,
      ].join(','),
    )
  }

  if (query.status) {
    const statuses = String(query.status)
      .split(',')
      .map((s) => normalizeStatus(s))
      .filter(Boolean)
    if (statuses.length === 0) {
      throw badRequest(`Unknown status filter. Use one of: ${LEAD_STATUSES.join(', ')}`)
    }
    qb = statuses.length === 1 ? qb.eq('status', statuses[0]) : qb.in('status', statuses)
  }

  if (query.assigned_to === 'unassigned') {
    qb = qb.is('assigned_to', null)
  } else if (query.assigned_to === 'me' && me) {
    qb = qb.eq('assigned_to', me)
  } else if (query.assigned_to) {
    qb = qb.eq('assigned_to', requireUuid(query.assigned_to, 'assigned_to'))
  }

  if (query.source) qb = qb.eq('source', String(query.source).slice(0, 60))

  return qb
}

export function applyLeadSort(builder, query) {
  const sort = String(query.sort ?? 'recent')
  const dir = String(query.dir ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'
  const columns = {
    recent: 'updated_at',
    created: 'created_at',
    name: 'name',
    status: 'status',
    company: 'company',
  }
  const column = columns[sort] ?? 'updated_at'
  return builder.order(column, { ascending: dir === 'asc', nullsFirst: false }).order('id')
}

/** Trims to a string of at most `max` characters, or null when empty. */
export function cleanText(value, max = 2000) {
  if (value === undefined || value === null) return null
  const str = String(value).trim()
  if (!str) return null
  return str.slice(0, max)
}

export function cleanDate(value, field) {
  if (value === undefined || value === null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw badRequest(`${field} must be a valid date`)
  return date.toISOString()
}
