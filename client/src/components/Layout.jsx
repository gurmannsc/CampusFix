// Page frame for every logged-in page: header with the role's navigation, the bell, and logout.
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import NotificationBell from './NotificationBell.jsx';

const NAV = {
  STUDENT: [['/portal', 'My complaints'], ['/portal/new', 'Report a fault']],
  FACULTY: [['/portal', 'My complaints'], ['/portal/new', 'Report a fault']],
  STAFF: [['/staff', 'My assignments']],
  SUPERVISOR: [['/supervisor', 'Complaints']],
  ADMIN: [['/admin', 'Administration']],
};
const ROLE_NAME = { STUDENT: 'Student', FACULTY: 'Faculty', STAFF: 'Maintenance staff', SUPERVISOR: 'Supervisor', ADMIN: 'Administrator' };

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <header className="topbar">
        <span className="brand">CampusFix</span>
        <nav aria-label="Main">
          {NAV[user.role].map(([to, label]) => (
            <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
          ))}
        </nav>
        <span className="spacer" />
        <NotificationBell />
        <span className="who"><strong>{user.name}</strong><span className="muted small"> {ROLE_NAME[user.role]}</span></span>
        <button type="button" className="link" onClick={() => { logout(); navigate('/login'); }}>Log out</button>
      </header>
      <main className="page"><Outlet /></main>
    </>
  );
}
