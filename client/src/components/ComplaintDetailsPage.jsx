// ComplaintDetailsPage: one complaint with its full history. Which buttons appear depends on who is
// looking (reporter, assignee, handler) and on the complaint's status; the server checks the same
// rules again, so a button that slips through just shows the server's message.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLoad } from '../hooks.js';
import { dueText, formatDateTime, formatLocation, FINISHED } from '../format.js';
import { Message, PriorityBadge, StatusBadge } from './Badges.jsx';
import StatusTimeline from './StatusTimeline.jsx';
import { HandlerActions, ReporterActions, WorkerActions } from './ComplaintActions.jsx';

export default function ComplaintDetailsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.get(`/complaints/${id}`), [id]);
  const [notice, setNotice] = useState({ kind: 'success', text: '' });
  const complaint = data?.complaint;

  // Runs an action on the server, then shows the result and reloads the complaint.
  // action(): a promise from api.post / api.patch.
  async function run(action, successText) {
    setNotice({ kind: 'success', text: '' });
    try {
      await action();
      setNotice({ kind: 'success', text: successText });
      reload();
      return true;
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
      return false;
    }
  }

  // sd Confirm Resolution: respond(complaintId, isFixed, rating, comment) -> ResolutionController.submitResponse
  function respond(complaintId, isFixed, rating, comment) {
    return run(
      () => (isFixed ? api.post(`/complaints/${complaintId}/confirm`, { rating, comment }) : api.post(`/complaints/${complaintId}/reject`, { reason: comment })),
      isFixed ? 'Thank you. The complaint is now closed.' : 'The complaint was reopened and the supervisor has been told.',
    );
  }

  if (loading && !complaint) return <p className="muted center">Loading…</p>;
  if (error) {
    return (
      <>
        <Message>{error.status === 403 ? 'You are not allowed to view this complaint.' : error.status === 404 ? 'This complaint does not exist.' : error.message}</Message>
        <p><button type="button" className="link" onClick={() => window.history.back()}>← Back</button></p>
      </>
    );
  }

  const isReporter = complaint.reporter.userId === user.userId;
  const isAssignee = complaint.assignee?.userId === user.userId;
  const handlerRole = complaint.category.type === 'SERVICE' ? 'ADMIN' : 'SUPERVISOR';
  const isHandler = user.role === handlerRole;
  const finished = FINISHED.includes(complaint.status);

  return (
    <article className="details">
      <p><button type="button" className="link" onClick={() => window.history.back()}>← Back</button></p>
      <header className="details-head">
        <div>
          <h1>#{complaint.complaintId} {complaint.title}</h1>
          <div className="badges"><StatusBadge status={complaint.status} /><PriorityBadge priority={complaint.priority} />
            {complaint.overdue && <span className="badge overdue">Overdue</span>}
            {complaint.escalationLevel > 0 && complaint.status === 'ESCALATED' && <span className="badge status-ESCALATED">Escalation level {complaint.escalationLevel}</span>}
            {complaint.reopenCount > 0 && <span className="badge">Reopened {complaint.reopenCount}×</span>}
          </div>
        </div>
      </header>

      <Message kind={notice.kind}>{notice.text}</Message>

      <div className="grid">
        <section className="card">
          <h2>Details</h2>
          <dl className="facts">
            <dt>Category</dt><dd>{complaint.category.name}{complaint.category.type === 'SERVICE' && ' (service, handled by the Administrator)'}</dd>
            <dt>Location</dt><dd>{formatLocation(complaint.location)}</dd>
            <dt>Reported by</dt><dd>{complaint.reporter.name}</dd>
            <dt>Reported</dt><dd>{formatDateTime(complaint.createdAt)}</dd>
            <dt>Due</dt><dd>{formatDateTime(complaint.dueAt)}{!finished && complaint.status !== 'RESOLVED' && <span className={complaint.overdue ? 'late' : 'muted'}> ({dueText(complaint.dueAt)})</span>}</dd>
            <dt>Assigned to</dt><dd>{complaint.assignee?.name ?? <span className="muted">not assigned yet</span>}</dd>
            {complaint.supervisor && (<><dt>Supervisor</dt><dd>{complaint.supervisor.name}</dd></>)}
            {complaint.resolvedAt && (<><dt>Resolved</dt><dd>{formatDateTime(complaint.resolvedAt)}</dd></>)}
            {complaint.closedAt && (<><dt>Closed</dt><dd>{formatDateTime(complaint.closedAt)}</dd></>)}
          </dl>
          <h3>Description</h3>
          <p className="prewrap">{complaint.description}</p>
          {complaint.photoUrl && <Photo complaintId={complaint.complaintId} />}
        </section>

        <section className="card">
          <h2>Status history</h2>
          <StatusTimeline statusHistory={complaint.statusHistory} escalations={complaint.escalations} />
          {complaint.feedback.length > 0 && (
            <>
              <h3>Feedback</h3>
              <ul className="plain">
                {complaint.feedback.map((f) => (
                  <li key={f.feedbackId}>
                    {f.isFixed ? <>Confirmed fixed, rating <strong>{f.rating}/5</strong></> : <>Fix rejected</>}
                    {f.comment && <> — “{f.comment}”</>}
                    <div className="muted small">{formatDateTime(f.givenAt)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {isReporter && complaint.status === 'RESOLVED' && <ReporterActions complaint={complaint} respond={respond} />}
      {isAssignee && ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(complaint.status) && <WorkerActions complaint={complaint} run={run} />}
      {isHandler && !finished && <HandlerActions complaint={complaint} run={run} />}
      {user.role === 'SUPERVISOR' && complaint.category.type === 'SERVICE' && (
        <p className="muted">This is a service complaint: the Administrator handles it.</p>
      )}
      <p className="muted small"><Link to="/">Back to your portal</Link></p>
    </article>
  );
}

// The photo needs the login token, so it is fetched as a blob and shown from an object URL.
function Photo({ complaintId }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url;
    let cancelled = false;
    api.photoBlob(complaintId).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    }).catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [complaintId]);
  if (failed) return <p className="muted">The photo could not be loaded.</p>;
  if (!src) return <p className="muted">Loading photo…</p>;
  return <img className="photo" src={src} alt="Photo attached to the complaint" />;
}
