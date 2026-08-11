import { Activity, Database, FileUp, Search, Settings, BarChart3, LogOut, Menu, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAppState } from '../state/AppState';

const navigation = [
  { to: '/', label: 'Search', icon: Search, permission: 'asset.view' },
  { to: '/inventory', label: 'Inventory', icon: Database, permission: 'asset.view' },
  { to: '/import', label: 'Import', icon: FileUp, permission: 'import.execute' },
  { to: '/reports', label: 'Reports', icon: BarChart3, permission: 'report.view' },
  { to: '/activity', label: 'Activity', icon: Activity, permission: 'activity.view' },
  { to: '/admin', label: 'Admin', icon: Settings, permission: 'admin.system' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { session, logout } = useAppState();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!session) return null;
  const visible = navigation.filter((item) => session.permissions[item.permission]);
  const goHome = () => { setMenuOpen(false); navigate('/'); };
  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={goHome} aria-label="Inventory Project home">
        <img src="/brand/nvidia-logo.png" alt="NVIDIA"/>
        <span><strong>Inventory Project</strong><small>Production</small></span>
      </button>
      <button className="mobile-menu" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="Toggle navigation">{menuOpen ? <X/> : <Menu/>}</button>
      <nav className={menuOpen ? 'topnav topnav--open' : 'topnav'} aria-label="Primary navigation">
        {visible.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMenuOpen(false)} className={({ isActive }) => isActive ? 'topnav__link topnav__link--active' : 'topnav__link'}><Icon size={17}/><span>{label}</span></NavLink>)}
      </nav>
      <div className="identity">
        <span className="identity__avatar">{session.user.initials}</span>
        <span className="identity__text"><strong>{session.user.displayName}</strong><small>{session.user.roles.map((role) => role.replaceAll('_', ' ')).join(' / ')}</small></span>
        <button className="icon-button" onClick={() => logout()} title="Sign out" aria-label="Sign out"><LogOut size={18}/></button>
      </div>
    </header>
    <main className="page-frame">{children}</main>
  </div>;
}
