// Bills — list + calendar views, recurring generation, mark-paid workflow
// with optional expense-ledger linking (never double-counted).
import { useMemo, useState } from 'react';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { useBills } from '../hooks/useHouseholdData.js';
import { createBill, updateBill, archiveBill, markBillPaid } from '../services/bills.js';
import { formatPaise, parseAmountToPaise } from '../lib/money.js';
import { BILL_CATEGORIES } from '../lib/constants.js';
import { isoDate, billStatus, fromIso } from '../lib/recurrence.js';
import { Spinner, Modal, EmptyState, MemberSelect } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';

const STATUS_BADGE = { paid: 'badge', overdue: 'badge badge-red', due: 'badge badge-amber', upcoming: 'badge badge-grey' };

// Bill categories that exist verbatim in the expense category list; everything
// else lands in "Other" so the expense ledger stays consistent.
const BILL_TO_EXPENSE_CATEGORY = { Rent: 'Rent', Electricity: 'Electricity', Internet: 'Internet' };

export default function Bills() {
  const { activeId, members, memberName } = useHousehold();
  const { data: bills, loading } = useBills();
  const toast = useToast();
  const [view, setView] = useState('list');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const today = isoDate(new Date());

  const visible = useMemo(
    () => (bills || []).filter((b) => (showArchived ? true : !b.archived)),
    [bills, showArchived]
  );

  const monthTotalPaid = useMemo(() => {
    const prefix = today.slice(0, 7);
    return (bills || [])
      .filter((b) => b.paidAt && b.dueDate.startsWith(prefix))
      .reduce((a, b) => a + (b.paidPaise ?? b.expectedPaise), 0);
  }, [bills, today]);

  if (loading) return <Spinner label="Loading bills…" />;

  return (
    <>
      <div className="section-head">
        <h1>Bills</h1>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <div className="segmented">
            <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button>
            <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>Calendar</button>
          </div>
          <button className="btn" onClick={() => setShowForm(true)}>+ Add bill</button>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card stat">
          <span className="label">Unpaid bills</span>
          <span className="value">{visible.filter((b) => !b.paidAt && !b.archived).length}</span>
        </div>
        <div className="card stat">
          <span className="label">Overdue</span>
          <span className="value" style={{ color: 'var(--red-600)' }}>
            {visible.filter((b) => !b.archived && billStatus(b, today) === 'overdue').length}
          </span>
        </div>
        <div className="card stat">
          <span className="label">Paid this month</span>
          <span className="value">{formatPaise(monthTotalPaid)}</span>
        </div>
      </div>

      <label className="checkbox-row" style={{ margin: '0.8rem 0 0.2rem' }}>
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived bills
      </label>

      {view === 'list' ? (
        <div className="card">
          {visible.length === 0 ? (
            <EmptyState icon="◫" title="No bills yet" hint="Track rent, electricity, internet and other recurring costs."
              action={<button className="btn" onClick={() => setShowForm(true)}>Add a bill</button>} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Bill</th><th>Category</th><th>Due</th><th>Recurs</th><th>Responsible</th>
                    <th className="num">Amount</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((b) => {
                    const status = b.archived ? 'archived' : billStatus(b, today);
                    return (
                      <tr key={b.id} style={b.archived ? { opacity: 0.55 } : undefined}>
                        <td><strong>{b.name}</strong>{b.notes && <div className="sub" style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>{b.notes}</div>}</td>
                        <td><span className="badge badge-grey">{b.category}</span></td>
                        <td>{b.dueDate}</td>
                        <td>{b.recurrence}</td>
                        <td>{b.assignedTo ? memberName(b.assignedTo) : '—'}</td>
                        <td className="num">
                          {b.paidAt && b.paidPaise !== null && b.paidPaise !== b.expectedPaise ? (
                            <>
                              {formatPaise(b.paidPaise)}{' '}
                              <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }}>(expected {formatPaise(b.expectedPaise)})</span>
                            </>
                          ) : formatPaise(b.expectedPaise)}
                        </td>
                        <td><span className={STATUS_BADGE[status] || 'badge badge-grey'}>{status}</span></td>
                        <td>
                          <span style={{ display: 'flex', gap: '0.3rem' }}>
                            {!b.paidAt && !b.archived && (
                              <button className="btn btn-sm" onClick={() => setPaying(b)}>Mark paid</button>
                            )}
                            {!b.archived && (
                              <>
                                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(b)}>Edit</button>
                                <button className="btn btn-ghost btn-sm" onClick={async () => { await archiveBill(activeId, b.id); toast('Bill archived'); }}>
                                  Archive
                                </button>
                              </>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <BillCalendar bills={visible} today={today} />
      )}

      {(showForm || editing) && (
        <BillForm
          members={members}
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={async (data) => {
            if (editing) {
              await updateBill(activeId, editing.id, data);
              toast('Bill updated');
            } else {
              await createBill(activeId, data);
              toast('Bill created');
            }
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {paying && (
        <PayBillModal
          bill={paying}
          members={members}
          onClose={() => setPaying(null)}
          onSave={async ({ paidPaise, addToLedger, paidBy, participants }) => {
            let expenseInput = null;
            if (addToLedger) {
              // Persist this with the bill payment in one Firestore transaction.
              expenseInput = {
                title: `${paying.name} (bill)`,
                category: BILL_TO_EXPENSE_CATEGORY[paying.category] || 'Other',
                date: isoDate(new Date()),
                totalPaise: paidPaise,
                payers: { [paidBy]: paidPaise },
                participants,
                splitMethod: 'equal',
                splitDetail: null,
                description: `Payment of bill "${paying.name}" due ${paying.dueDate}`,
              };
            }
            const nextId = await markBillPaid(activeId, paying, { paidPaise, expenseInput, paidBy });
            toast(addToLedger ? 'Bill paid and added to expenses' : 'Bill marked paid');
            if (nextId) toast.info('Next occurrence scheduled');
            setPaying(null);
          }}
        />
      )}
    </>
  );
}

function BillCalendar({ bills, today }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthLabel = first.toLocaleString('en', { month: 'long', year: 'numeric' });
  const startDow = first.getDay();
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const billsOn = (day) => {
    const iso = isoDate(new Date(first.getFullYear(), first.getMonth(), day));
    return bills.filter((b) => b.dueDate === iso);
  };

  return (
    <div className="card">
      <div className="card-title">
        <h3>{monthLabel}</h3>
        <div className="segmented">
          <button onClick={() => setMonthOffset((m) => m - 1)}>←</button>
          <button onClick={() => setMonthOffset(0)}>Today</button>
          <button onClick={() => setMonthOffset((m) => m + 1)}>→</button>
        </div>
      </div>
      <div className="calendar-grid" style={{ marginBottom: 4 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-faint)', textAlign: 'center' }}>{d}</div>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((day, i) => (
          <div key={i} className={`calendar-cell ${day === null ? 'other-month' : ''}`}>
            {day && (
              <>
                <div className="day-num">{day}</div>
                {billsOn(day).map((b) => {
                  const st = b.paidAt ? 'paid' : billStatus(b, today) === 'overdue' ? 'overdue' : '';
                  return <div key={b.id} className={`calendar-bill ${st}`}>{b.name}</div>;
                })}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BillForm({ members, initial, draft, reviewNote, onClose, onSave }) {
  const seed = initial || draft;
  const [form, setForm] = useState(() => ({
    name: seed?.name || '',
    category: seed?.category || 'Rent',
    amount: Number.isSafeInteger(seed?.expectedPaise) && seed.expectedPaise > 0 ? (seed.expectedPaise / 100).toFixed(2) : '',
    dueDate: seed?.dueDate ?? isoDate(new Date()),
    recurrence: seed?.recurrence || 'monthly',
    assignedTo: seed?.assignedTo || '',
    participants: seed?.participants || members.map((m) => m.uid),
    notes: seed?.notes || '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const expectedPaise = parseAmountToPaise(form.amount);
    if (!form.name.trim()) return setError('Name is required.');
    if (expectedPaise === null || expectedPaise <= 0) return setError('Enter a valid amount.');
    if (form.participants.length === 0) return setError('Select at least one participant.');
    setBusy(true);
    try {
      await onSave({
        name: form.name,
        category: form.category,
        expectedPaise,
        dueDate: form.dueDate,
        recurrence: form.recurrence,
        assignedTo: form.assignedTo || null,
        splitMethod: 'equal',
        splitDetail: null,
        participants: form.participants,
        notes: form.notes,
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? 'Edit bill' : 'Add bill'} onClose={onClose}>
      {reviewNote}
      <form onSubmit={submit}>
        <div className="form-row">
          <div className="field">
            <label>Name</label>
            <input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Rent" />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {BILL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Expected amount (₹)</label>
            <input required inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
          </div>
          <div className="field">
            <label>Due date</label>
            <input type="date" required value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Recurrence</label>
            <select value={form.recurrence} onChange={(e) => set('recurrence', e.target.value)} disabled={!!initial}>
              <option value="one-time">One-time</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div className="field">
            <label>Responsible member</label>
            <select value={form.assignedTo} onChange={(e) => set('assignedTo', e.target.value)}>
              <option value="">Anyone</option>
              {members.map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
            </select>
          </div>
        </div>
        <MemberSelect members={members} selected={form.participants} onChange={(p) => set('participants', p)} label="Split between" />
        <div className="field">
          <label>Notes (optional)</label>
          <input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save bill'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function PayBillModal({ bill, members, prefill, reviewNote, allowLedger = true, onClose, onSave }) {
  const [amount, setAmount] = useState(((prefill?.totalPaise || bill.expectedPaise) / 100).toFixed(2));
  const [addToLedger, setAddToLedger] = useState(allowLedger);
  const [paidBy, setPaidBy] = useState(prefill?.paidBy || bill.assignedTo || members[0]?.uid || '');
  const [participants, setParticipants] = useState(bill.participants?.length ? bill.participants : members.map((m) => m.uid));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const paidPaise = parseAmountToPaise(amount);
    if (paidPaise === null || paidPaise <= 0) return setError('Enter the actual amount paid.');
    if (!paidBy) return setError('Choose who actually paid.');
    if (addToLedger && participants.length === 0) return setError('Select who shares this bill.');
    setBusy(true);
    try {
      await onSave({ paidPaise, addToLedger, paidBy, participants });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Mark "${bill.name}" as paid`} onClose={onClose}>
      {reviewNote}
      <form onSubmit={submit}>
        <div className="field">
          <label>Actual amount paid (₹)</label>
          <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="hint">Expected: {formatPaise(bill.expectedPaise)}</span>
        </div>
        {allowLedger && <label className="checkbox-row">
          <input type="checkbox" checked={addToLedger} onChange={(e) => setAddToLedger(e.target.checked)} />
          Also record as a shared expense (updates balances)
        </label>}
        <div className="field" style={{ marginTop: '0.5rem' }}>
              <label>Paid by</label>
              <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                {members.map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
              </select>
            </div>
        {addToLedger && (
          <>
            <MemberSelect members={members} selected={participants} onChange={setParticipants} label="Split equally between" />
          </>
        )}
        {!addToLedger && (
          <p className="hint" style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>
            Marking paid without adding an expense only updates the bill's status — balances are unchanged.
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Mark paid'}</button>
        </div>
      </form>
    </Modal>
  );
}
