import { PRIORITY_LABEL, STATUS_LABEL } from '../format.js';

export const StatusBadge = ({ status }) => <span className={`badge status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;

export const PriorityBadge = ({ priority }) => <span className={`badge priority-${priority}`}>{PRIORITY_LABEL[priority] ?? priority}</span>;

// Success / error / info line. role="alert" makes screen readers announce it.
export function Message({ kind = 'error', children }) {
  if (!children) return null;
  return <p className={`message ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</p>;
}
