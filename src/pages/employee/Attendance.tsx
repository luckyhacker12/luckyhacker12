import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage, qs } from '../../lib/api'
import { fmtDate, fmtTime } from '../../lib/format'
import type { Attendance } from '../../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Loading,
  PageHeader,
  useToast,
} from '../../components/ui'

const tone = (status?: string) =>
  status === 'present' ? 'good' : status === 'absent' ? 'bad' : status === 'leave' ? 'info' : 'warn'

const hours = (row: Attendance) => {
  if (!row.check_in || !row.check_out) return '—'
  const diff = new Date(row.check_out).getTime() - new Date(row.check_in).getTime()
  if (diff <= 0) return '—'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.round((diff % 3_600_000) / 60_000)
  return `${h}h ${m}m`
}

export function MyAttendancePage() {
  const toast = useToast()
  const [rows, setRows] = useState<Attendance[]>([])
  const [today, setToday] = useState<Attendance | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ rows: Attendance[]; today: Attendance | null }>(
        `/attendance/me${qs({ from, to })}`,
      )
      setRows(data.rows ?? [])
      setToday(data.today)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  const mark = async (mode: 'in' | 'out') => {
    setMarking(true)
    setError(null)
    try {
      await api.post(`/attendance/check-${mode}`)
      toast.push(mode === 'in' ? 'Checked in' : 'Checked out', 'success')
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setMarking(false)
    }
  }

  const present = rows.filter((r) => r.status === 'present' || r.status === 'half-day').length

  return (
    <div className="stack">
      <PageHeader
        title="My attendance"
        subtitle={`${present} working day${present === 1 ? '' : 's'} in this view.`}
        actions={
          today?.check_in && today.check_out ? (
            <Badge tone="good">Checked out</Badge>
          ) : today?.check_in ? (
            <Button variant="secondary" loading={marking} onClick={() => void mark('out')}>
              Check out
            </Button>
          ) : (
            <Button loading={marking} onClick={() => void mark('in')}>
              Check in
            </Button>
          )
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Card title="Today" subtitle="Your shift status">
        {today ? (
          <div className="stat-grid stat-grid-compact">
            <div className="kv">
              <span className="muted small">Status</span>
              <Badge tone={tone(today.status)}>{today.status}</Badge>
            </div>
            <div className="kv">
              <span className="muted small">Check in</span>
              <span className="mono">{today.check_in ? fmtTime(today.check_in) : '—'}</span>
            </div>
            <div className="kv">
              <span className="muted small">Check out</span>
              <span className="mono">{today.check_out ? fmtTime(today.check_out) : '—'}</span>
            </div>
            <div className="kv">
              <span className="muted small">Hours</span>
              <span className="mono">{hours(today)}</span>
            </div>
          </div>
        ) : (
          <p className="small muted">You have not checked in yet today.</p>
        )}
      </Card>

      <Card>
        <div className="form-grid">
          <Field label="From">
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Reset">
            <Button
              variant="ghost"
              onClick={() => {
                setFrom('')
                setTo('')
              }}
            >
              Clear
            </Button>
          </Field>
        </div>
      </Card>

      <Card padded={false}>
        {loading && rows.length === 0 ? (
          <Loading label="Loading attendance…" />
        ) : rows.length === 0 ? (
          <EmptyState icon="calendar" title="No records yet" message="Your attendance history will appear here after your first check-in." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Check in</th>
                  <th>Check out</th>
                  <th>Hours</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="small">{fmtDate(row.work_date)}</td>
                    <td>
                      <Badge tone={tone(row.status)}>{row.status}</Badge>
                    </td>
                    <td className="small mono">{row.check_in ? fmtTime(row.check_in) : '—'}</td>
                    <td className="small mono">{row.check_out ? fmtTime(row.check_out) : '—'}</td>
                    <td className="small mono">{hours(row)}</td>
                    <td className="small">{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="small muted">Only an administrator can correct a record after the fact.</p>
    </div>
  )
}
