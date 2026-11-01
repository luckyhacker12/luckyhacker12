import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'
import { Button, ErrorNote, Field } from '../components/ui'
import { Icon } from '../components/Icons'
import type { Role } from '../lib/types'

const TABS: { role: Role; label: string; blurb: string; icon: string }[] = [
  {
    role: 'admin',
    label: 'Administrator',
    blurb: 'Full pipeline, team management, imports and reporting.',
    icon: 'building',
  },
  {
    role: 'employee',
    label: 'Employee',
    blurb: 'Your assigned leads, calls, follow-ups and attendance.',
    icon: 'phone',
  },
]

export function LoginPage() {
  const { signIn, profile, config, configError } = useAuth()
  const navigate = useNavigate()
  const [portal, setPortal] = useState<Role>('employee')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (profile) {
    return <Navigate to={profile.role === 'admin' ? '/admin' : '/employee'} replace />
  }

  const active = TABS.find((t) => t.role === portal)!

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const next = await signIn(email, password, portal)
      navigate(next.role === 'admin' ? '/admin' : '/employee', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="auth-brand">
          <span className="brand-mark brand-mark-lg">CP</span>
          <div>
            <h1>CALLPRO</h1>
            <p>Calling-center CRM</p>
          </div>
        </div>
        <p className="auth-pitch">
          One workspace for your leads, call notes, follow-up reminders and attendance — built for a team of
          seven to eight callers.
        </p>
        <ul className="auth-points">
          <li>
            <Icon name="check" size={16} /> Role-based access enforced in the database
          </li>
          <li>
            <Icon name="check" size={16} /> Eight-stage lead pipeline with follow-up reminders
          </li>
          <li>
            <Icon name="check" size={16} /> CSV import and export, searchable call history
          </li>
        </ul>
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <div className="tabs" role="tablist" aria-label="Choose sign-in type">
            {TABS.map((tab) => (
              <button
                key={tab.role}
                type="button"
                role="tab"
                aria-selected={portal === tab.role}
                className={`tab${portal === tab.role ? ' tab-active' : ''}`}
                onClick={() => {
                  setPortal(tab.role)
                  setError(null)
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <p className="auth-blurb">{active.blurb}</p>

          {config && !config.configured ? (
            <ErrorNote>
              Supabase is not configured on the server yet. Add SUPABASE_URL, SUPABASE_ANON_KEY and
              SUPABASE_SERVICE_ROLE_KEY to the environment, then run the SQL migrations.
            </ErrorNote>
          ) : null}
          {configError ? <ErrorNote>{configError}</ErrorNote> : null}

          <form onSubmit={submit} className="auth-form">
            <Field label="Work email">
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="input"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
              />
            </Field>

            {error ? <ErrorNote>{error}</ErrorNote> : null}

            <Button type="submit" block loading={busy} disabled={!config?.configured}>
              Sign in as {active.label.toLowerCase()}
            </Button>
          </form>

          <p className="auth-foot">
            Accounts are created by an administrator. There is no self sign-up — a new account never gets a
            role it was not granted.
          </p>
        </div>
      </div>
    </div>
  )
}
