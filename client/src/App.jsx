// Routes. Each role has its own portal (the four boxes of the architecture diagram); the complaint
// details page is shared. Everything except /login needs a login.
import { Navigate, Route, Routes } from 'react-router-dom';
import { HOME, RequireRole, useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import ComplaintDetailsPage from './components/ComplaintDetailsPage.jsx';
import Login from './pages/Login.jsx';
import CampusUserPortal, { ReportFault } from './pages/CampusUserPortal.jsx';
import StaffPortal from './pages/StaffPortal.jsx';
import SupervisorConsole from './pages/SupervisorConsole.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';

const CAMPUS = ['STUDENT', 'FACULTY'];

// "/" sends you to your own portal, or to the login page.
function Home() {
  const { user, checking } = useAuth();
  if (checking) return <p className="muted center">Loading…</p>;
  return <Navigate to={user ? HOME[user.role] : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Home />} />
      <Route element={<RequireRole><Layout /></RequireRole>}>
        <Route path="/portal" element={<RequireRole roles={CAMPUS}><CampusUserPortal /></RequireRole>} />
        <Route path="/portal/new" element={<RequireRole roles={CAMPUS}><ReportFault /></RequireRole>} />
        <Route path="/staff" element={<RequireRole roles={['STAFF']}><StaffPortal /></RequireRole>} />
        <Route path="/supervisor" element={<RequireRole roles={['SUPERVISOR']}><SupervisorConsole /></RequireRole>} />
        <Route path="/admin" element={<RequireRole roles={['ADMIN']}><AdminDashboard /></RequireRole>} />
        <Route path="/complaints/:id" element={<ComplaintDetailsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
