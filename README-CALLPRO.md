# CALLPRO CRM — Setup & Operations

A calling-center CRM for a 7–8 person team. React + Vite front end, Express API,
Supabase (Postgres + Auth) as the database and identity provider.

> The repository's own `README.md` is a personal GitHub profile README and is
> intentionally left untouched. This file is the project documentation.

---

## 1. What you get

| Area | Details |
| --- | --- |
| Login | Two separate entry points: `/admin/login` and `/employee/login`. Both use real Supabase Auth (email + password). The role comes from `public.profiles`, never from the URL or the UI. |
| Admin | Dashboard (total leads, employees, calls, follow-ups, today's calls, pending follow-ups), employee management (create, edit, deactivate, reset password), lead CRUD, lead assignment (single + bulk), all call logs, follow-up queue, attendance for the whole team, CSV import/export. |
| Employee | My Leads (only rows assigned to them), lead detail with call logging, follow-up list, own attendance, own call history. CSV export of their own leads. |
| Lead statuses | New, Not Answered, Interested, Not Interested, Callback, Follow-up, Converted, Invalid. |
| Call logging | Outcome, note, duration, optional follow-up date. Stored in `call_logs`; the lead's `last_contacted_at` is updated. |
| Follow-ups | Pending / done / missed, with due dates and per-employee views. |
| Attendance | Present / absent / half-day / leave, one row per employee per day. |
| Responsive | Sidebar collapses to a bottom/top bar on mobile; tables become cards. Verified at 390 px and 1440 px. |

## 2. Environment variables

Only the **server** reads configuration. The browser gets the public URL and anon
key from `GET /api/config` at runtime, so credentials can be added to a running
deployment without rebuilding, and no key is baked into the built assets.

| Variable | Where | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | server only | e.g. `https://abcdefghijklm.supabase.co` |
| `SUPABASE_ANON_KEY` | server only | Public "anon"/publishable key. RLS protects the data. |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only, secret** | Used only for `auth.admin.createUser`, password reset and user deletion. Never sent to the browser, never prefixed `VITE_`, never committed. |
| `PORT` | server | Default `3000`. Must match the deployment port. |

Copy `.env.example` to `.env` and fill it in. `.env` is git-ignored.

If the variables are absent the app still boots and renders a clear
"not configured" screen instead of pretending to work.

## 3. Database setup (order matters)

Run these in the Supabase SQL editor, or with `supabase db push`:

1. `supabase/migrations/001_schema.sql` — enums, tables (`profiles`, `leads`,
   `call_logs`, `follow_ups`, `attendance`), indexes, and the `auth.users`
   trigger that creates a profile (always `role = 'employee'`).
2. `supabase/migrations/002_rls.sql` — Row Level Security. Every table is
   default-deny; policies grant admins full access and employees only their own
   assigned leads, their own calls, their own follow-ups and their own
   attendance. Helper functions are `security definer` with a pinned
   `search_path`. Triggers block role escalation and prevent an employee from
   reassigning a lead to somebody else.
3. `supabase/migrations/003_functions.sql` — dashboard aggregates and
   assignment helpers used by the API.

Re-running the files is safe: they are written with `create ... if not exists`
and `drop policy if exists` guards.

### Verifying RLS without a Supabase project (optional)

`npm run test:rls` runs the three migrations against a throwaway local
PostgreSQL database (`supabase/tests/00_local_shim.sql` provides the minimal
`auth.*` objects), loads synthetic fixtures, and executes 64 assertions
covering admin/employee visibility, lead scoping, escalation guards and the
dashboard aggregates. Any failed assertion aborts with a non-zero exit code.
It needs `psql` and a role that may `CREATE DATABASE`; connection settings come
from the standard `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` variables. This checks
the SQL and policies only — it does not validate Supabase Auth JWTs, so the
authenticated flows still need a real project.

### Supabase Auth settings

* **Email provider:** enabled, "Confirm email" may stay on (the admin-created
  employees are created pre-confirmed by the service role).
* **Public sign-up:** recommended **off**. Employees are provisioned by an
  admin, so nobody should be able to create their own account.
* **Site URL / redirect URLs:** add the deployed origin (and
  `http://localhost:3000` for local development) so password-reset emails work.

## 4. First administrator (bootstrap)

Sign-up always creates an `employee`, so the first admin is seeded once:

```bash
npm run bootstrap:admin -- --email owner@example.com --name "Owner" --password 'choose-a-strong-password'
```

or with `ADMIN_EMAIL` / `ADMIN_PASSWORD` in the environment. The script:

* validates the email and requires an explicit password (it never invents or
  stores one),
* creates the auth user (or reuses it if the email already exists) with the
  email pre-confirmed,
* upserts `public.profiles` with `role = 'admin'`, `active = true`,
* reads the row back and fails loudly if it is not an active admin.

Sign in at `/admin/login` afterwards. Every other account is created from
**Admin → Employees**.

## 5. Local development

```bash
npm install
cp .env.example .env      # then fill in the Supabase values
npm run dev               # Express API + Vite dev server
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | API (`node --watch server/index.mjs`) + Vite with proxy |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | typecheck + production build into `dist/` |
| `npm test` | Node test runner: CSV round-trip and role-guard suites, no network needed |
| `npm start` | Serve the built app + API on `PORT` |
| `npm run bootstrap:admin` | Seed/promote the first administrator |

## 6. Security model (short version)

* Authorisation is decided by Postgres RLS **and** re-checked in the Express
  layer — never by hiding buttons. Even a hand-crafted `fetch` to the API with
  a valid employee token cannot read another employee's leads.
* The API verifies the Supabase JWT, then re-reads `public.profiles` for the
  role on every request. A tampered token payload cannot promote anybody.
* All data queries run through a per-request Supabase client carrying the
  user's own JWT, so RLS applies to every statement; the service-role client is
  only used for admin-only identity operations.
* Employees cannot change `assigned_to`, cannot promote themselves, cannot see
  other employees' call logs, and cannot read the employee roster beyond their
  own profile — enforced by policies, with triggers as a second line of defence.

## 7. CSV import / export

* **Export** (admin: any filtered list; employee: their own leads) streams a CSV
  with a header row; fields are RFC4180-quoted, so commas, quotes and newlines
  round-trip.
* **Import** (admin only) accepts `name` + `phone` at minimum. Headers are
  normalised (`Phone Number`, `phone-number`, `phone_number` all work) with
  aliases for email, company, city, source, status, notes and assignee.
  Rows with a missing name/phone, an unparseable status or a duplicate phone
  are skipped and reported back with their line number — nothing is imported
  silently or partially.

## 8. Deploying

1. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in the
   hosting environment (secrets, server-side only).
2. Expose port `3000` (the server binds `0.0.0.0`).
3. `npm run build` runs as part of the image build; `npm start` serves the SPA
   and `/api/*`.
4. After the first deploy, run the migrations and
   `npm run bootstrap:admin` once against that Supabase project.

No deployment has been performed for this build — per instruction the app is
code-complete and waiting for Supabase credentials.
