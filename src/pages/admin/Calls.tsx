import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, downloadCsv, errorMessage, qs } from '../../lib/api'
import { fmtDateTime, fmtDuration, todayISO } from '../../lib/format'
import type { Profile } from '../../lib/types'
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

interface CallRow {
  id: string
  lead_id: string
  employee_id: string
  outcome: string
  note: string | null
  duration_seconds: number | null
  called_at: string
  employee_name?: string | null
  lead?: { id: string; name: string; phone: string; company: string | null } | null
}

interface CallsResponse {
  rows: CallRow[]
  total: number
}

export function CallHistoryPage() {
  const toast = useToast()
  const [rows, setRows] = useState<CallRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [employees, setEmployees] = useState<Profile[]>([])

  const [employeeId, setEmployeeId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<CallsResponse>(`/calls${qs({ employee_id: employeeId, from, to, limit: 200 })}`)
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [employeeId, from, to])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    api
      .get<{ employees: { id: string; full_name: string; email: string }[] }>('/employees')
      .then((data) =>
        setEmployees(
          (data.employees ?? []).map((e) => ({
            id: e.id,
            full_name: e.full_name,
            email: e.email,
            phone: null,
            role: 'employee',
            active: true,
            created_at: '',
          })) as unknown as Profile[],
        ),
      )
      .catch(() => setEmployees([]))
  }, [])

  const exportCsv = async () => {
    try {
      await downloadCsv(
        `/calls/export${qs({ employee_id: employeeId, from, to })}`,
        `callpro-calls-${todayISO()}.csv`,
      )
      toast.push('Export ready', 'good')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const reset = () => {
    setEmployeeId('')
    setFrom('')
    setTo('')
  }

  return (
    <div className="stack">
      <PageHeader
        title="Call history"
        subtitle={`${total} logged call${total === 1 ? '' : 's'} match this view.`}
        actions={
          <>
            <Button variant="secondary" icon="download" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => void load()} loading={loading}>
              Refresh
            </Button>
          </>
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Card>
        <div className="form-grid">
          <Field label="Employee">
            <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Everyone</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name || emp.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="form-actions">
          <Button variant="ghost" size="sm" onClick={reset}>
            Clear filters
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        {loading && rows.length === 0 ? (
          <Loading label="Loading calls…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="phone"
            title="No calls logged yet"
            message="Calls appear here as soon as your team logs them against a lead."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Lead</th>
                  <th>Employee</th>
                  <th>Outcome</th>
                  <th>Duration</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((call) => (
                  <tr key={call.id}>
                    <td className="small">{fmtDateTime(call.called_at)}</td>
                    <td>
                      {call.lead ? (
                        <Link to={`/admin/leads/${call.lead.id}`}>
                          <span className="record-title">{call.lead.name}</span>
                          <span className="small muted mono">{call.lead.phone}</span>
                        </Link>
                      ) : (
                        <span className="muted small">Deleted lead</span>
                      )}
                    </td>
                    <td className="small">{call.employee_name ?? '—'}</td>
                    <td>
                      <Badge tone={call.outcome === 'Answered' ? 'good' : 'info'}>{call.outcome}</Badge>
                    </td>
                    <td className="small mono">{fmtDuration(call.duration_seconds ?? 0)}</td>
                    <td className="small">
                      <span className="truncate" title={call.note ?? ''}>
                        {call.note || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="small muted">Showing the most recent {rows.length} calls. Narrow the date range to see a longer history.</p>
    </div>
  )
}
