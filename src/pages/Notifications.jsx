// Notifications — in-app notification centre with unread handling.
import { useHousehold } from '../context/HouseholdContext.jsx';
import { markNotificationRead, markAllNotificationsRead } from '../services/activity.js';
import { EmptyState } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';

const TYPE_ICON = { expense: '₹', settlement: '⇄', chore: '✓', bill: '◫', invite: '◉' };

export default function Notifications() {
  const { activeId, notifications, unreadCount } = useHousehold();
  const toast = useToast();

  return (
    <>
      <div className="section-head">
        <h1>Notifications</h1>
        {unreadCount > 0 && (
          <button
            className="btn btn-secondary"
            onClick={async () => {
              await markAllNotificationsRead(activeId, notifications);
              toast('All notifications marked read');
            }}
          >
            Mark all read ({unreadCount})
          </button>
        )}
      </div>

      <div className="card">
        {notifications.length === 0 ? (
          <EmptyState icon="◎" title="No notifications" hint="You'll be notified about expenses, chores and bills that affect you." />
        ) : (
          notifications.map((n) => (
            <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`}>
              <span style={{ fontSize: '1.1rem' }}>{TYPE_ICON[n.type] || '•'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: n.read ? 400 : 650, fontSize: '0.9rem' }}>{n.title}</div>
                <div style={{ color: 'var(--text-soft)', fontSize: '0.82rem' }}>
                  {n.body} · {n.actorName}
                </div>
                <div style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>
                  {n.createdAt?.toDate ? n.createdAt.toDate().toLocaleString() : 'just now'}
                </div>
              </div>
              {!n.read && (
                <button className="btn btn-ghost btn-sm" onClick={() => markNotificationRead(activeId, n.id)}>
                  Mark read
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
