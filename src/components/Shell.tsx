import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/auth'
import { Icon } from './Icons'
import { initials } from '../lib/format'

interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
}

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/admin/leads', label: 'Leads', icon: 'leads' },
  { to: '/admin/employees', label: 'Team', icon: 'users' },
  { to: '/admin/calls', label: 'Call history', icon: 'phone' },
  { to: '/admin/follow-ups', label: 'Follow-ups', icon: 'clock' },
  { to: '/admin/attendance', label: 'Attendance', icon: 'calendar' },
]

const EMPLOYEE_NAV: NavItem[] = [
  { to: '/employee', label: 'My day', icon: 'dashboard', end: true },
  { to: '/employee/leads', label: 'My leads', icon: 'leads' },
  { to: '/employee/follow-ups', label: 'Follow-ups', icon: 'clock' },
  { to: '/employee/attendance', label: 'Attendance', icon: 'calendar' },
]

export function Shell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [busy, setBusy] = useState(false)

  const nav = profile?.role === 'admin' ? ADMIN_NAV : EMPLOYEE_NAV

  useEffect(() => {
    setDrawer(false)
  }, [location.pathname])

  const handleSignOut = async () => {
    setBusy(true)
    await signOut()
    setBusy(false)
    navigate('/login', { replace: true })
  }

  return (
    <div className={`shell${drawer ? ' shell-drawer-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark">CP</span>
          <span className="brand-text">
            CALLPRO
            <small>{profile?.role === 'admin' ? 'Admin console' : 'Agent workspace'}</small>
          </span>
          <button
            type="button"
            className="icon-btn sidebar-close"
            onClick={() => setDrawer(false)}
            aria-label="Close menu"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar">{initials(profile?.full_name || profile?.email)}</span>
            <span className="user-meta">
              <strong>{profile?.full_name || 'Account'}</strong>
              <small>{profile?.role === 'admin' ? 'Administrator' : 'Employee'}</small>
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={handleSignOut} disabled={busy}>
            <Icon name="logout" size={16} />
            <span>{busy ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      </aside>

      <button
        type="button"
        className="drawer-scrim"
        aria-label="Close navigation"
        tabIndex={-1}
        onClick={() => setDrawer(false)}
      />

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Icon name="menu" size={20} />
          </button>
          <span className="topbar-brand">CALLPRO CRM</span>
          <span className="topbar-spacer" />
          <span className="topbar-user">
            {profile?.full_name || profile?.email}
            <span className="topbar-role">{profile?.role === 'admin' ? 'Admin' : 'Employee'}</span>
          </span>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
