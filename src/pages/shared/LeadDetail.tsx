import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '../../lib/api'
import { fmtDate, fmtDateTime, fmtDuration, initials, toLocalInput } from '../../lib/format'
import { useAuth } from '../../state/auth'
import {
  CALL_OUTCOMES,
  LEAD_STATUSES,
  type CallLog,
  type FollowUp,
  type Lead,
  type LeadDetailPayload,
  type LeadStatus,
} from '../../lib/types'
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
  StatusPill,
  useToast,
} from '../../components/ui'

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const base = profile?.role === 'admin' ? '/admin' : '/employee'

  const [lead, setLead] = useState<Lead | null>(null)
  const [calls, setCalls] = useState<CallLog[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState<LeadStatus>('New')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const [callOpen, setCallOpen] = useState(false)
  const [callOutcome, setCallOutcome] = useState<string>('Answered')
  const [callNotes, setCallNotes] = useState('')
  const [callDuration, setCallDuration] = useState('0')
  const [callStatus, setCallStatus] = useState<string>('')
  const [nextAt, setNextAt] = useState('')
  const [followNote, setFollowNote] = useState('')
  const [logging, setLogging] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      const data = await api.get<LeadDetailPayload>(`/leads/${id}`)
      setLead(data.lead)
      setCalls(data.calls ?? [])
      setFollowUps(data.follow_ups ?? [])
      setStatus(data.lead.status)
      setNotes(data.lead.notes ?? '')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const saveStatus = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!id) return
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/leads/${id}`, { status, notes })
      toast.push('Lead updated', 'success')
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const logCall = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!id) return
    setLogging(true)
    setError(null)
    try {
      await api.post(`/leads/${id}/calls`, {
        outcome: callOutcome,
        notes: callNotes || undefined,
        duration_seconds: Number.parseInt(callDuration, 10) || 0,
        status: callStatus || undefined,
        next_follow_up_at: nextAt ? new Date(nextAt).toISOString() : undefined,
        follow_up_notes: followNote || undefined,
      })
      toast.push('Call logged', 'success')
      setCallOpen(false)
      setCallNotes('')
      setCallDuration('0')
      setNextAt('')
      setFollowNote('')
      setCallStatus('')
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLogging(false)
    }
  }

  const completeFollowUp = async (item: FollowUp) => {
    setError(null)
    try {
      await api.patch(`/follow-ups/${item.id}`, { status: 'done' })
      toast.push('Follow-up completed', 'success')
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (loading) return <Loading label="Loading lead…" />
  if (!lead) {
    return (
      <div className="stack">
        <ErrorNote>{error ?? 'Lead not found.'}</ErrorNote>
        <Link className="btn btn-secondary" to={`${base}/leads`}>
          Back to leads
        </Link>
      </div>
    )
  }

  const pending = followUps.filter((item) => item.status === 'pending')

  return (
    <div className="stack">
      <PageHeader
        title={lead.name}
        subtitle={
          <span className="row">
            <StatusPill status={lead.status} />
            <span className="small muted mono">{lead.phone}</span>
            {lead.company ? <span className="small muted">{lead.company}</span> : null}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Back
            </Button>
            <Button icon="phone" onClick={() => setCallOpen(true)}>
              Log call
            </Button>
          </>
        }
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="two-col">
        <Card title="Lead details" subtitle={`Source: ${lead.source || '—'}`}>
          <dl className="detail-list">
            <div>
              <dt>Phone</dt>
              <dd className="mono">{lead.phone}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{lead.email || '—'}</dd>
            </div>
            <div>
              <dt>Company</dt>
              <dd>{lead.company || '—'}</dd>
            </div>
            <div>
              <dt>City</dt>
              <dd>{lead.city || '—'}</dd>
            </div>
            <div>
              <dt>Assigned to</dt>
              <dd>{lead.assignee_name || 'Unassigned'}</dd>
            </div>
            <div>
              <dt>Last contact</dt>
              <dd>{lead.last_contacted_at ? fmtDateTime(lead.last_contacted_at) : 'Never'}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{fmtDate(lead.created_at)}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Update lead" subtitle="Change the status or notes after a conversation">
          <form className="form-grid" onSubmit={saveStatus}>
            <Field label="Status">
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
                {LEAD_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes" hint="Free-text notes are visible to admins and the assignee.">
              <textarea
                className="input textarea"
                rows={5}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Interested in the premium plan, asked for a quote…"
              />
            </Field>
            <div className="row">
              <Button type="submit" loading={saving}>
                Save changes
              </Button>
              <Button type="button" variant="ghost" onClick={() => void load()}>
                Reset
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <div className="two-col">
        <Card title="Call history" subtitle={`${calls.length} call${calls.length === 1 ? '' : 's'} logged`}>
          {calls.length === 0 ? (
            <EmptyState icon="phone" title="No calls yet" message="Log the first call to start the history." />
          ) : (
            <ul className="timeline">
              {calls.map((call) => (
                <li key={call.id}>
                  <div className="row">
                    <Badge tone="info">{call.outcome}</Badge>
                    <span className="small muted">{fmtDateTime(call.called_at)}</span>
                    <span className="small muted">· {fmtDuration(call.duration_seconds)}</span>
                  </div>
                  {call.note ? <p className="small">{call.note}</p> : null}
                  {call.employee_name ? (
                    <span className="small muted">
                      {initials(call.employee_name)} · {call.employee_name}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Follow-ups" subtitle={`${pending.length} pending`}>
          {followUps.length === 0 ? (
            <EmptyState icon="clock" title="No follow-ups" message="Schedule the next call while logging a call." />
          ) : (
            <ul className="list">
              {followUps.map((item) => (
                <li key={item.id} className="list-row">
                  <div className="list-main">
                    <div className="row">
                      <span className="small">{fmtDateTime(item.due_at)}</span>
                      {item.overdue ? <Badge tone="bad">Overdue</Badge> : null}
                      <Badge tone={item.status === 'done' ? 'good' : 'default'}>{item.status}</Badge>
                    </div>
                    {item.note ? <span className="small muted">{item.note}</span> : null}
                  </div>
                  {item.status === 'pending' ? (
                    <Button size="sm" variant="secondary" onClick={() => void completeFollowUp(item)}>
                      Done
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={callOpen}
        title={`Log call · ${lead.name}`}
        onClose={() => setCallOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCallOpen(false)}>
              Cancel
            </Button>
            <Button form="log-call-form" type="submit" loading={logging}>
              Save call
            </Button>
          </>
        }
      >
        <form id="log-call-form" className="form-grid" onSubmit={logCall}>
          <Field label="Outcome">
            <select className="input" value={callOutcome} onChange={(e) => setCallOutcome(e.target.value)}>
              {CALL_OUTCOMES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Duration (seconds)">
            <input
              className="input"
              type="number"
              min={0}
              max={86400}
              value={callDuration}
              onChange={(e) => setCallDuration(e.target.value)}
            />
          </Field>
          <Field label="Call notes">
            <textarea
              className="input textarea"
              rows={4}
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              placeholder="What was discussed?"
            />
          </Field>
          <Field label="New status" hint="Optional — leave blank to keep the current status.">
            <select className="input" value={callStatus} onChange={(e) => setCallStatus(e.target.value)}>
              <option value="">Keep current ({lead.status})</option>
              {LEAD_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Next follow-up" hint="Optional — creates a reminder for the assignee.">
            <input
              className="input"
              type="datetime-local"
              value={nextAt}
              onChange={(e) => setNextAt(toLocalInput(e.target.value))}
            />
          </Field>
          {nextAt ? (
            <Field label="Follow-up note">
              <input className="input" value={followNote} onChange={(e) => setFollowNote(e.target.value)} />
            </Field>
          ) : null}
        </form>
      </Modal>
    </div>
  )
}
