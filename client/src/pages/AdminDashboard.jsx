// Administrator page with three tabs:
//   Dashboard          US-10: resolution time, workload, deadline breaches, ratings, with filters (M9)
//   Service complaints US-11: the mess and canteen complaints routed to the Administrator (M8)
//   Deadline check     DEMO ONLY: runs the timer's check now (M6 endpoint, M8 button)
import { lazy, Suspense, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useLoad } from '../hooks.js';
import ComplaintList from '../components/ComplaintList.jsx';
import { Message } from '../components/Badges.jsx';
import { FINISHED, formatDateTime } from '../format.js';

// The charts library is large and only administrators need it, so the dashboard is loaded on demand.
const Dashboard = lazy(() => import('../components/Dashboard.jsx'));

const TABS = [['dashboard', 'Dashboard'], ['service', 'Service complaints'], ['check', 'Deadline check']];

export default function AdminDashboard() {
  const [tab, setTab] = useState('dashboard');
  return (
    <>
      <h1>Administration</h1>
      <div className="tabs" role="tablist" aria-label="Administration">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'tab active' : 'tab'} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === 'dashboard' && <Suspense fallback={<p className="muted">Loading dashboard…</p>}><Dashboard /></Suspense>}
      {tab === 'service' && <ServiceComplaints />}
      {tab === 'check' && <DeadlineCheck />}
    </>
  );
}

function ServiceComplaints() {
  const location = useLocation();
  const { data, error, loading } = useLoad(() => api.get('/complaints'), [location.key]);
  const service = (data?.complaints ?? []).filter((c) => c.category.type === 'SERVICE');
  const active = service.filter((c) => !FINISHED.includes(c.status));
  const finished = service.filter((c) => FINISHED.includes(c.status));

  return (
    <>
      <section className="card">
        <h2>Service complaints (mess and canteen)</h2>
        <p className="muted">These come to you, not to maintenance staff. Open one to take it, work on it and resolve it.</p>
        <Message>{error?.message}</Message>
        {loading && !data && <p className="muted">Loading…</p>}
        {data && <ComplaintList complaints={active} showReporter showAssignee empty="No open service complaints." />}
      </section>
      {finished.length > 0 && (
        <section className="card">
          <h2>Finished service complaints</h2>
          <ComplaintList complaints={finished} showReporter showAssignee />
        </section>
      )}
    </>
  );
}

// DEMO ONLY: POST /api/admin/run-deadline-check runs the same check the timer runs, right now,
// and shows what it did (escalations, repeat escalations, auto-closes).
function DeadlineCheck() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError('');
    try {
      setResult(await api.post('/admin/run-deadline-check'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const sections = result && [
    ['Escalated (level 1, supervisor notified)', result.escalated, (c) => `level ${c.level}`],
    ['Escalated again (administrator notified)', result.reescalated, (c) => `now level ${c.level}`],
    ['Auto-closed (no answer for 48 hours)', result.autoClosed, () => 'closed'],
  ];
  const nothing = result && sections.every(([, list]) => list.length === 0);

  return (
    <section className="card">
      <h2>Deadline check</h2>
      <p className="muted">The server does this automatically on a timer. Use the button to run it now.</p>
      <button type="button" className="primary" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run deadline check'}</button>
      <Message>{error}</Message>
      {result && (
        <div className="check-result" aria-live="polite">
          <p className="muted small">Checked at {formatDateTime(result.checkedAt)}</p>
          {nothing && <p>Nothing to do: no complaint is overdue and nothing is waiting to be closed.</p>}
          {sections.map(([title, list, detail]) => list.length > 0 && (
            <div key={title}>
              <h3>{title}</h3>
              <ul className="plain">
                {list.map((c) => <li key={c.complaintId}><Link to={`/complaints/${c.complaintId}`}>#{c.complaintId} {c.title}</Link> <span className="muted">— {detail(c)}</span></li>)}
              </ul>
            </div>
          ))}
          {result.failed.length > 0 && <Message>{`${result.failed.length} complaint(s) could not be processed.`}</Message>}
        </div>
      )}
    </section>
  );
}
