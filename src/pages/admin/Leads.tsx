import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, downloadCsv, errorMessage, qs } from '../../lib/api'
import { fmtDate, initials } from '../../lib/format'
import { LEAD_STATUSES, type Lead, type Profile } from '../../lib/types'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  StatusPill,
  useToast,
} from '../../components/ui'

const PAGE_SIZE = 25

interface LeadsResponse {
  rows: Lead[]
  total: number
}

const SORTS: { value: string; label: string }[] = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'created', label: 'Newest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'company', label: 'Company A–Z' },
  { value: 'status', label: 'Status' },
]

const emptyForm = {
  name: '',
  phone: '',
  email: '',
  company: '',
  city: '',
  source: '',
  status: 'New',
  assigned_to: '',
  notes: '',
}

export function AdminLeadsPage() {
  const [params, setParams] = useSearchParams()
  const toast = useToast()

  const [rows, setRows] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [employees, setEmployees] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  const [search, setSearch] = useState(params.get('q') ?? '')
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [assignee, setAssignee] = useState(params.get('assigned_to') ?? '')
  const [sort, setSort] = useState(params.get('sort') ?? 'recent')
  const [page, setPage] = useState(Number(params.get('page') ?? '1') || 1)

  const [showNew, setShowNew] = useState(params.get('new') === '1')
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [showImport, setShowImport] = useState(params.get('import') === '1')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [assignMode, setAssignMode] = useState<'single' | 'round_robin' | 'unassign'>('single')
  const [assignTarget, setAssignTarget] = useState('')
  const [assigning, setAssigning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<LeadsResponse>(
        `/leads${qs({ q: search, status, assigned_to: assignee, sort, page, page_size: PAGE_SIZE })}`,
      )
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [search, status, assignee, sort, page])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    api
      .get<{ employees: Profile[] }>('/employees')
      .then((data) => setEmployees(data.employees ?? []))
      .catch(() => setEmployees([]))
  }, [])

  // Keep the URL in sync so filters are shareable and survive a refresh.
  useEffect(() => {
    const next: Record<string, string> = {}
    if (search) next.q = search
    if (status) next.status = status
    if (assignee) next.assigned_to = assignee
    if (sort && sort !== 'recent') next.sort = sort
    if (page > 1) next.page = String(page)
    setParams(next, { replace: true })
  }, [search, status, assignee, sort, page, setParams])

  const allSelected = rows.length > 0 && selected.length === rows.length
  const toggleAll = () => setSelected(allSelected ? [] : rows.map((r) => r.id))
  const toggleOne = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const employeeName = useMemo(() => {
    const map = new Map(employees.map((e) => [e.id, e.full_name || e.email]))
    return (id: string | null) => (id ? map.get(id) ?? '—' : 'Unassigned')
  }, [employees])

  const resetFilters = () => {
    setSearch('')
    setStatus('')
    setAssignee('')
    setSort('recent')
    setPage(1)
  }

  const createLead = async () => {
    setSaving(true)
    setFormError(null)
    try {
      await api.post<{ lead: Lead }>('/leads', {
        ...form,
        assigned_to: form.assigned_to || null,
      })
      toast.push('Lead created', 'success')
      setShowNew(false)
      setForm({ ...emptyForm })
      setPage(1)
      await load()
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const applyAssignment = async () => {
    if (selected.length === 0) return
    setAssigning(true)
    setError(null)
    try {
      await api.post('/leads/assign', {
        lead_ids: selected,
        mode: assignMode,
        assigned_to: assignTarget || null,
      })
      toast.push('Assignments updated', 'success')
      setSelected([])
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setAssigning(false)
    }
  }

  const removeLead = async (lead: Lead) => {
    if (!window.confirm(`Delete ${lead.name}? Call history and follow-ups for this lead are removed too.`)) {
      return
    }
    try {
      await api.delete(`/leads/${lead.id}`)
      toast.push('Lead deleted', 'success')
      setSelected((prev) => prev.filter((id) => id !== lead.id))
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const exportCsv = async () => {
    try {
      await downloadCsv(
        `/leads/export${qs({ q: search, status, assigned_to: assignee, sort })}`,
        `callpro-leads-${new Date().toISOString().slice(0, 10)}.csv`,
      )
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const runImport = async (file: File) => {
    setImporting(true)
    setImportResult(null)
    setFormError(null)
    try {
      const csv = await file.text()
      const result = await api.post<Record<string, number>>('/leads/import', { csv })
      const inserted = result.imported ?? result.inserted ?? 0
      const skipped = result.skipped ?? result.skipped_count ?? 0
      const duplicates = result.duplicates ?? 0
      setImportResult(
        `Imported ${inserted} lead${inserted === 1 ? '' : 's'}` +
          (skipped ? ` · ${skipped} row${skipped === 1 ? '' : 's'} skipped` : '') +
          (duplicates ? ` · ${duplicates} duplicate phone${duplicates === 1 ? '' : 's'}` : ''),
      )
      toast.push('Import finished', 'success')
      setPage(1)
      await load()
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="Leads"
        subtitle={`${total} lead${total === 1 ? '' : 's'} in the pipeline.`}
        actions={
          <>
            <Button variant="secondary" icon="upload" onClick={() => setShowImport(true)}>
              Import CSV
            </Button>
            <Button variant="secondary" icon="download" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
            <Button icon="plus" onClick={() => setShowNew(true)}>
              Add lead
            </Button>
          </>
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Card padded={false}>
        <div className="toolbar">
          <div className="toolbar-row">
            <div className="search-wrap">
              <svg className="search-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                className="input"
                type="search"
                placeholder="Search name, phone, company…"
                value={search}
                onChange={(event) => {
                  setPage(1)
                  setSearch(event.target.value)
                }}
                aria-label="Search leads"
              />
            </div>
            <select
              className="input"
              value={status}
              onChange={(event) => {
                setPage(1)
                setStatus(event.target.value)
              }}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={assignee}
              onChange={(event) => {
                setPage(1)
                setAssignee(event.target.value)
              }}
              aria-label="Filter by assignee"
            >
              <option value="">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name || emp.email}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort leads"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
          </div>

          {selected.length > 0 ? (
            <div className="toolbar-row">
              <strong className="small">{selected.length} selected</strong>
              <select
                className="input"
                value={assignMode}
                onChange={(event) => setAssignMode(event.target.value as typeof assignMode)}
                aria-label="Assignment mode"
              >
                <option value="single">Assign to agent</option>
                <option value="round_robin">Distribute round-robin</option>
                <option value="unassign">Unassign</option>
              </select>
              {assignMode === 'single' ? (
                <select
                  className="input"
                  value={assignTarget}
                  onChange={(event) => setAssignTarget(event.target.value)}
                  aria-label="Select agent"
                >
                  <option value="">Choose agent…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name || emp.email}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button
                size="sm"
                loading={assigning}
                onClick={() => void applyAssignment()}
                disabled={assignMode === 'single' && !assignTarget}
              >
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          ) : null}
        </div>

        {loading && rows.length === 0 ? (
          <Loading label="Loading leads…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="leads"
            title="No leads match these filters"
            message="Adjust the search or import a CSV to fill the pipeline."
            action={<Button onClick={() => setShowImport(true)}>Import CSV</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all leads on this page"
                    />
                  </th>
                  <th>Lead</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(lead.id)}
                        onChange={() => toggleOne(lead.id)}
                        aria-label={`Select ${lead.name}`}
                      />
                    </td>
                    <td>
                      <Link to={`/admin/leads/${lead.id}`} className="row">
                        <span className="avatar">{initials(lead.name)}</span>
                        <span>
                          <span className="record-title">{lead.name}</span>
                          <span className="small muted">{lead.company || lead.source || '—'}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="mono">{lead.phone}</td>
                    <td>
                      <StatusPill status={lead.status} />
                    </td>
                    <td className="small">{employeeName(lead.assigned_to)}</td>
                    <td className="small muted">{fmtDate(lead.updated_at ?? lead.created_at)}</td>
                    <td>
                      <div className="row">
                        <Link className="btn btn-ghost btn-sm" to={`/admin/leads/${lead.id}`}>
                          <span>Open</span>
                        </Link>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => void removeLead(lead)}
                          aria-label={`Delete ${lead.name}`}
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: '0 16px 16px' }}>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </div>
      </Card>

      <Modal
        open={showNew}
        title="Add lead"
        onClose={() => setShowNew(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void createLead()} disabled={!form.name || !form.phone}>
              Save lead
            </Button>
          </>
        }
      >
        {formError ? <ErrorNote>{formError}</ErrorNote> : null}
        <div className="form-grid">
          <Field label="Name" hint="Required">
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })
              }
            />
          </Field>
          <Field label="Phone" hint="Required">
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Company">
            <input
              className="input"
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </Field>
          <Field label="City">
            <input
              className="input"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </Field>
          <Field label="Source">
            <input
              className="input"
              placeholder="Website, referral, list…"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            />
          </Field>
          <Field label="Status">
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assign to">
            <select
              className="input"
              value={form.assigned_to}
              onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
            >
              <option value="">Leave unassigned</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name || emp.email}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            className="input"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
      </Modal>

      <Modal
        open={showImport}
        title="Import leads from CSV"
        onClose={() => setShowImport(false)}
        footer={<Button variant="ghost" onClick={() => setShowImport(false)}>Close</Button>}
      >
        <p className="muted small">
          The file needs a <code>name</code> column and a <code>phone</code> column. Optional columns:{' '}
          <code>email</code>, <code>company</code>, <code>city</code>, <code>source</code>, <code>status</code>,{' '}
          <code>notes</code>, <code>assigned_to</code> (agent email or name).
        </p>
        <input
          ref={fileRef}
          className="input"
          type="file"
          accept=".csv,text/csv"
          disabled={importing}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void runImport(file)
          }}
        />
        {importing ? <p className="small muted">Uploading and validating…</p> : null}
        {importResult ? <div className="note note-good">{importResult}</div> : null}
        {formError ? <ErrorNote>{formError}</ErrorNote> : null}
        <p className="small muted">
          Tip: export the current list first to get a template with the exact headers.
        </p>
      </Modal>
    </div>
  )
}
