// Supervisor console (US-04, US-05, US-06): all complaints, sorted by priority and then due date by the
// server, with filters. Open a complaint to set its priority, assign staff, mark it invalid, or resolve an escalation.
import { useState } from 'react';
import { api, complaintQuery } from '../api.js';
import { useLoad } from '../hooks.js';
import ComplaintList from '../components/ComplaintList.jsx';
import { Message } from '../components/Badges.jsx';
import { ACTIVE, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL } from '../format.js';

// Quick views over the status filter. "open" is everything that is not finished.
const VIEWS = {
  open: { label: 'All open', status: ACTIVE },
  assign: { label: 'Needs assignment', status: ['SUBMITTED', 'REOPENED'] },
  escalated: { label: 'Escalated', status: ['ESCALATED'] },
  progress: { label: 'In progress', status: ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] },
  resolved: { label: 'Awaiting reporter', status: ['RESOLVED'] },
  closed: { label: 'Closed / invalid', status: ['CLOSED', 'INVALID'] },
};

export default function SupervisorConsole() {
  const [view, setView] = useState('open');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [block, setBlock] = useState('');
  const categories = useLoad(() => api.get('/categories'), []);
  const locations = useLoad(() => api.get('/locations'), []);

  const filters = { status: VIEWS[view].status, priority, category, block };
  const { data, error, loading, reload } = useLoad(() => api.get(complaintQuery(filters)), [view, priority, category, block]);
  const complaints = data?.complaints ?? [];

  // counts for the summary line (only for the unfiltered "open" view, so they are not misleading)
  const overdue = complaints.filter((c) => c.overdue).length;
  const blocks = [...new Set((locations.data?.locations ?? []).map((l) => l.block))];

  return (
    <>
      <div className="page-head">
        <h1>Complaints</h1>
        <button type="button" onClick={reload}>Refresh</button>
      </div>

      <div className="tabs" role="tablist" aria-label="Views">
        {Object.entries(VIEWS).map(([key, v]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? 'tab active' : 'tab'} onClick={() => setView(key)}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="filters card">
        <label>Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">Any</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </label>
        <label>Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any</option>
            {(categories.data?.categories ?? []).map((c) => <option key={c.categoryId} value={c.name}>{c.name}</option>)}
          </select>
        </label>
        <label>Block
          <select value={block} onChange={(e) => setBlock(e.target.value)}>
            <option value="">Any</option>
            {blocks.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <p className="muted small summary">
          Sorted by priority, then due date.
          {data && ` ${complaints.length} complaint${complaints.length === 1 ? '' : 's'}`}
          {data && overdue > 0 && ` · ${overdue} overdue`}
          {' · '}{STATUS_LABEL.SUBMITTED}, {STATUS_LABEL.REOPENED} and {STATUS_LABEL.ESCALATED} need you.
        </p>
      </div>

      <Message>{error?.message}</Message>
      {loading && !data && <p className="muted">Loading…</p>}
      {data && (
        <section className="card">
          <ComplaintList complaints={complaints} showReporter showAssignee empty="No complaints match these filters." />
        </section>
      )}
    </>
  );
}
