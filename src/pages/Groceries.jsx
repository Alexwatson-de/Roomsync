// Groceries — shared shopping list with purchase → optional expense link.
import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { useGroceryItems } from '../hooks/useHouseholdData.js';
import { addItem, updateItem, removeItem, markPurchased, unmarkPurchased } from '../services/groceries.js';
import { GROCERY_CATEGORIES } from '../lib/constants.js';
import { parseAmountToPaise, formatPaise } from '../lib/money.js';
import { isoDate } from '../lib/recurrence.js';
import { Spinner, Modal, EmptyState, MemberSelect } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';

export default function Groceries() {
  const { user } = useAuth();
  const { activeId, members, memberName } = useHousehold();
  const { data: items, loading } = useGroceryItems();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [buying, setBuying] = useState(null);
  const [fCategory, setFCategory] = useState('');
  const [fStatus, setFStatus] = useState('open');

  const filtered = useMemo(() => {
    let list = items || [];
    if (fCategory) list = list.filter((i) => i.category === fCategory);
    if (fStatus === 'open') list = list.filter((i) => !i.purchased);
    if (fStatus === 'purchased') list = list.filter((i) => i.purchased);
    return list;
  }, [items, fCategory, fStatus]);

  if (loading) return <Spinner label="Loading shopping list…" />;

  const openCount = (items || []).filter((i) => !i.purchased).length;

  return (
    <>
      <div className="section-head">
        <h1>Groceries</h1>
        <button className="btn" onClick={() => setShowForm(true)}>+ Add item</button>
      </div>

      <div className="filters-bar card" style={{ padding: '0.8rem' }}>
        <div className="field">
          <label>Status</label>
          <div className="segmented">
            <button className={fStatus === 'open' ? 'active' : ''} onClick={() => setFStatus('open')}>To buy ({openCount})</button>
            <button className={fStatus === 'purchased' ? 'active' : ''} onClick={() => setFStatus('purchased')}>Purchased</button>
            <button className={fStatus === 'all' ? 'active' : ''} onClick={() => setFStatus('all')}>All</button>
          </div>
        </div>
        <div className="field">
          <label>Category</label>
          <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
            <option value="">All</option>
            {GROCERY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <EmptyState
            icon="▤"
            title={fStatus === 'purchased' ? 'Nothing purchased yet' : 'Shopping list is empty'}
            hint="Items are shared with household members through real-time Firestore updates."
            action={fStatus !== 'purchased' && <button className="btn" onClick={() => setShowForm(true)}>Add an item</button>}
          />
        ) : (
          filtered.map((i) => (
            <div className="list-row" key={i.id} style={i.purchased ? { opacity: 0.65 } : undefined}>
              <input
                type="checkbox"
                checked={i.purchased}
                style={{ accentColor: 'var(--green-600)', width: 17, height: 17 }}
                onChange={() => {
                  if (i.purchased) {
                    unmarkPurchased(activeId, i.id).then(() => toast('Moved back to the list')).catch((error) => toast.error(error.message));
                  } else {
                    setBuying(i);
                  }
                }}
              />
              <div className="grow">
                <div className="title" style={i.purchased ? { textDecoration: 'line-through' } : undefined}>
                  {i.name} {i.quantity && <span style={{ color: 'var(--text-soft)', fontWeight: 400 }}>· {i.quantity} {i.unit}</span>}
                </div>
                <div className="sub">
                  <span className="badge badge-grey">{i.category}</span>
                  {i.assignedTo && <> · {memberName(i.assignedTo)} buys</>}
                  {i.notes && <> · {i.notes}</>}
                  {i.purchased && (
                    <>
                      {' '}· bought by {i.purchasedByName || memberName(i.purchasedBy)}
                      {i.pricePaise !== null && <> for {formatPaise(i.pricePaise)}</>}
                      {i.expenseId && <span className="badge" style={{ marginLeft: 4 }}>in expenses</span>}
                    </>
                  )}
                </div>
              </div>
              {!i.purchased && (
                <span style={{ display: 'flex', gap: '0.3rem' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(i)}>Edit</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red-600)' }}
                    onClick={async () => { await removeItem(activeId, i.id); toast('Item removed'); }}>
                    Remove
                  </button>
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {(showForm || editing) && (
        <ItemForm
          members={members}
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={async (data) => {
            if (editing) {
              await updateItem(activeId, editing.id, data);
              toast('Item updated');
            } else {
              await addItem(activeId, data);
              toast('Item added');
            }
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {buying && (
        <PurchaseModal
          item={buying}
          members={members}
          currentUid={user.uid}
          onClose={() => setBuying(null)}
          onSave={async ({ pricePaise, paidBy, recordExpense, participants }) => {
            let expenseInput = null;
            if (recordExpense && pricePaise) {
              expenseInput = {
                title: `${buying.name} (groceries)`,
                category: 'Groceries',
                date: isoDate(new Date()),
                totalPaise: pricePaise,
                payers: { [paidBy]: pricePaise },
                participants,
                splitMethod: 'equal',
                splitDetail: null,
                description: `Purchased from the shared shopping list`,
              };
            }
            await markPurchased(activeId, buying, { pricePaise, paidBy: paidBy || null, expenseInput });
            toast(recordExpense && pricePaise ? 'Purchased and added to expenses' : 'Marked purchased');
            setBuying(null);
          }}
        />
      )}
    </>
  );
}

function ItemForm({ members, initial, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    quantity: initial?.quantity || '',
    unit: initial?.unit || '',
    category: initial?.category || 'Vegetables',
    notes: initial?.notes || '',
    assignedTo: initial?.assignedTo || '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Item name is required.');
    setBusy(true);
    try {
      await onSave({ ...form, assignedTo: form.assignedTo || null });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? 'Edit item' : 'Add grocery item'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Item</label>
          <input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Tomatoes" />
        </div>
        <div className="form-row">
          <div className="field">
            <label>Quantity</label>
            <input value={form.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="2" />
          </div>
          <div className="field">
            <label>Unit</label>
            <input value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="kg" />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {GROCERY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Who buys it?</label>
            <select value={form.assignedTo} onChange={(e) => set('assignedTo', e.target.value)}>
              <option value="">Anyone</option>
              {members.map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Notes</label>
            <input value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="brand, size…" />
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save item'}</button>
        </div>
      </form>
    </Modal>
  );
}

function PurchaseModal({ item, members, currentUid, onClose, onSave }) {
  const [price, setPrice] = useState('');
  const [paidBy, setPaidBy] = useState(currentUid);
  const [recordExpense, setRecordExpense] = useState(false);
  const [participants, setParticipants] = useState(members.map((m) => m.uid));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    let pricePaise = null;
    if (price !== '') {
      pricePaise = parseAmountToPaise(price);
      if (pricePaise === null) return setError('Enter a valid price or leave it empty.');
    }
    if (recordExpense && !pricePaise) return setError('A price is needed to record an expense.');
    if (recordExpense && participants.length === 0) return setError('Select who shares the cost.');
    setBusy(true);
    try {
      await onSave({ pricePaise, paidBy, recordExpense, participants });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Purchased: ${item.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-row">
          <div className="field">
            <label>Price (₹, optional)</label>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="field">
            <label>Paid by</label>
            <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {members.map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
            </select>
          </div>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={recordExpense} onChange={(e) => setRecordExpense(e.target.checked)} />
          Record as a shared expense (updates balances)
        </label>
        {recordExpense && (
          <MemberSelect members={members} selected={participants} onChange={setParticipants} label="Split equally between" />
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Confirm purchase'}</button>
        </div>
      </form>
    </Modal>
  );
}
