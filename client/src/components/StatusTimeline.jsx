// US-03: the full status history of a complaint, oldest first, with who changed it, when and why.
// Escalations that do not change the status (level 2 and above) have no status row, so they are
// merged in as their own entries.
import { STATUS_LABEL, formatDateTime } from '../format.js';

export default function StatusTimeline({ statusHistory, escalations = [] }) {
  const entries = statusHistory.map((h) => ({
    key: `s${h.updateId}`,
    at: h.updatedAt,
    title: h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ${STATUS_LABEL[h.toStatus]}` : `Submitted`,
    status: h.toStatus,
    who: h.updatedBy ? h.updatedBy.name : 'Automatic (timer)',
    remarks: h.remarks,
  }));

  // An escalation at the same moment as an ESCALATED status row is already shown by that row.
  for (const e of escalations) {
    const shown = statusHistory.some((h) => h.toStatus === 'ESCALATED' && Math.abs(new Date(h.updatedAt) - new Date(e.escalatedAt)) <= 2000);
    if (!shown) {
      entries.push({
        key: `e${e.escalationId}`, at: e.escalatedAt, title: `Escalated again: level ${e.level}`, status: 'ESCALATED',
        who: 'Automatic (timer)', remarks: e.reason,
      });
    }
  }
  entries.sort((a, b) => new Date(a.at) - new Date(b.at));

  return (
    <ol className="timeline" aria-label="Status history">
      {entries.map((e) => (
        <li key={e.key} className={`status-${e.status}`}>
          <div className="timeline-title">{e.title}</div>
          <div className="muted small">{formatDateTime(e.at)} · {e.who}</div>
          {e.remarks && <div className="timeline-remarks">{e.remarks}</div>}
        </li>
      ))}
    </ol>
  );
}
