import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './state/auth'
import { Shell } from './components/Shell'
import { Loading } from './components/ui'
import { LoginPage } from './pages/Login'
import { AdminDashboardPage } from './pages/admin/Dashboard'
import { AdminLeadsPage } from './pages/admin/Leads'
import { EmployeesPage } from './pages/admin/Employees'
import { CallHistoryPage } from './pages/admin/Calls'
import { AdminAttendancePage } from './pages/admin/Attendance'
import { EmployeeHomePage } from './pages/employee/Home'
import { MyLeadsPage } from './pages/employee/MyLeads'
import { MyAttendancePage } from './pages/employee/Attendance'
import { FollowUpsPage } from './pages/shared/FollowUps'
import { LeadDetailPage } from './pages/shared/LeadDetail'
import { ConfigNotice } from './components/ConfigNotice'

/** Full-screen state used while the session/profile is being resolved. */
function Booting() {
  return (
    <div className="boot">
      <div className="brand-mark brand-mark-lg">CP</div>
      <Loading label="Starting CALLPRO…" />
    </div>
  )
}

function LoginRoute() {
  const { booting, profile } = useAuth()
  if (booting) return <Booting />
  if (profile) return <Navigate to={profile.role === 'admin' ? '/admin' : '/employee'} replace />
  return <LoginPage />
}

/**
 * Guards the authenticated area. The role check here is a convenience only —
 * every API call is authorised again on the server, and Postgres RLS is the
 * final authority on which rows a user may read or write.
 */
function Protected({ role }: { role?: 'admin' | 'employee' }) {
  const { booting, profile, config, configError } = useAuth()
  const location = useLocation()

  if (booting) return <Booting />
  if (!profile) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (role && profile.role !== role) {
    return <Navigate to={profile.role === 'admin' ? '/admin' : '/employee'} replace />
  }
  if (configError && !config) {
    // The API is reachable but has no Supabase credentials yet: show guidance
    // instead of an endless spinner.
    return <ConfigNotice message={configError} />
  }

  return <Shell />
}

export default function App() {
  const { profile, booting } = useAuth()
  const home = !booting && profile ? (profile.role === 'admin' ? '/admin' : '/employee') : '/login'

  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />

      {/* Admin */}
      <Route element={<Protected role="admin" />}>
        <Route path="/admin" element={<AdminDashboardPage />} />
        <Route path="/admin/leads" element={<AdminLeadsPage />} />
        <Route path="/admin/leads/:id" element={<LeadDetailPage />} />
        <Route path="/admin/employees" element={<EmployeesPage />} />
        <Route path="/admin/calls" element={<CallHistoryPage />} />
        <Route path="/admin/follow-ups" element={<FollowUpsPage />} />
        <Route path="/admin/attendance" element={<AdminAttendancePage />} />
      </Route>

      {/* Employee */}
      <Route element={<Protected role="employee" />}>
        <Route path="/employee" element={<EmployeeHomePage />} />
        <Route path="/employee/leads" element={<MyLeadsPage />} />
        <Route path="/employee/leads/:id" element={<LeadDetailPage />} />
        <Route path="/employee/follow-ups" element={<FollowUpsPage />} />
        <Route path="/employee/attendance" element={<MyAttendancePage />} />
      </Route>

      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="*" element={<NotFound home={home} />} />
    </Routes>
  )
}

function NotFound({ home }: { home: string }) {
  return (
    <div className="boot">
      <h1 className="page-title">Page not found</h1>
      <p className="muted">The page you were looking for does not exist.</p>
      <a className="btn btn-primary" href={home}>
        Back to dashboard
      </a>
    </div>
  )
}
