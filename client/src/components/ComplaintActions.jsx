// The action panels of the details page, one per kind of user:
//   ReporterActions  confirm (rating 1..5) or reject (reason)              rows 9, 10
//   WorkerActions    start / hold (reason) / resume / resolve (remarks)     rows 5 to 8   (the assignee)
//   HandlerActions   priority, assign, mark invalid, resolve an escalation  rows 2, 3, 4, 14 (supervisor; administrator for SERVICE)
// `run(action, successText)` comes from ComplaintDetailsPage: it calls the server and shows the outcome.
import { useState } from 'react';
import { api } from '../api.js';
import { useLoad } from '../hooks.js';
import { PRIORITIES, PRIORITY_LABEL, toLocalInputValue } from '../format.js';

const post = (id, action, body) => () => api.post(`/complaints/${id}/${action}`, body);

// ---- reporter -------------------------------------------------------------------------------

export function ReporterActions({ complaint, respond }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [mode, setMode] = useState(null); // null | 'confirm' | 'reject'
  const [busy, setBusy] = useState(false);

  async function send(isFixed) {
    setBusy(true);
    await respond(complaint.complaintId, isFixed, isFixed ? rating : null, comment.trim());
    setBusy(false);
  }

  return (
    <section className="card action-card">
      <h2>Was it fixed?</h2>
      <p>The work on your complaint is marked as done. Please check and answer; otherwise it closes by itself 48 hours after it was resolved.</p>
      <div className="row">
        <button type="button" className={mode === 'confirm' ? 'primary' : ''} onClick={() => setMode('confirm')}>Yes, it is fixed</button>
        <button type="button" className={mode === 'reject' ? 'danger' : ''} onClick={() => setMode('reject')}>No, still a problem</button>
      </div>

      {mode === 'confirm' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); send(true); }}>
          <fieldset className="rating">
            <legend>Rate the repair</legend>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={rating === n ? 'chosen' : ''}>
                <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} /> {n}
              </label>
            ))}
          </fieldset>
          <label>Comment <span className="muted small">(optional)</span>
            <textarea rows={2} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={busy || rating === 0}>Confirm and close</button>
          {rating === 0 && <span className="hint">Choose a rating from 1 to 5.</span>}
        </form>
      )}

      {mode === 'reject' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); send(false); }}>
          <label>What is still wrong?
            <textarea rows={3} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} required />
          </label>
          <button type="submit" className="danger" disabled={busy || !comment.trim()}>Reopen the complaint</button>
        </form>
      )}
    </section>
  );
}

// ---- assignee -------------------------------------------------------------------------------

export function WorkerActions({ complaint, run }) {
  const id = complaint.complaintId;
  const [text, setText] = useState('');
  const [mode, setMode] = useState(null); // 'hold' | 'resolve'
  const [busy, setBusy] = useState(false);

  async function go(action, body, success) {
    setBusy(true);
    const ok = await run(post(id, action, body), success);
    setBusy(false);
    if (ok) { setText(''); setMode(null); }
  }

  return (
    <section className="card action-card">
      <h2>Your work on this complaint</h2>
      {complaint.status === 'ASSIGNED' && <button type="button" className="primary" disabled={busy} onClick={() => go('start', {}, 'Work started.')}>Start work</button>}

      {complaint.status === 'ON_HOLD' && <button type="button" className="primary" disabled={busy} onClick={() => go('resume', {}, 'Work resumed.')}>Resume (parts received)</button>}

      {complaint.status === 'IN_PROGRESS' && (
        <div className="row">
          <button type="button" className={mode === 'hold' ? 'primary' : ''} onClick={() => setMode('hold')}>Put on hold…</button>
          <button type="button" className={mode === 'resolve' ? 'primary' : ''} onClick={() => setMode('resolve')}>Mark resolved…</button>
        </div>
      )}

      {complaint.status === 'IN_PROGRESS' && mode === 'hold' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); go('hold', { reason: text.trim() }, 'The complaint is on hold.'); }}>
          <label>Reason (required)
            <input type="text" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="e.g. waiting for capacitor" required />
          </label>
          <button type="submit" className="primary" disabled={busy || !text.trim()}>Put on hold</button>
        </form>
      )}

      {complaint.status === 'IN_PROGRESS' && mode === 'resolve' && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); go('resolve', { remarks: text.trim() }, 'Marked as resolved. The reporter has been asked to confirm.'); }}>
          <label>What was done? (required)
            <textarea rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} required />
          </label>
          <button type="submit" className="primary" disabled={busy || !text.trim()}>Mark resolved</button>
        </form>
      )}
    </section>
  );
}

// ---- supervisor (administrator for SERVICE complaints) ---------------------------------------

export function HandlerActions({ complaint, run }) {
  const id = complaint.complaintId;
  const isService = complaint.category.type === 'SERVICE';
  const canPrioritise = !['RESOLVED'].includes(complaint.status);
  const canAssign = ['SUBMITTED', 'REOPENED'].includes(complaint.status);
  const escalated = complaint.status === 'ESCALATED';

  return (
    <section className="card action-card">
      <h2>{isService ? 'Administrator actions' : 'Supervisor actions'}</h2>
      {canPrioritise && <PriorityEditor complaint={complaint} run={run} />}
      {canAssign && <AssignPanel complaint={complaint} run={run} isService={isService} />}
      {complaint.status === 'SUBMITTED' && <InvalidPanel id={id} run={run} />}
      {escalated && <EscalationPanel complaint={complaint} run={run} />}
      {!canAssign && !escalated && complaint.status !== 'SUBMITTED' && !canPrioritise && <p className="muted">Nothing to do until the reporter responds.</p>}
    </section>
  );
}

function PriorityEditor({ complaint, run }) {
  const [priority, setPriority] = useState(complaint.priority);
  return (
    <div className="action-block">
      <h3>Priority</h3>
      <div className="row">
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <button type="button" disabled={priority === complaint.priority}
          onClick={() => run(() => api.patch(`/complaints/${complaint.complaintId}/priority`, { priority }), 'Priority updated. The due date was recalculated.')}>
          Change priority
        </button>
      </div>
      <span className="hint">The due date is counted from when the complaint was reported.</span>
    </div>
  );
}

// US-06: only staff with the matching trade who are available are offered.
function StaffSelect({ complaintId, value, onChange }) {
  const { data, error, loading } = useLoad(() => api.get(`/complaints/${complaintId}/eligible-staff`), [complaintId]);
  if (loading) return <p className="muted">Loading staff…</p>;
  if (error) return <p className="message error">{error.message}</p>;
  if (data.staff.length === 0) return <p className="message error">No available staff with the right trade.</p>;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Staff member">
      <option value="">Choose…</option>
      {data.staff.map((s) => (
        <option key={s.userId} value={s.userId}>{s.name}{s.trade ? ` (${s.trade})` : ''} — {s.openAssignments} open</option>
      ))}
    </select>
  );
}

function AssignPanel({ complaint, run, isService }) {
  const [staffId, setStaffId] = useState('');
  const id = complaint.complaintId;
  return (
    <div className="action-block">
      <h3>{complaint.status === 'REOPENED' ? 'Reassign' : 'Assign'}</h3>
      {isService ? (
        <button type="button" className="primary" onClick={() => run(post(id, 'assign', {}), 'Assigned to you.')}>Take this complaint</button>
      ) : (
        <div className="row">
          <StaffSelect complaintId={id} value={staffId} onChange={setStaffId} />
          <button type="button" className="primary" disabled={!staffId}
            onClick={() => run(post(id, 'assign', { staffId: Number(staffId) }), 'Assigned. The staff member and the reporter have been notified.')}>
            Assign
          </button>
        </div>
      )}
    </div>
  );
}

function InvalidPanel({ id, run }) {
  const [reason, setReason] = useState('');
  return (
    <div className="action-block">
      <h3>Mark as invalid</h3>
      <div className="row">
        <input type="text" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. duplicate of #12" aria-label="Reason" />
        <button type="button" className="danger" disabled={!reason.trim()} onClick={() => run(post(id, 'invalid', { reason: reason.trim() }), 'Marked as invalid. The reporter has been told.')}>
          Mark invalid
        </button>
      </div>
    </div>
  );
}

// Row 14: reassign to someone else, or give more time.
function EscalationPanel({ complaint, run }) {
  const id = complaint.complaintId;
  const [mode, setMode] = useState('reassign');
  const [staffId, setStaffId] = useState('');
  const [newDueAt, setNewDueAt] = useState(toLocalInputValue(new Date(Date.now() + 24 * 3600 * 1000)));
  const [reason, setReason] = useState('');
  const unassigned = !complaint.assignee;

  return (
    <div className="action-block">
      <h3>Resolve the escalation</h3>
      <p className="muted">This complaint is overdue (escalation level {complaint.escalationLevel}). Hand it to someone else or extend the deadline.</p>
      <div className="row">
        <label className="inline"><input type="radio" name="esc" checked={mode === 'reassign'} onChange={() => setMode('reassign')} /> Reassign</label>
        <label className="inline"><input type="radio" name="esc" checked={mode === 'extend'} disabled={unassigned} onChange={() => setMode('extend')} /> Extend deadline</label>
      </div>
      {mode === 'reassign' ? (
        <div className="row">
          <StaffSelect complaintId={id} value={staffId} onChange={setStaffId} />
          <button type="button" className="primary" disabled={!staffId}
            onClick={() => run(post(id, 'resolve-escalation', { action: 'reassign', staffId: Number(staffId) }), 'Reassigned with a fresh deadline.')}>
            Reassign
          </button>
        </div>
      ) : (
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          run(post(id, 'resolve-escalation', { action: 'extend', newDueAt: new Date(newDueAt).toISOString(), reason: reason.trim() }), 'Deadline extended.');
        }}>
          <label>New deadline
            <input type="datetime-local" value={newDueAt} onChange={(e) => setNewDueAt(e.target.value)} required />
          </label>
          <label>Reason (required)
            <input type="text" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} required />
          </label>
          <button type="submit" className="primary" disabled={!reason.trim() || !newDueAt}>Extend deadline</button>
        </form>
      )}
    </div>
  );
}
