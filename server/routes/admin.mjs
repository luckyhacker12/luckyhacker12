/**
 * Administrator-only endpoints.
 *
 * Mounted behind requireUser + requireAdmin, so req.profile.role has already been
 * re-read from public.profiles. The service-role client is used for exactly three
 * things - creating an auth user, resetting a password, deleting a user - because
 * the Supabase Auth admin API has no user-scoped equivalent. No other endpoint
 * touches it, and it never appears in a response.
 */

import { Router } from 'express'
import { asyncHandler, badRequest, notFound, HttpError } from '../lib/errors.mjs'
import { serviceClient } from '../lib/supabase.mjs'
import { parseCsvObjects, toCsv } from '../lib/csv.mjs'
import {
  LEAD_STATUSES,
  ATTENDANCE_STATUSES,
  normalizeStatus,
  normalizePhone,
  isValidEmail,
} from '../lib/constants.mjs'
import {
  applyLeadFilters,
  applyLeadSort,
  cleanDate,
  cleanText,
  pagination,
  requireUuid,
} from '../lib/validate.mjs'

export const adminRouter = Router()

const MAX_IMPORT_BYTES = 2 * 1024 * 1024
const MAX_IMPORT_ROWS = 5000

/* -------------------------------------------------------------------------- */
/* employees                                                                  */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/employees',
  asyncHandler(async (req, res) => {
    // One aggregate round trip - the same numbers the dashboard shows.
    const { data, error } = await req.db.rpc('admin_dashboard')
    if (error) throw badRequest(error.message)

    const { data: admins, error: adminError } = await req.db
      .from('profiles')
      .select('id, full_name, email, phone, role, active, created_at')
      .eq('role', 'admin')
      .order('full_name')
    if (adminError) throw badRequest(adminError.message)

    res.json({
      employees: data?.employees ?? [],
      admins: admins ?? [],
      total_employees: data?.total_employees ?? 0,
      active_employees: data?.active_employees ?? 0,
    })
  }),
)

adminRouter.post(
  '/employees',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {}
    const email = cleanText(body.email, 160)?.toLowerCase()
    const password = typeof body.password === 'string' ? body.password : ''
    const fullName = cleanText(body.full_name, 120)
    const phone = cleanText(body.phone, 40)
    const role = body.role === 'admin' ? 'admin' : 'employee'

    if (!fullName || fullName.length < 2) throw badRequest('Full name is required')
    if (!email || !isValidEmail(email)) throw badRequest('A valid email address is required')
    if (password.length < 8) throw badRequest('Password must be at least 8 characters')

    const service = serviceClient()

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // Role is intentionally NOT taken from metadata: handle_new_user() in
      // 001_schema.sql forces 'employee' for any self-service sign-up.
      user_metadata: { full_name: fullName },
    })

    if (createError) {
      const already = /already|registered|exists/i.test(createError.message)
      throw new HttpError(
        already ? 409 : 400,
        already ? 'email_taken' : 'user_create_failed',
        already ? 'An account with this email already exists' : createError.message,
      )
    }

    const userId = created.user.id

    // Explicit profile write so the role assignment is deterministic and also
    // works if the sign-up trigger was installed after this user existed.
    const { error: profileError } = await service.from('profiles').upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        phone,
        role,
        active: true,
      },
      { onConflict: 'id' },
    )

    if (profileError) {
      // Roll the auth user back rather than leaving an account with no profile.
      await service.auth.admin.deleteUser(userId).catch(() => {})
      throw new HttpError(500, 'profile_create_failed', profileError.message)
    }

    res.status(201).json({
      employee: { id: userId, email, full_name: fullName, phone, role, active: true },
    })
  }),
)

adminRouter.patch(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'employee id')
    const body = req.body ?? {}
    const patch = {}

    if (body.full_name !== undefined) {
      const name = cleanText(body.full_name, 120)
      if (!name) throw badRequest('Full name cannot be empty')
      patch.full_name = name
    }
    if (body.phone !== undefined) patch.phone = cleanText(body.phone, 40)
    if (body.role !== undefined) {
      if (!['admin', 'employee'].includes(body.role)) throw badRequest('role must be admin or employee')
      patch.role = body.role
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') throw badRequest('active must be true or false')
      patch.active = body.active
    }

    if (Object.keys(patch).length === 0) throw badRequest('No updatable fields supplied')

    // Lockout guards: an admin must not be able to strand the workspace.
    if (id === req.profile.id && (patch.active === false || patch.role === 'employee')) {
      throw badRequest('You cannot deactivate or demote your own admin account')
    }

    if (patch.active === false || patch.role === 'employee') {
      const { data: current } = await req.db
        .from('profiles')
        .select('role, active')
        .eq('id', id)
        .maybeSingle()
      if (!current) throw notFound('Employee not found')

      if (current.role === 'admin' && (patch.role === 'employee' || patch.active === false)) {
        const { count } = await req.db
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('active', true)
        if ((count ?? 0) <= 1) throw badRequest('At least one active administrator must remain')
      }
    }

    // Service role: the profiles_guard trigger only allows admin-shaped changes,
    // and this request has already been proven to be an admin.
    const service = serviceClient()
    const { data, error } = await service
      .from('profiles')
      .update(patch)
      .eq('id', id)
      .select('id, email, full_name, phone, role, active')
      .maybeSingle()

    if (error) throw badRequest(error.message)
    if (!data) throw notFound('Employee not found')

    res.json({ employee: data })
  }),
)

adminRouter.post(
  '/employees/:id/password',
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'employee id')
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (password.length < 8) throw badRequest('Password must be at least 8 characters')

    const service = serviceClient()
    const { error } = await service.auth.admin.updateUserById(id, { password })
    if (error) throw badRequest(error.message)

    // Password is never stored, logged or echoed back.
    res.json({ ok: true })
  }),
)

adminRouter.delete(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'employee id')
    if (id === req.profile.id) throw badRequest('You cannot delete your own account')

    const service = serviceClient()
    const { error } = await service.auth.admin.deleteUser(id)
    if (error) {
      // User already absent from Auth: still clean up the profile row.
      if (!/not found/i.test(error.message)) throw badRequest(error.message)
    }

    const { error: profileError } = await service.from('profiles').delete().eq('id', id)
    if (profileError) throw badRequest(profileError.message)

    res.json({ ok: true })
  }),
)

/* -------------------------------------------------------------------------- */
/* leads (admin)                                                              */
/* -------------------------------------------------------------------------- */

adminRouter.post(
  '/leads',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {}
    const name = cleanText(body.name, 120)
    const phone = normalizePhone(body.phone)
    if (!name) throw badRequest('Lead name is required')
    if (!phone || phone.replace(/\D/g, '').length < 7) throw badRequest('A valid phone number is required')

    const status = body.status ? normalizeStatus(body.status) : 'New'
    if (!status) throw badRequest(`status must be one of: ${LEAD_STATUSES.join(', ')}`)

    const payload = {
      name,
      phone,
      email: cleanText(body.email, 160),
      company: cleanText(body.company, 160),
      city: cleanText(body.city, 120),
      source: cleanText(body.source, 60),
      notes: cleanText(body.notes, 4000),
      status,
      assigned_to: body.assigned_to ? requireUuid(body.assigned_to, 'assigned_to') : null,
      created_by: req.profile.id,
    }

    const { data, error } = await req.db.from('leads').insert(payload).select('*').single()
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        throw new HttpError(409, 'duplicate_phone', 'A lead with this phone number already exists')
      }
      throw badRequest(error.message)
    }

    res.status(201).json({ lead: data })
  }),
)

adminRouter.delete(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    const id = requireUuid(req.params.id, 'lead id')
    const { error } = await req.db.from('leads').delete().eq('id', id)
    if (error) throw badRequest(error.message)
    res.json({ ok: true })
  }),
)

/**
 * POST /api/admin/leads/assign
 * body: { lead_ids: string[], mode: 'single' | 'round_robin' | 'unassign', assigned_to?: uuid }
 */
adminRouter.post(
  '/leads/assign',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {}
    const ids = Array.isArray(body.lead_ids) ? body.lead_ids.filter((v) => typeof v === 'string') : []
    if (ids.length === 0) throw badRequest('lead_ids must be a non-empty array')
    if (ids.length > 500) throw badRequest('Assign at most 500 leads at a time')
    ids.forEach((id) => requireUuid(id, 'lead id'))

    const mode = body.mode ?? 'single'

    if (mode === 'round_robin') {
      // Atomic distribution inside the database, re-checking admin rights itself.
      const { data, error } = await req.db.rpc('assign_leads_round_robin', { p_lead_ids: ids })
      if (error) throw badRequest(error.message)
      return res.json({ mode, ...data })
    }

    const assignedTo = mode === 'unassign' ? null : requireUuid(body.assigned_to, 'assigned_to')

    if (assignedTo) {
      const { data: target } = await req.db
        .from('profiles')
        .select('id, role, active')
        .eq('id', assignedTo)
        .maybeSingle()
      if (!target || target.role !== 'employee' || !target.active) {
        throw badRequest('assigned_to must be an active employee')
      }
    }

    const { data, error } = await req.db
      .from('leads')
      .update({ assigned_to: assignedTo })
      .in('id', ids)
      .select('id')
    if (error) throw badRequest(error.message)

    res.json({ mode, assigned: data?.length ?? 0, assigned_to: assignedTo })
  }),
)

/* -------------------------------------------------------------------------- */
/* CSV import                                                                 */
/* -------------------------------------------------------------------------- */

const HEADER_ALIASES = {
  name: ['name', 'full_name', 'fullname', 'lead', 'lead_name', 'contact', 'contact_name', 'customer'],
  phone: ['phone', 'mobile', 'phone_number', 'number', 'mobile_number', 'contact_number', 'cell'],
  email: ['email', 'email_address', 'mail'],
  company: ['company', 'company_name', 'organisation', 'organization', 'business'],
  city: ['city', 'location', 'area', 'region'],
  source: ['source', 'lead_source', 'campaign', 'channel'],
  status: ['status', 'lead_status', 'stage'],
  notes: ['notes', 'note', 'remark', 'remarks', 'comment', 'comments', 'feedback'],
  assigned_to: ['assigned_to', 'assignee', 'employee', 'owner', 'assigned', 'agent', 'rep'],
}

function pick(record, field) {
  for (const alias of HEADER_ALIASES[field]) {
    const value = record[alias]
    if (value !== undefined && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

adminRouter.post(
  '/leads/import',
  asyncHandler(async (req, res) => {
    const csvText = req.body?.csv
    if (typeof csvText !== 'string' || !csvText.trim()) {
      throw badRequest('csv must be the text content of a .csv file')
    }
    if (Buffer.byteLength(csvText, 'utf8') > MAX_IMPORT_BYTES) {
      throw badRequest('File is larger than 2 MB. Split it into smaller imports.')
    }

    const { headers, records } = parseCsvObjects(csvText)
    if (headers.length === 0) throw badRequest('The file appears to be empty')
    if (records.length === 0) throw badRequest('No data rows found below the header row')
    if (records.length > MAX_IMPORT_ROWS) {
      throw badRequest(`At most ${MAX_IMPORT_ROWS} rows can be imported at once`)
    }

    const hasName = HEADER_ALIASES.name.some((h) => headers.includes(h))
    const hasPhone = HEADER_ALIASES.phone.some((h) => headers.includes(h))
    if (!hasName || !hasPhone) {
      throw badRequest(
        'The CSV needs a name column and a phone column. Accepted headers: name (full_name), phone (mobile, phone_number).',
      )
    }

    // Employee lookup for the optional assignee column (matched by email or name).
    const { data: profiles } = await req.db
      .from('profiles')
      .select('id, full_name, email, role, active')
      .eq('role', 'employee')
    const byEmail = new Map()
    const byName = new Map()
    for (const p of profiles ?? []) {
      if (p.email) byEmail.set(p.email.toLowerCase(), p)
      if (p.full_name) byName.set(p.full_name.toLowerCase(), p)
    }

    const skipped = []
    const candidates = []
    const seenPhones = new Set()

    for (const record of records) {
      const line = record.__line
      const name = pick(record, 'name').slice(0, 120)
      const phoneRaw = pick(record, 'phone')
      const phone = normalizePhone(phoneRaw)

      if (!name) {
        skipped.push({ line, reason: 'Missing lead name' })
        continue
      }
      if (!phone || phone.replace(/\D/g, '').length < 7) {
        skipped.push({ line, reason: 'Missing or invalid phone number' })
        continue
      }
      if (seenPhones.has(phone)) {
        skipped.push({ line, reason: 'Duplicate phone number within this file', phone })
        continue
      }

      const statusRaw = pick(record, 'status')
      const status = statusRaw ? normalizeStatus(statusRaw) : 'New'
      if (!status) {
        skipped.push({
          line,
          reason: `Unknown status "${statusRaw}". Use: ${LEAD_STATUSES.join(', ')}`,
          phone,
        })
        continue
      }

      let assignedTo = null
      const assignee = pick(record, 'assigned_to')
      if (assignee) {
        const found = byEmail.get(assignee.toLowerCase()) ?? byName.get(assignee.toLowerCase())
        if (!found) {
          skipped.push({ line, reason: `Unknown employee "${assignee}"`, phone })
          continue
        }
        assignedTo = found.id
      }

      seenPhones.add(phone)
      candidates.push({
        name,
        phone,
        email: pick(record, 'email').slice(0, 160) || null,
        company: pick(record, 'company').slice(0, 160) || null,
        city: pick(record, 'city').slice(0, 120) || null,
        source: pick(record, 'source').slice(0, 60) || null,
        notes: pick(record, 'notes').slice(0, 4000) || null,
        status,
        assigned_to: assignedTo,
        created_by: req.profile.id,
      })
    }

    // Skip phones that already exist, so re-importing a file is safe.
    const existing = new Set()
    for (let i = 0; i < candidates.length; i += 300) {
      const chunkPhones = candidates.slice(i, i + 300).map((c) => c.phone)
      const { data } = await req.db.from('leads').select('phone').in('phone', chunkPhones)
      for (const row of data ?? []) existing.add(row.phone)
    }

    const toInsert = []
    for (const candidate of candidates) {
      if (existing.has(candidate.phone)) {
        skipped.push({
          line: null,
          reason: 'A lead with this phone number already exists',
          phone: candidate.phone,
        })
      } else {
        toInsert.push(candidate)
      }
    }

    let imported = 0
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200)
      const { data, error } = await req.db.from('leads').insert(chunk).select('id')
      if (error) {
        skipped.push({ line: null, reason: `Insert failed: ${error.message}`, phone: null })
        continue
      }
      imported += data?.length ?? 0
    }

    res.json({
      imported,
      skipped_count: skipped.length,
      total_rows: records.length,
      skipped: skipped.slice(0, 100),
    })
  }),
)

/* -------------------------------------------------------------------------- */
/* CSV export                                                                 */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/leads/export',
  asyncHandler(async (req, res) => {
    let qb = req.db.from('leads').select('*').range(0, 19999)
    qb = applyLeadFilters(qb, req.query, {})
    qb = applyLeadSort(qb, { sort: req.query.sort ?? 'created', dir: req.query.dir ?? 'asc' })

    const { data, error } = await qb
    if (error) throw badRequest(error.message)

    const { data: profiles } = await req.db.from('profiles').select('id, full_name, email')
    const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]))

    const rows = (data ?? []).map((lead) => ({
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? '',
      company: lead.company ?? '',
      city: lead.city ?? '',
      source: lead.source ?? '',
      status: lead.status,
      assigned_to: lead.assigned_to ? names.get(lead.assigned_to) ?? '' : '',
      notes: lead.notes ?? '',
      last_contacted_at: lead.last_contacted_at ?? '',
      created_at: lead.created_at,
      updated_at: lead.updated_at,
    }))

    const csv = toCsv(
      [
        'name',
        'phone',
        'email',
        'company',
        'city',
        'source',
        'status',
        'assigned_to',
        'notes',
        'last_contacted_at',
        'created_at',
        'updated_at',
      ],
      rows,
    )

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="callpro-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    )
    res.send(csv)
  }),
)

adminRouter.get(
  '/calls',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number.parseInt(req.query.limit ?? '100', 10) || 100, 500)

    let qb = req.db
      .from('call_logs')
      .select('*', { count: 'exact' })
      .order('called_at', { ascending: false })
      .limit(limit)

    if (req.query.employee_id) {
      qb = qb.eq('employee_id', requireUuid(req.query.employee_id, 'employee_id'))
    }
    if (req.query.lead_id) qb = qb.eq('lead_id', requireUuid(req.query.lead_id, 'lead_id'))
    const from = cleanDate(req.query.from, 'from')
    const to = cleanDate(req.query.to, 'to')
    if (from) qb = qb.gte('called_at', from)
    if (to) qb = qb.lte('called_at', to)

    const { data, error, count } = await qb
    if (error) throw badRequest(error.message)

    const rows = data ?? []
    const leadIds = [...new Set(rows.map((c) => c.lead_id))]
    const employeeIds = [...new Set(rows.map((c) => c.employee_id))]

    const [leadsRes, profilesRes] = await Promise.all([
      leadIds.length
        ? req.db.from('leads').select('id, name, phone, company').in('id', leadIds)
        : Promise.resolve({ data: [] }),
      employeeIds.length
        ? req.db.from('profiles').select('id, full_name, email').in('id', employeeIds)
        : Promise.resolve({ data: [] }),
    ])

    const leadMap = new Map((leadsRes.data ?? []).map((l) => [l.id, l]))
    const nameMap = new Map(
      (profilesRes.data ?? []).map((p) => [p.id, p.full_name || p.email]),
    )

    res.json({
      rows: rows.map((c) => ({
        ...c,
        employee_name: nameMap.get(c.employee_id) ?? null,
        lead: leadMap.get(c.lead_id) ?? null,
      })),
      total: count ?? rows.length,
    })
  }),
)

adminRouter.get(
  '/calls/export',
  asyncHandler(async (req, res) => {
    let qb = req.db.from('call_logs').select('*').order('called_at', { ascending: false }).range(0, 19999)

    if (req.query.employee_id) {
      qb = qb.eq('employee_id', requireUuid(req.query.employee_id, 'employee_id'))
    }
    const from = cleanDate(req.query.from, 'from')
    const to = cleanDate(req.query.to, 'to')
    if (from) qb = qb.gte('called_at', from)
    if (to) qb = qb.lte('called_at', to)

    const { data, error } = await qb
    if (error) throw badRequest(error.message)

    const rows = data ?? []
    const leadIds = [...new Set(rows.map((c) => c.lead_id))]
    const employeeIds = [...new Set(rows.map((c) => c.employee_id))]

    const [leadsRes, profilesRes] = await Promise.all([
      leadIds.length ? req.db.from('leads').select('id, name, phone').in('id', leadIds) : Promise.resolve({ data: [] }),
      employeeIds.length
        ? req.db.from('profiles').select('id, full_name, email').in('id', employeeIds)
        : Promise.resolve({ data: [] }),
    ])
    const leadMap = new Map((leadsRes.data ?? []).map((l) => [l.id, l]))
    const nameMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p.full_name || p.email]))

    const csv = toCsv(
      ['called_at', 'employee', 'lead_name', 'phone', 'outcome', 'duration_seconds', 'notes'],
      rows.map((c) => ({
        called_at: c.called_at,
        employee: nameMap.get(c.employee_id) ?? '',
        lead_name: leadMap.get(c.lead_id)?.name ?? '',
        phone: leadMap.get(c.lead_id)?.phone ?? '',
        outcome: c.outcome ?? '',
        duration_seconds: c.duration_seconds ?? 0,
        notes: c.note ?? '',
      })),
    )

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="callpro-calls-${new Date().toISOString().slice(0, 10)}.csv"`,
    )
    res.send(csv)
  }),
)

/* -------------------------------------------------------------------------- */
/* attendance (admin)                                                         */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const date = (req.query.date ? String(req.query.date) : new Date().toISOString()).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('date must be YYYY-MM-DD')

    const { data: employees, error: empError } = await req.db
      .from('profiles')
      .select('id, full_name, email, role, active')
      .eq('role', 'employee')
      .order('full_name')
    if (empError) throw badRequest(empError.message)

    const { data: rows, error } = await req.db
      .from('attendance')
      .select('*')
      .eq('work_date', date)
    if (error) throw badRequest(error.message)

    const byEmployee = new Map((rows ?? []).map((r) => [r.employee_id, r]))

    res.json({
      date,
      rows: (employees ?? []).map((e) => ({
        employee_id: e.id,
        full_name: e.full_name,
        email: e.email,
        active: e.active,
        attendance: byEmployee.get(e.id) ?? null,
      })),
    })
  }),
)

adminRouter.post(
  '/attendance',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {}
    const employeeId = requireUuid(body.employee_id, 'employee_id')
    const workDate = cleanDate(body.work_date ?? new Date().toISOString(), 'work_date').slice(0, 10)

    const status = body.status ?? 'present'
    if (!ATTENDANCE_STATUSES.includes(status)) {
      throw badRequest(`status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`)
    }

    const payload = {
      employee_id: employeeId,
      work_date: workDate,
      status,
      check_in: cleanDate(body.check_in, 'check_in'),
      check_out: cleanDate(body.check_out, 'check_out'),
      notes: cleanText(body.notes, 1000),
    }

    const { data, error } = await req.db
      .from('attendance')
      .upsert(payload, { onConflict: 'employee_id,work_date' })
      .select('*')
      .single()
    if (error) throw badRequest(error.message)

    res.json({ attendance: data })
  }),
)
