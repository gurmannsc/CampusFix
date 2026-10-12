// Table of complaints used by every portal. Rows link to the details page.
import { Link } from 'react-router-dom';
import { dueText, formatLocation, FINISHED } from '../format.js';
import { PriorityBadge, StatusBadge } from './Badges.jsx';

export default function ComplaintList({ complaints, showReporter = false, showAssignee = false, empty = 'No complaints.' }) {
  if (complaints.length === 0) return <p className="muted pad">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Complaint</th><th>Location</th><th>Priority</th><th>Status</th><th>Due</th>
            {showReporter && <th>Reporter</th>}
            {showAssignee && <th>Assigned to</th>}
          </tr>
        </thead>
        <tbody>
          {complaints.map((c) => (
            <tr key={c.complaintId} className={c.overdue ? 'overdue-row' : ''}>
              <td><Link to={`/complaints/${c.complaintId}`}>#{c.complaintId}</Link></td>
              <td>
                <Link to={`/complaints/${c.complaintId}`}>{c.title}</Link>
                <div className="muted small">
                  {c.category.name}{c.category.type === 'SERVICE' && ' · Administrator handles'}
                  {c.escalationLevel > 0 && c.status === 'ESCALATED' && ` · escalation level ${c.escalationLevel}`}
                </div>
              </td>
              <td>{formatLocation(c.location)}</td>
              <td><PriorityBadge priority={c.priority} /></td>
              <td><StatusBadge status={c.status} /></td>
              <td>{FINISHED.includes(c.status) || c.status === 'RESOLVED' ? <span className="muted">—</span> : (
                <span className={c.overdue ? 'late' : ''}>{dueText(c.dueAt)}</span>
              )}</td>
              {showReporter && <td>{c.reporter.name}</td>}
              {showAssignee && <td>{c.assignee?.name ?? <span className="muted">—</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
