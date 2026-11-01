import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorMessage } from '../../lib/api'
import { fmtDateTime, relative } from '../../lib/format'
import { LEAD_STATUSES, type AdminStats } from '../../lib/types'
import { Button, Card, EmptyState, ErrorNote, Loading, PageHeader, StatCard } from '../../components/ui'

interface DashboardResponse {
  scope: 'admin' | 'employee'
  stats: AdminStats
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<DashboardResponse>('/dashboard')
      setStats(data.stats)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !stats) return <Loading label="Loading dashboard…" />

  const s = stats
  const maxStatus = s ? Math.max(1, ...Object.values(s.status_counts ?? {})) : 1

  return (
    <div className="stack">
      <PageHeader
        title="Dashboard"
        subtitle="Live picture of the calling floor — leads, team output and what needs attention today."
        actions={
          <>
            <Link className="btn btn-secondary btn-md" to="/admin/leads?import=1">
              <Icon name="upload" size={16} />
              <span>Import leads</span>
            </Link>
            <Link className="btn btn-primary btn-md" to="/admin/leads?new=1">
              <span>Add lead</span>
            </Link>
          </>
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {s ? (
        <>
          <div className="stat-grid">
            <StatCard
              label="Total leads"
              value={s.total_leads}
              hint={`${s.unassigned_leads} unassigned · ${s.converted_leads} converted`}
              icon="leads"
              tone="info"
            />
            <StatCard
              label="Team members"
              value={s.total_employees}
              hint={`${s.active_employees} active · ${s.present_today} present today`}
              icon="users"
            />
            <StatCard
              label="Calls logged"
              value={s.total_calls}
              hint={`${s.calls_today} today · ${s.calls_week} this week`}
              icon="phone"
              tone="good"
            />
            <StatCard
              label="Pending follow-ups"
              value={s.pending_followups}
              hint={`${s.due_today_followups} due today · ${s.overdue_followups} overdue`}
              icon="clock"
              tone={s.overdue_followups > 0 ? 'bad' : 'warn'}
            />
          </div>

          <div className="grid-2">
            <Card
              title="Pipeline by status"
              subtitle="Where every lead currently sits."
              actions={
                <Button size="sm" variant="ghost" onClick={() => void load()} loading={loading}>
                  Refresh
                </Button>
              }
            >
              <div className="stack-sm">
                {LEAD_STATUSES.map((status) => {
                  const count = s.status_counts?.[status] ?? 0
                  return (
                    <div className="bar-row" key={status}>
                      <Link className="small truncate" to={`/admin/leads?status=${encodeURIComponent(status)}`}>
                        {status}
                      </Link>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${Math.round((count / maxStatus) * 100)}%` }} />
                      </div>
                      <span className="bar-count">{count}</span>
                    </div>
                  )
                })}
              </div>
            </Card>

            <Card title="Today's priorities" subtitle="Follow-ups that need a decision.">
              <div className="stack-sm">
                <div className="row-between">
                  <span className="muted">Due today</span>
                  <strong>{s.due_today_followups}</strong>
                </div>
                <div className="row-between">
                  <span className="muted">Overdue</span>
                  <strong className={s.overdue_followups > 0 ? 'badge badge-bad' : ''}>{s.overdue_followups}</strong>
                </div>
                <div className="row-between">
                  <span className="muted">Unassigned leads</span>
                  <strong>{s.unassigned_leads}</strong>
                </div>
                <div className="row-between">
                  <span className="muted">Converted leads</span>
                  <strong>{s.converted_leads}</strong>
                </div>
                <div className="form-actions">
                  <Link className="btn btn-secondary btn-sm" to="/admin/follow-ups">
                    <span>Open follow-ups</span>
                  </Link>
                  <Link className="btn btn-secondary btn-sm" to="/admin/leads?assigned_to=unassigned">
                    <span>Assign leads</span>
                  </Link>
                </div>
              </div>
            </Card>
          </div>

          <Card
            title="Team performance"
            subtitle="Per-agent workload and output."
            padded={false}
            actions={
              <Link className="btn btn-ghost btn-sm" to="/admin/employees">
                <span>Manage team</span>
              </Link>
            }
          >
            {(s.employees ?? []).length === 0 ? (
              <EmptyState
                icon="users"
                title="No employees yet"
                message="Add your calling agents to start assigning leads."
                action={
                  <Link className="btn btn-primary btn-md" to="/admin/employees">
                    <span>Add employee</span>
                  </Link>
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Leads</th>
                      <th>Converted</th>
                      <th>Calls today</th>
                      <th>Pending F/U</th>
                      <th>Last call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(s.employees ?? []).map((emp) => (
                      <tr key={emp.id}>
                        <td>
                          <Link to={`/admin/leads?assigned_to=${emp.id}`}>{emp.full_name || emp.email}</Link>
                          <div className="small muted">{emp.email}</div>
                        </td>
                        <td>{emp.leads ?? 0}</td>
                        <td>{emp.converted ?? 0}</td>
                        <td>{emp.calls_today ?? 0}</td>
                        <td>
                          {emp.pending_followups ?? 0}
                          {(emp.overdue_followups ?? 0) > 0 ? (
                            <span className="badge badge-bad" style={{ marginLeft: 6 }}>
                              {emp.overdue_followups} late
                            </span>
                          ) : null}
                        </td>
                        <td className="small muted">
                          {emp.last_call_at ? (
                            <span title={fmtDateTime(emp.last_call_at)}>{relative(emp.last_call_at)}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  )
}
