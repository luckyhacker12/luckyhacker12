import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorMessage, qs } from '../../lib/api'
import { fmtDateTime, fmtTime, initials, relative, todayISO } from '../../lib/format'
import { useAuth } from '../../state/auth'
import type { Attendance, EmployeeStats, FollowUp } from '../../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  StatCard,
  StatusPill,
  useToast,
} from '../../components/ui'

export function EmployeeHomePage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [stats, setStats] = useState<EmployeeStats | null>(null)
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [attendance, setAttendance] = useState<Attendance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [dash, attendanceData, due] = await Promise.all([
        api.get<{ stats: EmployeeStats }>('/dashboard'),
        api.get<{ rows: Attendance[]; today: Attendance | null }>('/attendance/me'),
        api.get<{ rows: FollowUp[] }>(`/follow-ups${qs({ status: 'pending', limit: 6 })}`),
      ])
      setStats(dash.stats)
      setAttendance(attendanceData.today)
      setFollowUps(due.rows ?? [])
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

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

  const greeting = (() => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  if (loading) return <Loading label="Loading your workspace…" />

  return (
    <div className="stack">
      <PageHeader
        title={`${greeting}, ${(profile?.full_name || 'there').split(' ')[0]}`}
        subtitle={`${todayISO()} · here is your day at a glance.`}
        actions={
          attendance?.check_in && attendance.check_out ? (
            <Badge tone="good">Day complete</Badge>
          ) : attendance?.check_in ? (
            <Button variant="secondary" loading={marking} onClick={() => void mark('out')}>
              Check out ({fmtTime(attendance.check_in)})
            </Button>
          ) : (
            <Button loading={marking} onClick={() => void mark('in')}>
              Check in
            </Button>
          )
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="stat-grid">
        <StatCard label="My leads" value={stats?.my_leads ?? 0} icon="leads" hint={`${stats?.new_leads ?? 0} still new`} />
        <StatCard label="Calls today" value={stats?.calls_today ?? 0} icon="phone" tone="info" hint={`${stats?.calls_total ?? 0} all time`} />
        <StatCard
          label="Due today"
          value={stats?.due_today ?? 0}
          icon="clock"
          tone={(stats?.due_today ?? 0) > 0 ? 'warn' : 'default'}
        />
        <StatCard
          label="Overdue"
          value={stats?.overdue ?? 0}
          icon="alert"
          tone={(stats?.overdue ?? 0) > 0 ? 'bad' : 'good'}
        />
        <StatCard label="Interested" value={stats?.interested ?? 0} icon="star" tone="info" />
        <StatCard label="Converted" value={stats?.converted ?? 0} icon="check" tone="good" />
      </div>

      <div className="two-col">
        <Card
          title="Follow-ups due"
          subtitle="Call these leads next"
          actions={
            <Link className="btn btn-secondary btn-sm" to="/employee/follow-ups">
              View all
            </Link>
          }
        >
          {followUps.length === 0 ? (
            <EmptyState icon="clock" title="Nothing due" message="You have no pending follow-ups. Nice work." />
          ) : (
            <ul className="list">
              {followUps.map((item) => (
                <li key={item.id} className="list-row">
                  <div className="list-main">
                    <Link to={`/employee/leads/${item.lead_id}`} className="record-title">
                      {item.lead?.name ?? 'Lead'}
                    </Link>
                    <span className="small muted">
                      {item.lead?.phone ?? ''}
                      {item.note ? ` · ${item.note}` : ''}
                    </span>
                  </div>
                  <div className="list-side">
                    <Badge tone={item.overdue ? 'bad' : 'info'}>{relative(item.due_at)}</Badge>
                    {item.lead ? <StatusPill status={item.lead.status} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Today's attendance" subtitle={attendance ? 'Your record for today' : 'You have not checked in yet'}>
          {attendance ? (
            <div className="stack">
              <div className="kv">
                <span className="muted small">Status</span>
                <Badge tone={attendance.status === 'present' ? 'good' : 'warn'}>{attendance.status}</Badge>
              </div>
              <div className="kv">
                <span className="muted small">Check in</span>
                <span className="mono">{attendance.check_in ? fmtTime(attendance.check_in) : '—'}</span>
              </div>
              <div className="kv">
                <span className="muted small">Check out</span>
                <span className="mono">{attendance.check_out ? fmtTime(attendance.check_out) : '—'}</span>
              </div>
              {attendance.notes ? <p className="small muted">{attendance.notes}</p> : null}
              <Link className="btn btn-ghost btn-sm" to="/employee/attendance">
                Attendance history
              </Link>
            </div>
          ) : (
            <div className="stack">
              <div className="avatar-lg">{initials(profile?.full_name)}</div>
              <p className="small muted">
                Checking in records your start time. You can check out at the end of your shift.
              </p>
              <Button loading={marking} onClick={() => void mark('in')}>
                Check in now
              </Button>
            </div>
          )}
          {stats ? (
            <p className="small muted" style={{ marginTop: 12 }}>
              Last update {fmtDateTime(new Date().toISOString())}
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  )
}
