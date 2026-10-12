// Portal for maintenance staff: the complaints assigned to me (US-07). Open one to start work,
// put it on hold, resume or mark it resolved.
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useLoad } from '../hooks.js';
import ComplaintList from '../components/ComplaintList.jsx';
import { Message } from '../components/Badges.jsx';
import { FINISHED } from '../format.js';

export default function StaffPortal() {
  const location = useLocation();
  const { data, error, loading } = useLoad(() => api.get('/complaints'), [location.key]);
  const complaints = data?.complaints ?? [];
  // statuses where the staff member has something to do
  const todo = complaints.filter((c) => ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(c.status));
  const other = complaints.filter((c) => !['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(c.status) && !FINISHED.includes(c.status));
  const done = complaints.filter((c) => FINISHED.includes(c.status));

  return (
    <>
      <h1>My assignments</h1>
      <Message>{error?.message}</Message>
      {loading && !data && <p className="muted">Loading…</p>}
      {data && (
        <>
          <section className="card attention">
            <h2>To do</h2>
            <ComplaintList complaints={todo} showReporter empty="Nothing assigned to you right now." />
          </section>
          {other.length > 0 && (
            <section className="card">
              <h2>Waiting on someone else</h2>
              <p className="muted">Resolved and waiting for the reporter, or escalated and with the supervisor.</p>
              <ComplaintList complaints={other} showReporter />
            </section>
          )}
          <section className="card">
            <h2>Finished</h2>
            <ComplaintList complaints={done} showReporter empty="Nothing finished yet." />
          </section>
        </>
      )}
    </>
  );
}
