import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorMessage, qs } from '../../lib/api'
import { fmtDate, fmtDateTime, relative } from '../../lib/format'
import { useAuth } from '../../state/auth'
import type { FollowUp } from '../../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Loading,
  PageHeader,
  StatusPill,
  useToast,
} from '../../components/ui'

type Tab = 'pending' | 'done' | 'all'

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'done', label: 'Completed' },
  { key: 'all', label: 'All' },
]

export function FollowUpsPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('pending')
  const [rows, setRows] = useState<FollowUp[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const base = profile?.role === 'admin' ? '/admin' : '/employee'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ rows: FollowUp[]; total: number }>(`/follow-ups${qs({ status: tab, pageSize: 100 })}`)
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (item: FollowUp, action: 'done' | 'snooze') => {
    setBusyId(item.id)
    setError(null)
    try {
      if (action === 'done') {
        await api.patch(`/follow-ups/${item.id}`, { status: 'done' })
        toast.push('Follow-up completed', 'success')
      } else {
        const due = new Date()
        due.setDate(due.getDate() + 1)
        due.setHours(9, 0, 0, 0)
        await api.patch(`/follow-ups/${item.id}`, { due_at: due.toISOString(), status: 'pending' })
        toast.push('Follow-up moved to tomorrow', 'success')
      }
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const overdue = rows.filter((row) => row.overdue).length

  return (
    <div className="stack">
      <PageHeader
        title="Follow-ups"
        subtitle={
          tab === 'pending'
            ? `${total} pending${overdue ? ` · ${overdue} overdue` : ''}`
            : `${total} record${total === 1 ? '' : 's'}`
        }
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            Refresh
          </Button>
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`tab${tab === item.key ? ' tab-active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Card padded={false}>
        {loading && rows.length === 0 ? (
          <Loading label="Loading follow-ups…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="clock"
            title={tab === 'pending' ? 'Nothing due' : 'No records'}
            message={
              tab === 'pending'
                ? 'When you schedule a next call on a lead it shows up here automatically.'
                : 'Completed follow-ups will be listed here.'
            }
          />
        ) : (
          <ul className="list">
            {rows.map((item) => (
              <li key={item.id} className="list-row">
                <div className="list-main">
                  <div className="row">
                    <Link to={`${base}/leads/${item.lead_id}`} className="record-title">
                      {item.lead?.name ?? 'Lead'}
                    </Link>
                    {item.lead ? <StatusPill status={item.lead.status} /> : null}
                    {item.overdue ? <Badge tone="bad">Overdue</Badge> : null}
                    {item.status !== 'pending' ? <Badge tone="good">{item.status}</Badge> : null}
                  </div>
                  <span className="small muted">
                    {item.lead?.phone ? <span className="mono">{item.lead.phone}</span> : null}
                    {item.lead?.company ? ` · ${item.lead.company}` : ''}
                    {item.note ? ` · ${item.note}` : ''}
                  </span>
                  <span className="small muted">
                    Due {fmtDateTime(item.due_at)} ({relative(item.due_at)})
                    {item.assignee_name ? ` · ${item.assignee_name}` : ''}
                  </span>
                </div>
                <div className="list-side">
                  {item.status === 'pending' ? (
                    <>
                      <Button size="sm" loading={busyId === item.id} onClick={() => void act(item, 'done')}>
                        Mark done
                      </Button>
                      <Button size="sm" variant="ghost" loading={busyId === item.id} onClick={() => void act(item, 'snooze')}>
                        Tomorrow
                      </Button>
                    </>
                  ) : (
                    <span className="small muted">{item.completed_at ? `Closed ${fmtDate(item.completed_at)}` : ''}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
