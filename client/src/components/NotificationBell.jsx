// The bell in the header: unread badge plus the latest notifications. Polls the server every
// 20 seconds (no push, no external service). Clicking a notification marks it read and opens its complaint.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { formatDateTime } from '../format.js';

const POLL_MS = 20000;

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    api.get('/notifications?limit=10').then((r) => { setItems(r.notifications); setUnread(r.unreadCount); }).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // close on outside click or Escape
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function openItem(n) {
    setOpen(false);
    if (!n.isRead) {
      try { setUnread((await api.post(`/notifications/${n.notificationId}/read`)).unreadCount); } catch { /* ignore */ }
      setItems((list) => list.map((x) => (x.notificationId === n.notificationId ? { ...x, isRead: true } : x)));
    }
    if (n.complaintId) navigate(`/complaints/${n.complaintId}`);
  }

  return (
    <div className="bell" ref={box}>
      <button type="button" className="bell-button" aria-label={`Notifications, ${unread} unread`} aria-expanded={open}
        onClick={() => { setOpen(!open); if (!open) refresh(); }}>
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="menu">
          <div className="bell-title">Notifications</div>
          {items.length === 0 && <p className="muted pad">Nothing yet.</p>}
          <ul>
            {items.map((n) => (
              <li key={n.notificationId}>
                <button type="button" role="menuitem" className={n.isRead ? 'bell-item' : 'bell-item unread'} onClick={() => openItem(n)}>
                  <span>{n.message}</span>
                  <span className="muted small">{formatDateTime(n.sentAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
