import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { HOME, useAuth } from '../auth.jsx';
import { Message } from '../components/Badges.jsx';

// The seeded accounts (password demo123, see README). Shown so the demo can switch users quickly.
const DEMO_ACCOUNTS = [
  ['student1', 'Student'], ['faculty1', 'Faculty'], ['hvac1', 'HVAC staff'], ['hvac2', 'HVAC staff'],
  ['supervisor1', 'Supervisor'], ['admin1', 'Administrator'],
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={HOME[user.role]} replace />;

  async function submit(e, credentials = { email, password }) {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const loggedIn = await login(credentials.email.trim(), credentials.password);
      navigate(location.state?.from ?? HOME[loggedIn.role], { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <h1>CampusFix</h1>
      <p className="muted">Report and track campus faults at NMIMS Indore.</p>
      <form onSubmit={submit} className="card">
        <label>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <Message>{error}</Message>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>

      <details className="card demo-accounts">
        <summary>Demo accounts (password <code>demo123</code>)</summary>
        <div className="chips">
          {DEMO_ACCOUNTS.map(([name, label]) => (
            <button key={name} type="button" disabled={busy} onClick={() => submit(null, { email: `${name}@nmims.edu`, password: 'demo123' })}>
              {name} <span className="muted small">{label}</span>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
