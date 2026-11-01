import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorMessage } from '../../lib/api'
import { fmtDate, initials } from '../../lib/format'
import type { EmployeeStat, Profile } from '../../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  InfoNote,
  Loading,
  Modal,
  PageHeader,
  useToast,
} from '../../components/ui'

type EmployeeRow = Omit<EmployeeStat, 'role' | 'active'> & {
  phone?: string | null
  role?: 'admin' | 'employee'
  active?: boolean
  created_at?: string
}

interface EmployeesResponse {
  employees: EmployeeRow[]
  admins: Profile[]
  total_employees: number
  active_employees: number
}

const emptyNew = { full_name: '', email: '', phone: '', password: '', role: 'employee' }

export function EmployeesPage() {
  const toast = useToast()
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [admins, setAdmins] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ ...emptyNew })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [editing, setEditing] = useState<EmployeeRow | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', phone: '', role: 'employee', active: true })

  const [passwordFor, setPasswordFor] = useState<EmployeeRow | null>(null)
  const [password, setPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<EmployeesResponse>('/employees')
      setRows(data.employees ?? [])
      setAdmins(data.admins ?? [])
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createEmployee = async () => {
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/employees', form)
      toast.push('Account created', 'success')
      setShowNew(false)
      setForm({ ...emptyNew })
      await load()
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (row: EmployeeRow) => {
    setEditing(row)
    setFormError(null)
    setEditForm({
      full_name: row.full_name ?? '',
      phone: row.phone ?? '',
      role: row.role ?? 'employee',
      active: row.active ?? true,
    })
  }

  const saveEdit = async () => {
    if (!editing) return
    setSaving(true)
    setFormError(null)
    try {
      await api.patch(`/employees/${editing.id}`, editForm)
      toast.push('Profile updated', 'success')
      setEditing(null)
      await load()
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (row: EmployeeRow) => {
    setError(null)
    try {
      await api.patch(`/employees/${row.id}`, { active: !(row.active ?? true) })
      toast.push(row.active ? 'Account deactivated' : 'Account reactivated', 'success')
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const savePassword = async () => {
    if (!passwordFor) return
    setPasswordSaving(true)
    setFormError(null)
    try {
      await api.post(`/employees/${passwordFor.id}/password`, { password })
      toast.push('Password reset', 'success')
      setPasswordFor(null)
      setPassword('')
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setPasswordSaving(false)
    }
  }

  const removeEmployee = async (row: EmployeeRow) => {
    if (!window.confirm(`Delete ${row.full_name || row.email}? Their leads stay in the pipeline but become unassigned.`)) {
      return
    }
    setError(null)
    try {
      await api.delete(`/employees/${row.id}`)
      toast.push('Account deleted', 'success')
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="Team"
        subtitle={`${rows.filter((r) => r.active !== false).length} active of ${rows.length} accounts.`}
        actions={
          <Button icon="plus" onClick={() => { setFormError(null); setShowNew(true) }}>
            Add employee
          </Button>
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Card padded={false}>
        {loading && rows.length === 0 ? (
          <Loading label="Loading team…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="team"
            title="No employees yet"
            message="Create an account for each agent so they can sign in and work their leads."
            action={<Button onClick={() => setShowNew(true)}>Add employee</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Leads</th>
                  <th>Calls</th>
                  <th>Converted</th>
                  <th>Follow-ups</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const active = row.active !== false
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="row">
                          <span className="avatar">{initials(row.full_name || row.email)}</span>
                          <span>
                            <span className="record-title">{row.full_name || row.email}</span>
                            <span className="small muted">{row.email}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <Badge tone={active ? 'good' : 'warn'}>{active ? 'Active' : 'Disabled'}</Badge>
                      </td>
                      <td>
                        <Link to={`/admin/leads?assigned_to=${row.id}`}>{row.leads ?? 0}</Link>
                      </td>
                      <td>{row.calls_total ?? 0}</td>
                      <td>{row.converted ?? 0}</td>
                      <td>
                        {row.pending_followups ?? 0}
                        {(row.overdue_followups ?? 0) > 0 ? (
                          <span className="badge badge-bad" style={{ marginLeft: 6 }}>
                            {row.overdue_followups} overdue
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <div className="row">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setFormError(null); setPassword(''); setPasswordFor(row) }}
                          >
                            Password
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void toggleActive(row)}>
                            {active ? 'Disable' : 'Enable'}
                          </Button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => void removeEmployee(row)}
                            aria-label={`Delete ${row.full_name || row.email}`}
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Administrators" subtitle="Admins can manage the team, leads and reporting.">
        {admins.length === 0 ? (
          <p className="muted small">No administrator profiles found.</p>
        ) : (
          <div className="record-list">
            {admins.map((admin) => (
              <div className="record" key={admin.id}>
                <div className="record-top">
                  <span className="record-title">{admin.full_name || admin.email}</span>
                  <Badge tone={admin.active === false ? 'warn' : 'info'}>
                    {admin.active === false ? 'Disabled' : 'Admin'}
                  </Badge>
                </div>
                <div className="record-meta">
                  <span>{admin.email}</span>
                  {admin.created_at ? <span>Joined {fmtDate(admin.created_at)}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={showNew}
        title="Add employee"
        onClose={() => setShowNew(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              onClick={() => void createEmployee()}
              disabled={!form.full_name || !form.email || form.password.length < 8}
            >
              Create account
            </Button>
          </>
        }
      >
        {formError ? <ErrorNote>{formError}</ErrorNote> : null}
        <div className="form-grid">
          <Field label="Full name">
            <input
              className="input"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </Field>
          <Field label="Work email">
            <input
              className="input"
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="employee">Employee</option>
              <option value="admin">Administrator</option>
            </select>
          </Field>
        </div>
        <Field label="Temporary password" hint="At least 8 characters. Share it privately — it is never shown again.">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <InfoNote>
          The account is created confirmed, so the employee can sign in immediately. Role changes are applied by the
          server through the service role; no key ever reaches the browser.
        </InfoNote>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Edit employee"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void saveEdit()}>
              Save changes
            </Button>
          </>
        }
      >
        {formError ? <ErrorNote>{formError}</ErrorNote> : null}
        <div className="form-grid">
          <Field label="Full name">
            <input
              className="input"
              value={editForm.full_name}
              onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={editForm.phone}
              onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <select
              className="input"
              value={editForm.role}
              onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
            >
              <option value="employee">Employee</option>
              <option value="admin">Administrator</option>
            </select>
          </Field>
          <Field label="Account status">
            <div className="checkbox-row">
              <input
                id="active-toggle"
                type="checkbox"
                checked={editForm.active}
                onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
              />
              <label htmlFor="active-toggle">Can sign in</label>
            </div>
          </Field>
        </div>
        <p className="small muted">Email cannot be changed here; create a new account if it was mistyped.</p>
      </Modal>

      <Modal
        open={Boolean(passwordFor)}
        title={`Reset password${passwordFor ? ` · ${passwordFor.full_name || passwordFor.email}` : ''}`}
        onClose={() => setPasswordFor(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasswordFor(null)}>
              Cancel
            </Button>
            <Button loading={passwordSaving} onClick={() => void savePassword()} disabled={password.length < 8}>
              Set password
            </Button>
          </>
        }
      >
        {formError ? <ErrorNote>{formError}</ErrorNote> : null}
        <Field label="New password" hint="At least 8 characters.">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  )
}
