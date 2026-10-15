// Dashboard — live summary of the active household.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../context/AuthContext.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { useExpenses, useSettlements, useBills, useChores, useGroceryItems, useActivity } from '../hooks/useHouseholdData.js';
import { computeNetBalances, pairwiseFor } from '../lib/balances.js';
import { formatPaise } from '../lib/money.js';
import { isoDate, billStatus } from '../lib/recurrence.js';
import { Spinner, EmptyState, Amount, Avatar } from '../components/ui.jsx';
import ExpenseForm from '../components/ExpenseForm.jsx';
import { addExpense } from '../services/expenses.js';
import { useToast } from '../context/ToastContext.jsx';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { household, members, activeId, memberName } = useHousehold();
  const { data: expenses, loading: le } = useExpenses();
  const { data: settlements, loading: ls } = useSettlements();
  const { data: bills } = useBills();
  const { data: chores } = useChores();
  const { data: items } = useGroceryItems();
  const { data: activity } = useActivity();
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const toast = useToast();

  const today = isoDate(new Date());
  const monthPrefix = today.slice(0, 7); // YYYY-MM

  const stats = useMemo(() => {
    if (!expenses || !settlements) return null;
    const monthExpenses = expenses.filter((e) => e.date.startsWith(monthPrefix));
    const monthTotal = monthExpenses.reduce((a, e) => a + e.totalPaise, 0);
    const net = computeNetBalances(
      expenses.map((e) => ({ payers: e.payers, shares: e.shares, deleted: e.deleted })),
      settlements.map((s) => ({ from: s.from, to: s.to, amountPaise: s.amountPaise, reversed: s.reversed }))
    );
    const mine = net[user.uid] || 0;
    const { owes, owedBy } = pairwiseFor(user.uid, net);
    // member-wise paid this month
    const byMember = {};
    for (const e of monthExpenses) {
      for (const [uid, paid] of Object.entries(e.payers)) {
        byMember[uid] = (byMember[uid] || 0) + paid;
      }
    }
    // last 6 months chart
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = isoDate(d).slice(0, 7);
      const total = expenses.filter((e) => e.date.startsWith(key)).reduce((a, e) => a + e.totalPaise, 0);
      months.push({ month: d.toLocaleString('en', { month: 'short' }), rupees: Math.round(total / 100) });
    }
    return { monthTotal, net, mine, owes, owedBy, byMember, months };
  }, [expenses, settlements, user.uid, monthPrefix]);

  if (le || ls || !stats) return <Spinner label="Loading dashboard…" />;

  const upcomingBills = (bills || [])
    .filter((b) => !b.archived && !b.paidAt)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);
  const pendingChores = (chores || []).filter((c) => !c.completedAt).slice(0, 5);
  const unpurchased = (items || []).filter((i) => !i.purchased);
  const hasAnything =
    expenses.length > 0 || (bills || []).length > 0 || (chores || []).length > 0 || unpurchased.length > 0;

  return (
    <>
      <div className="topbar dashboard-hero">
        <div>
          <p className="eyebrow">A little less admin. A lot more home.</p>
          <h1>{household?.name || 'Dashboard'}</h1>
          <p style={{ color: 'var(--text-soft)', fontSize: '0.88rem' }}>
            {members.length} member{members.length === 1 ? '' : 's'} · {household?.currency || 'INR'}
          </p>
        </div>
        <div className="quick-actions">
          <button className="btn" onClick={() => setShowExpenseForm(true)}>+ Expense</button>
          <Link className="btn btn-secondary" to="/bills">+ Bill</Link>
          <Link className="btn btn-secondary" to="/chores">+ Chore</Link>
          <Link className="btn btn-secondary" to="/groceries">+ Grocery</Link>
        </div>
      </div>

      <div className="grid grid-4">
        <button type="button" className="card stat stat-link" onClick={() => navigate('/expenses')} aria-label="View this month's expenses">
          <span className="label">This month's spending</span>
          <span className="value">{formatPaise(stats.monthTotal)}</span>
          <span className="sub">{monthPrefix}</span>
        </button>
        <button type="button" className="card stat stat-link" onClick={() => navigate('/balances')} aria-label="View your balances">
          <span className="label">Your balance</span>
          <span className="value">
            <Amount paise={stats.mine} signed />
          </span>
          <span className="sub">{stats.mine > 0 ? 'you are owed' : stats.mine < 0 ? 'you owe' : 'settled up'}</span>
        </button>
        <button type="button" className="card stat stat-link" onClick={() => navigate('/chores')} aria-label="View pending chores">
          <span className="label">Pending chores</span>
          <span className="value">{(chores || []).filter((c) => !c.completedAt).length}</span>
          <span className="sub">{(chores || []).filter((c) => !c.completedAt && c.dueDate < today).length} overdue</span>
        </button>
        <button type="button" className="card stat stat-link" onClick={() => navigate('/groceries')} aria-label="View shopping list">
          <span className="label">Shopping list</span>
          <span className="value">{unpurchased.length}</span>
          <span className="sub">items to buy</span>
        </button>
      </div>

      {!hasAnything && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <EmptyState
            icon="☀"
            title="Welcome to your household"
            hint="Start by adding your first shared expense, a recurring bill, or a chore."
            action={<button className="btn" onClick={() => setShowExpenseForm(true)}>Add your first expense</button>}
          />
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="card">
          <div className="card-title">
            <h3>Monthly spending</h3>
            <Link to="/reports" style={{ fontSize: '0.82rem' }}>Reports →</Link>
          </div>
          {stats.months.every((m) => m.rupees === 0) ? (
            <EmptyState title="No spending yet" hint="Charts appear once expenses are added." />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.months}>
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} />
                <Tooltip formatter={(v) => [`₹${new Intl.NumberFormat('en-IN').format(v)}`, 'Spent']} />
                <Bar dataKey="rupees" fill="#27a35b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h3>Balances</h3>
            <Link to="/balances" style={{ fontSize: '0.82rem' }}>Settle up →</Link>
          </div>
          {stats.owes.length === 0 && stats.owedBy.length === 0 ? (
            <EmptyState title="All settled" hint="Nobody owes anybody right now." />
          ) : (
            <>
              {stats.owes.map((o) => (
                <div className="list-row" key={`owe-${o.id}`}>
                  <span className="grow">
                    You owe <strong>{memberName(o.id)}</strong>
                  </span>
                  <span className="amount-neg">{formatPaise(o.amountPaise)}</span>
                </div>
              ))}
              {stats.owedBy.map((o) => (
                <div className="list-row" key={`owed-${o.id}`}>
                  <span className="grow">
                    <strong>{memberName(o.id)}</strong> owes you
                  </span>
                  <span className="amount-pos">{formatPaise(o.amountPaise)}</span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h3>Upcoming bills</h3>
            <Link to="/bills" style={{ fontSize: '0.82rem' }}>All bills →</Link>
          </div>
          {upcomingBills.length === 0 ? (
            <EmptyState title="No upcoming bills" hint="Add recurring bills to track due dates." />
          ) : (
            upcomingBills.map((b) => {
              const status = billStatus(b, today);
              return (
                <div className="list-row" key={b.id}>
                  <div className="grow">
                    <div className="title">{b.name}</div>
                    <div className="sub">due {b.dueDate}</div>
                  </div>
                  <span className={`badge ${status === 'overdue' ? 'badge-red' : status === 'due' ? 'badge-amber' : 'badge-grey'}`}>
                    {status}
                  </span>
                  <span>{formatPaise(b.expectedPaise)}</span>
                </div>
              );
            })
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h3>Pending chores</h3>
            <Link to="/chores" style={{ fontSize: '0.82rem' }}>All chores →</Link>
          </div>
          {pendingChores.length === 0 ? (
            <EmptyState title="Nothing pending" hint="All chores are done. Nice." />
          ) : (
            pendingChores.map((c) => (
              <div className="list-row" key={c.id}>
                <div className="grow">
                  <div className="title">{c.title}</div>
                  <div className="sub">
                    {c.assignees?.map(memberName).join(', ') || 'Unassigned'} · due {c.dueDate}
                  </div>
                </div>
                {c.dueDate < today && <span className="badge badge-red">overdue</span>}
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h3>Member spending this month</h3>
          </div>
          {Object.keys(stats.byMember).length === 0 ? (
            <EmptyState title="No expenses this month" />
          ) : (
            Object.entries(stats.byMember)
              .sort((a, b) => b[1] - a[1])
              .map(([uid, paid]) => {
                const m = members.find((x) => x.uid === uid);
                return (
                  <div className="list-row" key={uid}>
                    <span className="member-chip grow">
                      <Avatar name={m?.displayName || '?'} photoURL={m?.photoURL} />
                      {m?.displayName || 'Former member'}
                    </span>
                    <span>{formatPaise(paid)}</span>
                  </div>
                );
              })
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h3>Recent activity</h3>
            <Link to="/activity" style={{ fontSize: '0.82rem' }}>Full feed →</Link>
          </div>
          {!activity || activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            activity.slice(0, 6).map((a) => (
              <div className="list-row" key={a.id}>
                <div className="grow">
                  <div style={{ fontSize: '0.88rem' }}>{a.summary}</div>
                  <div className="sub">{a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString() : '…'}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showExpenseForm && (
        <ExpenseForm
          members={members}
          onClose={() => setShowExpenseForm(false)}
          onSave={async (data, receipt) => {
            await addExpense(activeId, data, receipt);
            toast('Expense added');
          }}
        />
      )}
    </>
  );
}
