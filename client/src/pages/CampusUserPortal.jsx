// Portal for students and faculty: report a fault, and follow your own complaints (US-01, US-03).
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useLoad } from '../hooks.js';
import ComplaintForm from '../components/ComplaintForm.jsx';
import ComplaintList from '../components/ComplaintList.jsx';
import { Message } from '../components/Badges.jsx';
import { FINISHED } from '../format.js';

export function ReportFault() {
  return <ComplaintForm />;
}

export default function CampusUserPortal() {
  const location = useLocation();
  const { data, error, loading } = useLoad(() => api.get('/complaints'), [location.key]);
  const complaints = data?.complaints ?? [];
  const waiting = complaints.filter((c) => c.status === 'RESOLVED');
  const open = complaints.filter((c) => !FINISHED.includes(c.status) && c.status !== 'RESOLVED');
  const done = complaints.filter((c) => FINISHED.includes(c.status));

  return (
    <>
      <div className="page-head">
        <h1>My complaints</h1>
        <Link to="/portal/new" className="button primary">Report a fault</Link>
      </div>
      <Message>{error?.message}</Message>
      {loading && !data && <p className="muted">Loading…</p>}

      {waiting.length > 0 && (
        <section className="card attention">
          <h2>Waiting for your answer</h2>
          <p className="muted">The work is done. Please confirm that the problem is fixed, or tell us it is not.</p>
          <ComplaintList complaints={waiting} />
        </section>
      )}

      {data && (
        <>
          <section className="card">
            <h2>In progress</h2>
            <ComplaintList complaints={open} empty="You have no open complaints." />
          </section>
          <section className="card">
            <h2>Closed</h2>
            <ComplaintList complaints={done} empty="Nothing closed yet." />
          </section>
        </>
      )}
    </>
  );
}
