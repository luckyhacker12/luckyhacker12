/**
 * Endpoints usable by BOTH roles.
 *
 * Nothing here trusts the caller's role for row visibility: every statement runs
 * through req.db, the per-request client that carries the user's JWT, so the RLS
 * policies in 002_rls.sql decide what comes back. Admin-only fields are gated by
 * an explicit role check as well, because RLS alone would let an admin-shaped
 * request through for the wrong actor.
 */

import { Router } from 'express'
import { asyncHandler, badRequest, notFound, forbidden } from '../lib/errors.mjs'
import {
  LEAD_STATUSES,
  CALL_OUTCOMES,
  normalizeStatus,
  normalizePhone,
} from '../lib/constants.mjs'
import {
  applyLeadFilters,
  applyLeadSort,
  cleanDate,
  cleanText,
  pagination,
  requireUuid,
} from '../lib/validate.mjs'

export const sharedRouter = Router()

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Maps profile ids to display names without exposing other employees' rows. */
async function assigneeNames(db) {
  const { data } = await db.from('profiles').select('id, full_name, email')
  const map = new Map()
  for (const p of data ?? []) map.set(p.id, p.full_name || p.email)
  return map
}

async function fetchLead(db, id) {
  const { data, error } = await db.from('leads').select('*').eq('id', id).maybeSingle()
  if (error) throw badRequest(error.message)
  // Hidden by RLS and non-existent are deliberately indistinguishable (404),
  // so an employee cannot probe for the existence of other reps' leads.
  if (!data) throw notFound('Lead not found')
  return data
}

/* -------------------------------------------------------------------------- */
/* leads                                                                      */
/* -------------------------------------------------------------------------- */

sharedRouter.get(
  '/leads',
  asyncHandler(async (req, res) => {
    const { page, pageSize, from, to } = pagination(req.query)
    const me = req.profile.role === 'employee' ? req.profile.id : undefined

    let qb = req.db.from('leads').select('*', { count: 'exact' })
    qb = applyLeadFilters(qb, req.query, { me })
    qb = applyLeadSort(qb, req.query).range(from, to)

    const { data, error, count } = await qb
    if (error) throw badRequest(error.message)

    const names = await assigneeNames(req.db)
    const rows = (data ?? []).map((lead) => ({
      ...lead,
      assignee_name: lead.assigned_to ? names.get(lead.assigned_to) ?? null : null,
    }))

    res.json({ rows, total: count ?? rows.length, page, pageSize })
  }),
)

sharedRouter.get(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'lead id')
    const lead = await fetchLead(req.db, id)

    const [calls, followUps] = await Promise.all([
      req.db
        .from('call_logs')
        .select('*')
        .eq('lead_id', id)
        .order('called_at', { ascending: false })
        .limit(100),
      req.db
        .from('follow_ups')
        .select('*')
        .eq('lead_id', id)
        .order('due_at', { ascending: true })
        .limit(50),
    ])

    if (calls.error) throw badRequest(calls.error.message)
    if (followUps.error) throw badRequest(followUps.error.message)

    const names = await assigneeNames(req.db)

    res.json({
      lead: { ...lead, assignee_name: lead.assigned_to ? names.get(lead.assigned_to) ?? null : null },
      calls: (calls.data ?? []).map((c) => ({
        ...c,
        employee_name: names.get(c.employee_id) ?? null,
      })),
      follow_ups: (followUps.data ?? []).map((f) => ({
        ...f,
        assignee_name: names.get(f.assigned_to) ?? null,
      })),
    })
  }),
)

/**
 * PATCH /api/leads/:id
 *
 * Field whitelist by role. An employee may move the pipeline and write notes;
 * contact details and ownership are admin-only. Even if this check were removed,
 * the leads_guard trigger rejects any assigned_to change from a non-admin.
 */
sharedRouter.patch(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'lead id')
    const isAdmin = req.profile.role === 'admin'
    const body = req.body ?? {}
    const patch = {}

    if (body.status !== undefined) {
      const status = normalizeStatus(body.status)
      if (!status) throw badRequest(`status must be one of: ${LEAD_STATUSES.join(', ')}`)
      patch.status = status
    }
    if (body.notes !== undefined) patch.notes = cleanText(body.notes, 4000)
    if (body.last_contacted_at !== undefined) {
      patch.last_contacted_at = cleanDate(body.last_contacted_at, 'last_contacted_at')
    }

    if (isAdmin) {
      if (body.name !== undefined) {
        const name = cleanText(body.name, 120)
        if (!name) throw badRequest('name cannot be empty')
        patch.name = name
      }
      if (body.phone !== undefined) {
        const phone = normalizePhone(body.phone)
        if (!phone) throw badRequest('phone cannot be empty')
        patch.phone = phone
      }
      if (body.email !== undefined) patch.email = cleanText(body.email, 160)
      if (body.company !== undefined) patch.company = cleanText(body.company, 160)
      if (body.city !== undefined) patch.city = cleanText(body.city, 120)
      if (body.source !== undefined) patch.source = cleanText(body.source, 60)
      if (body.assigned_to !== undefined) {
        patch.assigned_to = body.assigned_to ? requireUuid(body.assigned_to, 'assigned_to') : null
      }
    } else if (
      body.assigned_to !== undefined ||
      body.name !== undefined ||
      body.phone !== undefined ||
      body.email !== undefined ||
      body.company !== undefined
    ) {
      throw forbidden('Only an administrator can edit lead details or reassign a lead')
    }

    if (Object.keys(patch).length === 0) throw badRequest('No updatable fields supplied')

    const { data, error } = await req.db
      .from('leads')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) throw badRequest(error.message)
    if (!data) throw notFound('Lead not found')

    res.json({ lead: data })
  }),
)

/* -------------------------------------------------------------------------- */
/* calls + follow-ups                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Logs a call against a lead, advances the lead status and can schedule the next
 * follow-up in one atomic-feeling request. RLS verifies the employee owns the
 * lead before the insert is accepted.
 */
sharedRouter.post(
  '/leads/:id/calls',
  asyncHandler(async (req, res) => {
    const leadId = requireUuid(req.params.id, 'lead id')
    const body = req.body ?? {}

    const lead = await fetchLead(req.db, leadId)

    const outcome = cleanText(body.outcome, 40) ?? 'Answered'
    if (!CALL_OUTCOMES.includes(outcome)) {
      throw badRequest(`outcome must be one of: ${CALL_OUTCOMES.join(', ')}`)
    }

    const durationRaw = Number.parseInt(body.duration_seconds ?? '0', 10)
    const duration = Number.isFinite(durationRaw) ? Math.min(Math.max(durationRaw, 0), 86400) : 0

    const callPayload = {
      lead_id: leadId,
      employee_id: req.profile.id,
      outcome,
      // Column is `note` in public.call_logs (see 001_schema.sql). The API field
      // stays `notes` so clients have one consistent name for free-text notes.
      note: cleanText(body.notes, 4000),
      duration_seconds: duration,
      called_at: cleanDate(body.called_at, 'called_at') ?? new Date().toISOString(),
    }

    const { data: call, error: callError } = await req.db
      .from('call_logs')
      .insert(callPayload)
      .select('*')
      .single()
    if (callError) throw badRequest(callError.message)

    // Advance the lead.
    const leadPatch = { last_contacted_at: callPayload.called_at }
    let status = null
    if (body.status !== undefined && body.status !== null && body.status !== '') {
      status = normalizeStatus(body.status)
      if (!status) throw badRequest(`status must be one of: ${LEAD_STATUSES.join(', ')}`)
      leadPatch.status = status
    }

    let updatedLead = lead
    if (Object.keys(leadPatch).length > 0) {
      const { data, error } = await req.db
        .from('leads')
        .update(leadPatch)
        .eq('id', leadId)
        .select('*')
        .maybeSingle()
      if (error) throw badRequest(error.message)
      if (data) updatedLead = data
    }

    // Optionally schedule the next follow-up.
    let followUp = null
    if (body.next_follow_up_at) {
      const dueAt = cleanDate(body.next_follow_up_at, 'next_follow_up_at')
      const { data, error } = await req.db
        .from('follow_ups')
        .insert({
          lead_id: leadId,
          assigned_to: lead.assigned_to ?? req.profile.id,
          due_at: dueAt,
          note: cleanText(body.follow_up_notes, 2000),
          created_by: req.profile.id,
          status: 'pending',
        })
        .select('*')
        .single()
      if (error) throw badRequest(error.message)
      followUp = data
    }

    res.status(201).json({ call, lead: updatedLead, follow_up: followUp })
  }),
)

sharedRouter.get(
  '/follow-ups',
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : 'pending'
    if (!['pending', 'done', 'missed', 'all'].includes(status)) {
      throw badRequest('status must be pending, done, missed or all')
    }

    let qb = req.db.from('follow_ups').select('*', { count: 'exact' })
    if (status !== 'all') qb = qb.eq('status', status)
    if (req.query.lead_id) qb = qb.eq('lead_id', requireUuid(req.query.lead_id, 'lead_id'))

    const { data, error, count } = await qb
      .order('due_at', { ascending: true })
      .limit(Math.min(Number.parseInt(req.query.limit ?? '200', 10) || 200, 500))
    if (error) throw badRequest(error.message)

    const rows = data ?? []
    // Attach lead context in one extra query rather than N queries.
    const leadIds = [...new Set(rows.map((f) => f.lead_id))]
    let leadMap = new Map()
    if (leadIds.length > 0) {
      const { data: leads } = await req.db
        .from('leads')
        .select('id, name, phone, company, status, assigned_to')
        .in('id', leadIds)
      for (const l of leads ?? []) leadMap.set(l.id, l)
    }

    const names = await assigneeNames(req.db)

    res.json({
      rows: rows.map((f) => ({
        ...f,
        lead: leadMap.get(f.lead_id) ?? null,
        assignee_name: names.get(f.assigned_to) ?? null,
        overdue: f.status === 'pending' && new Date(f.due_at) < new Date(),
      })),
      total: count ?? rows.length,
    })
  }),
)

sharedRouter.patch(
  '/follow-ups/:id',
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'follow_up id')
    const body = req.body ?? {}
    const patch = {}

    if (body.status !== undefined) {
      if (!['pending', 'done', 'missed'].includes(body.status)) {
        throw badRequest('status must be pending, done or missed')
      }
      patch.status = body.status
      patch.completed_at = body.status === 'pending' ? null : new Date().toISOString()
    }
    if (body.notes !== undefined) patch.note = cleanText(body.notes, 2000)
    if (body.due_at !== undefined) patch.due_at = cleanDate(body.due_at, 'due_at')
    if (req.profile.role === 'admin' && body.assigned_to !== undefined) {
      patch.assigned_to = body.assigned_to ? requireUuid(body.assigned_to, 'assigned_to') : null
    }

    if (Object.keys(patch).length === 0) throw badRequest('No updatable fields supplied')

    const { data, error } = await req.db
      .from('follow_ups')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) throw badRequest(error.message)
    if (!data) throw notFound('Follow-up not found')

    res.json({ follow_up: data })
  }),
)

/* -------------------------------------------------------------------------- */
/* attendance                                                                 */
/* -------------------------------------------------------------------------- */

sharedRouter.get(
  '/attendance/me',
  asyncHandler(async (req, res) => {
    const from = cleanDate(req.query.from, 'from') ?? null
    const to = cleanDate(req.query.to, 'to') ?? null

    let qb = req.db
      .from('attendance')
      .select('*')
      .eq('employee_id', req.profile.id)
      .order('work_date', { ascending: false })
      .limit(120)

    if (from) qb = qb.gte('work_date', from.slice(0, 10))
    if (to) qb = qb.lte('work_date', to.slice(0, 10))

    const { data, error } = await qb
    if (error) throw badRequest(error.message)

    const today = new Date().toISOString().slice(0, 10)
    res.json({
      rows: data ?? [],
      today: (data ?? []).find((r) => r.work_date === today) ?? null,
    })
  }),
)

async function markAttendance(req, mode) {
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()

  const { data: existing, error: findError } = await req.db
    .from('attendance')
    .select('*')
    .eq('employee_id', req.profile.id)
    .eq('work_date', today)
    .maybeSingle()
  if (findError) throw badRequest(findError.message)

  if (mode === 'in') {
    if (existing?.check_in) throw badRequest('You have already checked in today')
    if (existing) {
      const { data, error } = await req.db
        .from('attendance')
        .update({ check_in: now, status: 'present' })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) throw badRequest(error.message)
      return data
    }
    const { data, error } = await req.db
      .from('attendance')
      .insert({
        employee_id: req.profile.id,
        work_date: today,
        check_in: now,
        status: 'present',
      })
      .select('*')
      .single()
    if (error) throw badRequest(error.message)
    return data
  }

  if (!existing?.check_in) throw badRequest('Check in first before checking out')
  if (existing.check_out) throw badRequest('You have already checked out today')

  const { data, error } = await req.db
    .from('attendance')
    .update({ check_out: now })
    .eq('id', existing.id)
    .select('*')
    .single()
  if (error) throw badRequest(error.message)
  return data
}

sharedRouter.post(
  '/attendance/check-in',
  asyncHandler(async (req, res) => {
    res.status(201).json({ attendance: await markAttendance(req, 'in') })
  }),
)

sharedRouter.post(
  '/attendance/check-out',
  asyncHandler(async (req, res) => {
    res.json({ attendance: await markAttendance(req, 'out') })
  }),
)

/* -------------------------------------------------------------------------- */
/* dashboards                                                                 */
/* -------------------------------------------------------------------------- */

sharedRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    // Both RPCs re-verify the caller's role inside the database.
    const fn = req.profile.role === 'admin' ? 'admin_dashboard' : 'my_dashboard'
    const { data, error } = await req.db.rpc(fn)
    if (error) throw badRequest(error.message)
    res.json({ scope: req.profile.role, stats: data ?? {} })
  }),
)
