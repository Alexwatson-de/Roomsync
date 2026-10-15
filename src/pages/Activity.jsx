// Activity — chronological household event feed.
import { useActivity } from '../hooks/useHouseholdData.js';
import { Spinner, EmptyState, Avatar } from '../components/ui.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';

const TYPE_LABEL = {
  expense_added: ['Expense', 'badge'],
  expense_edited: ['Expense', 'badge badge-amber'],
  expense_deleted: ['Expense', 'badge badge-red'],
  settlement_recorded: ['Settlement', 'badge badge-blue'],
  settlement_reversed: ['Settlement', 'badge badge-red'],
  bill_created: ['Bill', 'badge badge-grey'],
  bill_paid: ['Bill', 'badge'],
  chore_created: ['Chore', 'badge badge-grey'],
  chore_completed: ['Chore', 'badge'],
  item_added: ['Groceries', 'badge badge-grey'],
  item_purchased: ['Groceries', 'badge'],
  member_joined: ['Members', 'badge badge-blue'],
  member_left: ['Members', 'badge badge-grey'],
  member_removed: ['Members', 'badge badge-red'],
};

export default function Activity() {
  const { data: activity, loading } = useActivity();
  const { members } = useHousehold();

  if (loading) return <Spinner label="Loading activity…" />;

  return (
    <>
      <div className="section-head">
        <h1>Activity</h1>
      </div>
      <div className="card">
        {activity.length === 0 ? (
          <EmptyState icon="≡" title="No activity yet" hint="Household events appear here as they happen." />
        ) : (
          activity.map((a) => {
            const [label, badgeCls] = TYPE_LABEL[a.type] || ['Event', 'badge badge-grey'];
            const member = members.find((m) => m.uid === a.actorId);
            return (
              <div className="list-row" key={a.id}>
                <Avatar name={member?.displayName || a.actorName} uid={a.actorId} profile={member} />
                <div className="grow">
                  <div style={{ fontSize: '0.9rem' }}>{a.summary}</div>
                  <div className="sub">{a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString() : 'just now'}</div>
                </div>
                <span className={badgeCls}>{label}</span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
