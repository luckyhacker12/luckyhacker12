import { Icon } from './Icons'

/**
 * Shown when the API is up but the server has no Supabase credentials, so no
 * real sign-in is possible. It never fakes a session — it explains exactly
 * which environment variables are missing.
 */
export function ConfigNotice({ message }: { message?: string }) {
  return (
    <div className="boot">
      <div className="card config-card">
        <span className="brand-mark brand-mark-lg">CP</span>
        <h1 className="page-title">Connect Supabase to finish setup</h1>
        <p className="page-sub">
          The CALLPRO server is running, but it has no Supabase project configured yet, so sign-in
          and data access are disabled (no demo logins are used).
        </p>
        {message ? (
          <div className="note note-error" role="alert">
            <Icon name="alert" size={16} />
            <span>{message}</span>
          </div>
        ) : null}
        <ol className="config-steps">
          <li>
            Create a Supabase project, then copy the project URL, the <code>anon</code> key and the
            <code> service_role</code> key from Project Settings → API.
          </li>
          <li>
            Set these server environment variables: <code>SUPABASE_URL</code>,{' '}
            <code>SUPABASE_ANON_KEY</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>.
          </li>
          <li>
            Apply <code>supabase/migrations/001_schema.sql</code>, then <code>002_rls.sql</code>,
            then <code>003_functions.sql</code> in the SQL editor.
          </li>
          <li>
            Create your first administrator with <code>npm run bootstrap:admin</code> (see{' '}
            <code>README-CALLPRO.md</code>).
          </li>
        </ol>
        <p className="muted small">
          This screen appears until the server reports valid Supabase configuration.
        </p>
      </div>
    </div>
  )
}
