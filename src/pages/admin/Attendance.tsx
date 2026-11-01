import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage, qs } from '../../lib/api'
import { fmtDateTime, fmtTime, todayISO } from '../../lib/format'
import type { Attendance, AttendanceStatus } from '../../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Loading,
  Modal,
  PageHeader,
  useToast,
} from '../../components/ui'

interface AttendanceRow {
  employee_id: string
  full_name: string | null
  email: string
  active: boolean
  attendance: Attendance | null
}

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'half-day', label: 'Half day' },
  { value: 'leave', label: 'Leave' },
]

const tone = (status?: string) =>
  status === 'present' ? 'good' : status === 'absent' ? 'bad' : status === 'leave' ? 'info' : 'warn'

export function AdminAttendancePage() {
  const toast = useToast()
  const [date, setDate] = useState(todayISO())
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<AttendanceRow | null>(null)
  const [status, setStatus] = useState<AttendanceStatus>('present')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ date: string; rows: AttendanceRow[] }>(`/attendance${qs({ date })}`)
      setRows(data.rows ?? [])
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  const openMark = (row: AttendanceRow) => {
    setEditing(row)
    setFormError(null)
    setStatus(row.attendance?.status ?? 'present')
    setNotes(row.attendance?.notes ?? '')
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/attendance', {
        employee_id: editing.employee_id,
        work_date: date,
        status,
        notes: notes || null,
      })
      toast.push('Attendance saved', 'good')
      setEditing(null)
      await load()
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const present = rows.filter((r) => r.attendance?.status === 'present').length
  const marked = rows.filter((r) => r.attendance).length

  return (
    <div className="stack">
      <PageHeader
        title="Attendance"
        subtitle={`${present} present · ${marked} of ${rows.length} marked${date === todayISO() ? ' today' : ''}.`}
        actions={<Button variant="secondary" onClick={() => void load()} loading={loading}>Refresh</Button>}
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Card>
        <div className="form-grid">
          <Field label="Work date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Quick jump">
            <div className="row">
              <Button variant="ghost" size="sm" onClick={() => setDate(todayISO())}>
                Today
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const d = new Date(`${date}T00:00:00`)
                  d.setDate(d.getDate() - 1)
                  setDate(d.toISOString().slice(0, 10))
                }}
              >
                Previous day
              </Button>
            </div>
          </Field>
        </div>
      </Card>

      <Card padded={false}>
        {loading && rows.length === 0 ? (
          <Loading label="Loading attendance…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No employees to show"
            message="Add employees to start tracking attendance."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Check in</th>
                  <th>Check out</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employee_id}>
                    <td>
                      <span className="record-title">{row.full_name || row.email}</span>
                      <span className="small muted">{row.email}</span>
                    </td>
                    <td>
                      <Badge tone={tone(row.attendance?.status)}>
                        {row.attendance ? row.attendance.status : 'Not marked'}
                      </Badge>
                    </td>
                    <td className="small mono">
                      {row.attendance?.check_in ? fmtTime(row.attendance.check_in) : '—'}
                    </td>
                    <td className="small mono">
                      {row.attendance?.check_out ? fmtTime(row.attendance.check_out) : '—'}
                    </td>
                    <td className="small">
                      <span className="truncate" title={row.attendance?.notes ?? ''}>
                        {row.attendance?.notes || '—'}
                      </span>
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => openMark(row)}>
                        {row.attendance ? 'Update' : 'Mark'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="small muted">
        Employees can also check themselves in and out from their own dashboard; admins can correct any record here.
      </p>

      <Modal
        open={Boolean(editing)}
        title={`Mark attendance${editing ? ` · ${editing.full_name || editing.email}` : ''}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        {formError ? <ErrorNote>{formError}</ErrorNote> : null}
        <div className="form-grid">
          <Field label="Status">
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Work date">
            <input className="input" value={date} readOnly />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Late arrival, approved leave…"
          />
        </Field>
        {editing?.attendance ? (
          <p className="small muted">
            Last saved {fmtDateTime(editing.attendance.created_at ?? editing.attendance.work_date)}
          </p>
        ) : null}
      </Modal>
    </div>
  )
}
