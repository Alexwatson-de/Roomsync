// Balances — net positions, suggested settlements, settlement workflow + history.
import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { useExpenses, useSettlements } from '../hooks/useHouseholdData.js';
import { computeNetBalances, suggestSettlements, totalOutstanding } from '../lib/balances.js';
import { recordSettlement, confirmSettlement, reverseSettlement } from '../services/settlements.js';
import { formatPaise, parseAmountToPaise } from '../lib/money.js';
import { isoDate } from '../lib/recurrence.js';
import { Spinner, Modal, Amount, Avatar, EmptyState, ConfirmDialog } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Balances() {
  const { user } = useAuth();
  const { activeId, members, myRole, memberName } = useHousehold();
  const { data: expenses, loading: le } = useExpenses();
  const { data: settlements, loading: ls } = useSettlements();
  const toast = useToast();
  const [showForm, setShowForm] = useState(null); // {from, to, amountPaise} prefill or {}
  const [reversing, setReversing] = useState(null);
  const [busy, setBusy] = useState(false);

  const { net, suggestions, outstanding } = useMemo(() => {
    if (!expenses || !settlements) return { net: {}, suggestions: [], outstanding: 0 };
    const net = computeNetBalances(
      expenses.map((e) => ({ payers: e.payers, shares: e.shares, deleted: e.deleted })),
      settlements.map((s) => ({ from: s.from, to: s.to, amountPaise: s.amountPaise, reversed: s.reversed }))
    );
    return { net, suggestions: suggestSettlements(net), outstanding: totalOutstanding(net) };
  }, [expenses, settlements]);

  if (le || ls) return <Spinner label="Computing balances…" />;

  const mine = net[user.uid] || 0;
  const canManageOthers = ['owner', 'admin'].includes(myRole);

  return (
    <>
      <div className="section-head">
        <h1>Balances</h1>
        <button className="btn" onClick={() => setShowForm({})}>Record settlement</button>
      </div>

      <div className="grid grid-3">
        <div className="card stat">
          <span className="label">Your position</span>
          <span className="value"><Amount paise={mine} signed /></span>
          <span className="sub">{mine > 0 ? 'you are owed' : mine < 0 ? 'you owe' : 'settled up'}</span>
        </div>
        <div className="card stat">
          <span className="label">Household outstanding</span>
          <span className="value">{formatPaise(outstanding)}</span>
          <span className="sub">total currently owed between members</span>
        </div>
        <div className="card stat">
          <span className="label">Suggested transfers</span>
          <span className="value">{suggestions.length}</span>
          <span className="sub">to settle everyone up</span>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="card">
          <div className="card-title"><h3>Member net balances</h3></div>
          {members.map((m) => {
            const v = net[m.uid] || 0;
            return (
              <div className="list-row" key={m.uid}>
                <span className="member-chip grow">
                  <Avatar name={m.displayName} photoURL={m.photoURL} />
                  {m.displayName} {m.uid === user.uid && <span className="badge badge-grey">you</span>}
                </span>
                <Amount paise={v} signed />
              </div>
            );
          })}
          <p className="hint" style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '0.5rem' }}>
            Positive = is owed money · negative = owes money. Computed from the full expense & settlement ledger.
          </p>
        </div>

        <div className="card">
          <div className="card-title"><h3>Suggested settlements</h3></div>
          {suggestions.length === 0 ? (
            <EmptyState title="All settled" hint="No repayments needed right now." />
          ) : (
            suggestions.map((s, i) => (
              <div className="list-row" key={i}>
                <span className="grow">
                  <strong>{memberName(s.from)}</strong> pays <strong>{memberName(s.to)}</strong>
                </span>
                <span>{formatPaise(s.amountPaise)}</span>
                {(s.from === user.uid || s.to === user.uid || canManageOthers) && (
                  <button className="btn btn-sm btn-secondary" onClick={() => setShowForm(s)}>Record</button>
                )}
              </div>
            ))
          )}
          <p className="hint" style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '0.5rem' }}>
            Settlements are bookkeeping records of repayment — RoomSync does not move money.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-title"><h3>Settlement history</h3></div>
        {settlements.length === 0 ? (
          <EmptyState title="No settlements recorded yet" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th><th>From</th><th>To</th><th className="num">Amount</th><th>Status</th><th>Note</th><th></th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id} style={s.reversed ? { opacity: 0.55 } : undefined}>
                    <td>{s.date}</td>
                    <td>{memberName(s.from)}</td>
                    <td>{memberName(s.to)}</td>
                    <td className="num">{formatPaise(s.amountPaise)}</td>
                    <td>
                      {s.reversed ? (
                        <span className="badge badge-red">reversed</span>
                      ) : s.status === 'confirmed' ? (
                        <span className="badge">confirmed</span>
                      ) : (
                        <span className="badge badge-amber">recorded</span>
                      )}
                    </td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.note}</td>
                    <td>
                      {!s.reversed && (
                        <span style={{ display: 'flex', gap: '0.3rem' }}>
                          {s.status !== 'confirmed' && s.to === user.uid && (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={async () => {
                                await confirmSettlement(activeId, s.id);
                                toast('Settlement confirmed');
                              }}
                            >
                              Confirm
                            </button>
                          )}
                          {(s.createdBy === user.uid || s.from === user.uid || s.to === user.uid || canManageOthers) && (
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red-600)' }} onClick={() => setReversing(s)}>
                              Reverse
                            </button>
                          )}
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
        <SettlementForm
          members={members}
          prefill={showForm}
          currentUid={user.uid}
          canManageOthers={canManageOthers}
          onClose={() => setShowForm(null)}
          onSave={async (data) => {
            await recordSettlement(activeId, data);
            toast('Settlement recorded');
            setShowForm(null);
          }}
        />
      )}

      {reversing && (
        <ConfirmDialog
          title="Reverse settlement?"
          message={`Reversing restores ${formatPaise(reversing.amountPaise)} to the outstanding balance between ${memberName(reversing.from)} and ${memberName(reversing.to)}. The record is kept in history.`}
          confirmLabel="Reverse"
          danger
          busy={busy}
          onCancel={() => setReversing(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await reverseSettlement(activeId, reversing.id);
              toast('Settlement reversed');
              setReversing(null);
            } catch (err) {
              toast.error(err.message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

function SettlementForm({ members, prefill, currentUid, canManageOthers, onClose, onSave }) {
  const [from, setFrom] = useState(prefill.from || currentUid);
  const [to, setTo] = useState(prefill.to || members.find((m) => m.uid !== currentUid)?.uid || '');
  const [amount, setAmount] = useState(prefill.amountPaise ? (prefill.amountPaise / 100).toFixed(2) : '');
  const [date, setDate] = useState(isoDate(new Date()));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const amountPaise = parseAmountToPaise(amount);
    if (amountPaise === null || amountPaise <= 0) return setError('Enter a valid amount.');
    if (from === to) return setError('Payer and receiver must differ.');
    if (!canManageOthers && from !== currentUid && to !== currentUid) {
      return setError('You can only record settlements that involve you.');
    }
    setBusy(true);
    try {
      await onSave({ from, to, amountPaise, date, note });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Record settlement" onClose={onClose}>
      <p style={{ color: 'var(--text-soft)', fontSize: '0.85rem' }}>
        Record that a repayment happened outside the app (cash, UPI, bank). This does not transfer money.
      </p>
      <form onSubmit={submit}>
        <div className="form-row">
          <div className="field">
            <label>Payer (who paid back)</label>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {members.map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Receiver</label>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {members.map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Amount (₹)</label>
            <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UPI transfer" />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Record settlement'}</button>
        </div>
      </form>
    </Modal>
  );
}
