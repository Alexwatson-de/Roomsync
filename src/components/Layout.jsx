import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { ThemeToggle } from '../context/ThemeContext.jsx';
import { usingEmulators } from '../firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { logout } from '../services/auth.js';
import { Avatar } from './ui.jsx';
import CloudDataBoundary from './CloudDataBoundary.jsx';
import QuickAdd from './QuickAdd.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/expenses', label: 'Expenses', icon: '₹' },
  { to: '/balances', label: 'Balances', icon: '⇄' },
  { to: '/bills', label: 'Bills', icon: '◫' },
  { to: '/chores', label: 'Chores', icon: '✓' },
  { to: '/groceries', label: 'Groceries', icon: '▤' },
  { to: '/activity', label: 'Activity', icon: '≡' },
  { to: '/reports', label: 'Reports', icon: '◔' },
  { to: '/members', label: 'Members', icon: '◉' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

const MOBILE_NAV = NAV.filter((n) =>
  ['/', '/expenses', '/balances', '/chores', '/groceries'].includes(n.to)
);

export default function Layout({ children }) {
  const { user, profile } = useAuth();
  const { memberships, activeId, switchHousehold, household, unreadCount } = useHousehold();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileMenu, setMobileMenu] = useState(false);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot">R</span> RoomSync
        </div>

        {memberships && memberships.length > 1 && (
          <div className="field" style={{ marginBottom: '0.5rem' }}>
            <label>Household</label>
            <select value={activeId || ''} onChange={(e) => switchHousehold(e.target.value)}>
              {memberships.map((m) => (
                <option key={m.householdId} value={m.householdId}>
                  {m.householdId === activeId && household ? household.name : m.householdName || m.householdId.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        )}

        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span aria-hidden>{n.icon}</span> {n.label}
          </NavLink>
        ))}
        <NavLink to="/notifications" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <span aria-hidden>◎</span> Notifications
          {unreadCount > 0 && <span className="badge badge-red">{unreadCount}</span>}
        </NavLink>

        <div style={{ marginTop: 'auto', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <div className="member-chip" style={{ padding: '0.3rem 0.5rem' }}>
            <Avatar uid={user?.uid} name={profile?.displayName || user?.displayName || user?.email} profile={profile} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.displayName || user?.displayName || user?.email}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: 0 }}
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="app-toolbar">
          <span className="eyebrow">Your home, in sync</span>
          <div className="toolbar-controls">
            <QuickAdd key={`${activeId}:${user?.uid}`} />
            <span className="connection-pill"><span className="connection-dot" />{usingEmulators ? 'Test emulator' : 'Firebase workspace'}</span>
            <ThemeToggle />
          </div>
        </div>
        {mobileMenu && <div className="card" style={{ marginBottom: '1rem' }}>
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className="nav-link" onClick={() => setMobileMenu(false)}>{n.label}</NavLink>)}
          <NavLink to="/onboarding" className="nav-link" onClick={() => setMobileMenu(false)}>Create / join household</NavLink>
          {memberships?.length > 1 && <div className="field"><label>Switch household</label><select value={activeId || ''} onChange={(e) => { switchHousehold(e.target.value); setMobileMenu(false); }}>
            {memberships.map((m) => <option key={m.householdId} value={m.householdId}>{m.householdName}</option>)}
          </select></div>}
          <button className="btn btn-secondary" onClick={async () => { await logout(); navigate('/login'); }}>Sign out</button>
        </div>}
        <div key={`${activeId}:${pathname}`} className="page-content"><CloudDataBoundary>{children}</CloudDataBoundary></div>
      </main>

      <nav className="mobile-nav">
        {MOBILE_NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span aria-hidden>{n.icon}</span> {n.label}
          </NavLink>
        ))}
        <NavLink to="/notifications" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <span aria-hidden>◎</span> Alerts{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </NavLink>
        <button type="button" className="nav-link" style={{ border: 0, background: 'transparent', cursor: 'pointer' }} onClick={() => setMobileMenu((open) => !open)} aria-expanded={mobileMenu}>
          <span aria-hidden>☰</span> More
        </button>
      </nav>
    </div>
  );
}
