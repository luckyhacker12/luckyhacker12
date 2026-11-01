import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, errorMessage, qs } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { LEAD_STATUSES, type Lead, type Paged } from '../../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Loading,
  PageHeader,
  Pagination,
  StatusPill,
} from '../../components/ui'

const PAGE_SIZE = 20

export function MyLeadsPage() {
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const sort = params.get('sort') ?? 'next'
  const page = Number.parseInt(params.get('page') ?? '1', 10) || 1

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    if (!patch.page) next.delete('page')
    setParams(next, { replace: true })
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<Paged<Lead>>(
        `/leads${qs({ q, status, sort, page, pageSize: PAGE_SIZE })}`,
      )
      setRows(data.rows ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [q, status, sort, page])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="stack">
      <PageHeader
        title="My leads"
        subtitle={`${total} lead${total === 1 ? '' : 's'} assigned to you.`}
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            Refresh
          </Button>
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Card>
        <div className="form-grid">
          <Field label="Search">
            <input
              className="input"
              value={q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Name, phone, company…"
              type="search"
            />
          </Field>
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => update({ status: e.target.value })}>
              <option value="">All statuses</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sort">
            <select className="input" value={sort} onChange={(e) => update({ sort: e.target.value })}>
              <option value="next">Follow-up first</option>
              <option value="recent">Recently updated</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card padded={false}>
        {loading && rows.length === 0 ? (
          <Loading label="Loading your leads…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="leads"
            title="No leads here"
            message={q || status ? 'Try clearing the search or status filter.' : 'An administrator has not assigned leads to you yet.'}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Status</th>
                    <th>Last contact</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <span className="record-title">{lead.name}</span>
                        <span className="small muted mono">{lead.phone}</span>
                        {lead.company ? <span className="small muted">{lead.company}</span> : null}
                      </td>
                      <td>
                        <StatusPill status={lead.status} />
                      </td>
                      <td className="small muted">{lead.last_contacted_at ? fmtDateTime(lead.last_contacted_at) : 'Never'}</td>
                      <td>
                        <Link className="btn btn-secondary btn-sm" to={`/employee/leads/${lead.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onPage={(next) => update({ page: String(next) })}
            />
          </>
        )}
      </Card>
      <p className="small muted">
        <Badge tone="info">Scoped</Badge> You only see leads assigned to you — enforced by row-level security.
      </p>
    </div>
  )
}
