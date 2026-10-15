// Expenses — searchable/filterable ledger with add/edit/delete.
import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { useExpenses } from '../hooks/useHouseholdData.js';
import { addExpense, updateExpense, deleteExpense } from '../services/expenses.js';
import { formatPaise, parseAmountToPaise } from '../lib/money.js';
import { EXPENSE_CATEGORIES } from '../lib/constants.js';
import { Spinner, EmptyState, ConfirmDialog, Modal } from '../components/ui.jsx';
import ExpenseForm from '../components/ExpenseForm.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Expenses() {
  const { user } = useAuth();
  const { activeId, members, myRole, memberName } = useHousehold();
  const { data: expenses, loading, error } = useExpenses();
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(false);

  // filters (kept in state so they persist while navigating between records)
  const [fKeyword, setFKeyword] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fMember, setFMember] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fMin, setFMin] = useState('');
  const [fMax, setFMax] = useState('');

  const filtered = useMemo(() => {
    if (!expenses) return [];
    const minP = fMin ? parseAmountToPaise(fMin) : null;
    const maxP = fMax ? parseAmountToPaise(fMax) : null;
    return expenses.filter((e) => {
      if (fKeyword && !`${e.title} ${e.description}`.toLowerCase().includes(fKeyword.toLowerCase())) return false;
      if (fCategory && e.category !== fCategory) return false;
      if (fMember && !(fMember in e.payers) && !e.participants.includes(fMember)) return false;
      if (fFrom && e.date < fFrom) return false;
      if (fTo && e.date > fTo) return false;
      if (minP !== null && e.totalPaise < minP) return false;
      if (maxP !== null && e.totalPaise > maxP) return false;
      return true;
    });
  }, [expenses, fKeyword, fCategory, fMember, fFrom, fTo, fMin, fMax]);

  if (loading) return <Spinner label="Loading expenses…" />;
  if (error) return <p className="error-text">Could not load expenses: {error.message}. If this mentions an index, see the README's "Indexes" section.</p>;

  const canEdit = (e) => e.createdBy === user.uid || ['owner', 'admin'].includes(myRole);

  return (
    <>
      <div className="section-head">
        <h1>Expenses</h1>
        <button className="btn" onClick={() => setShowForm(true)}>+ Add expense</button>
      </div>

      <div className="filters-bar card" style={{ padding: '0.8rem' }}>
        <div className="field">
          <label>Search</label>
          <input value={fKeyword} onChange={(e) => setFKeyword(e.target.value)} placeholder="Title or description" />
        </div>
        <div className="field">
          <label>Category</label>
          <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
            <option value="">All</option>
            {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Member</label>
          <select value={fMember} onChange={(e) => setFMember(e.target.value)}>
            <option value="">Anyone</option>
            {members.map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
          </select>
        </div>
        <div className="field">
          <label>From</label>
          <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Min ₹</label>
          <input inputMode="decimal" value={fMin} onChange={(e) => setFMin(e.target.value)} style={{ width: 90 }} />
        </div>
        <div className="field">
          <label>Max ₹</label>
          <input inputMode="decimal" value={fMax} onChange={(e) => setFMax(e.target.value)} style={{ width: 90 }} />
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <EmptyState
            icon="₹"
            title={expenses.length === 0 ? 'No expenses yet' : 'No expenses match your filters'}
            hint={expenses.length === 0 ? 'Add your first shared expense to start tracking balances.' : 'Try clearing some filters.'}
            action={expenses.length === 0 && <button className="btn" onClick={() => setShowForm(true)}>Add expense</button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Paid by</th>
                  <th>Split</th>
                  <th className="num">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setViewing(e)}>
                    <td>{e.date}</td>
                    <td><strong>{e.title}</strong></td>
                    <td><span className="badge badge-grey">{e.category}</span></td>
                    <td>{Object.keys(e.payers).map(memberName).join(', ')}</td>
                    <td>{e.splitMethod} · {e.participants.length}</td>
                    <td className="num">{formatPaise(e.totalPaise)}</td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      {canEdit(e) && (
                        <span style={{ display: 'flex', gap: '0.3rem' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(e)}>Edit</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red-600)' }} onClick={() => setDeleting(e)}>Delete</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <ExpenseForm
          members={members}
          onClose={() => setShowForm(false)}
          onSave={async (data) => {
            await addExpense(activeId, data);
            toast('Expense added');
          }}
        />
      )}

      {editing && (
        <ExpenseForm
          title="Edit expense"
          members={members}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            await updateExpense(activeId, editing.id, data);
            toast('Expense updated — balances recalculated');
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete expense?"
          message={`"${deleting.title}" (${formatPaise(deleting.totalPaise)}) will be removed and balances recalculated. The record stays in the audit trail.`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await deleteExpense(activeId, deleting.id, deleting.title);
              toast('Expense deleted');
              setDeleting(null);
            } catch (err) {
              toast.error(err.message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)}>
          <p style={{ color: 'var(--text-soft)', fontSize: '0.88rem' }}>
            {viewing.date} · {viewing.category} · added by {viewing.createdByName}
          </p>
          {viewing.description && <p>{viewing.description}</p>}
          <h3 style={{ marginTop: '0.8rem' }}>Paid</h3>
          {Object.entries(viewing.payers).map(([uid, p]) => (
            <div className="list-row" key={uid}>
              <span className="grow">{memberName(uid)}</span>
              <span>{formatPaise(p)}</span>
            </div>
          ))}
          <h3 style={{ marginTop: '0.8rem' }}>Shares ({viewing.splitMethod})</h3>
          {Object.entries(viewing.shares).map(([uid, s]) => (
            <div className="list-row" key={uid}>
              <span className="grow">{memberName(uid)}</span>
              <span>{formatPaise(s)}</span>
            </div>
          ))}
        </Modal>
      )}
    </>
  );
}
