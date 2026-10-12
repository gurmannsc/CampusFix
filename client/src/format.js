// Display helpers: labels, dates and "due in" text.
export const STATUS_LABEL = {
  SUBMITTED: 'Submitted', INVALID: 'Invalid', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', ON_HOLD: 'On hold',
  RESOLVED: 'Resolved', REOPENED: 'Reopened', ESCALATED: 'Escalated', CLOSED: 'Closed',
};
export const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const PRIORITY_LABEL = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const FINISHED = ['CLOSED', 'INVALID'];
export const ACTIVE = ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED', 'ESCALATED', 'RESOLVED'];

export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function formatLocation(l) {
  return `${l.block}, ${l.floor === 0 ? 'ground floor' : `floor ${l.floor}`}, ${l.room}`;
}

// "in 3 h", "6 h overdue", "2 days overdue"
export function dueText(iso, now = Date.now()) {
  const hours = (new Date(iso).getTime() - now) / 3600000;
  const abs = Math.abs(hours);
  const amount = abs < 1 ? `${Math.max(1, Math.round(abs * 60))} min` : abs < 48 ? `${Math.round(abs)} h` : `${Math.round(abs / 24)} days`;
  return hours >= 0 ? `in ${amount}` : `${amount} overdue`;
}

// For <input type="datetime-local">: the browser wants "YYYY-MM-DDTHH:mm" in local time.
export function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
