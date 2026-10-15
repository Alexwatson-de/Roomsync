// ExpenseForm — add/edit an expense with all four split methods.
// All validation happens on integer paise; the preview shows the exact
// computed shares so users see where remainder paise land.

import { useMemo, useState } from 'react';
import { uploadsEnabled } from '../firebase.js';
import { Modal, MemberSelect, Amount } from './ui.jsx';
import { parseAmountToPaise, formatPaise } from '../lib/money.js';
import { computeShares } from '../lib/splits.js';
import { EXPENSE_CATEGORIES } from '../lib/constants.js';
import { isoDate } from '../lib/recurrence.js';

export default function ExpenseForm({ members, initial, onSave, onClose, title = 'Add expense' }) {
  const [form, setForm] = useState(() => ({
    title: initial?.title || '',
    amount: initial ? (initial.totalPaise / 100).toFixed(2) : '',
    date: initial?.date || isoDate(new Date()),
    category: initial?.category || 'Groceries',
    paidBy: initial ? Object.keys(initial.payers)[0] : members[0]?.uid || '',
    participants: initial?.participants || members.map((m) => m.uid),
    splitMethod: initial?.splitMethod || 'equal',
    description: initial?.description || '',
  }));
  // Per-member inputs for custom (₹), percentage (%), shares (int)
  const [detailInputs, setDetailInputs] = useState(() => {
    const init = {};
    if (initial?.splitDetail) {
      for (const [uid, v] of Object.entries(initial.splitDetail)) {
        init[uid] =
          initial.splitMethod === 'custom' ? (v / 100).toFixed(2) : String(v);
      }
    }
    return init;
  });
  const [receiptFile, setReceiptFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const totalPaise = parseAmountToPaise(form.amount);

  // Build method-specific detail from inputs (integer paise / numbers)
  const buildDetail = () => {
    if (form.splitMethod === 'equal') return null;
    const detail = {};
    for (const uid of form.participants) {
      const raw = detailInputs[uid];
      if (raw === undefined || raw === '') throw new Error('Fill in a value for every participant.');
      if (form.splitMethod === 'custom') {
        const p = parseAmountToPaise(raw);
        if (p === null) throw new Error('Custom amounts must be valid rupee amounts.');
        detail[uid] = p;
      } else if (form.splitMethod === 'percentage') {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) throw new Error('Percentages must be non-negative numbers.');
        detail[uid] = n;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) throw new Error('Shares must be positive whole numbers.');
        detail[uid] = n;
      }
    }
    return detail;
  };

  // Live preview of computed shares
  const preview = useMemo(() => {
    if (!totalPaise || form.participants.length === 0) return null;
    try {
      const detail = buildDetail();
      return computeShares(form.splitMethod, totalPaise, form.participants, detail);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPaise, form.participants, form.splitMethod, detailInputs]);

  const memberName = (uid) => members.find((m) => m.uid === uid)?.displayName || uid;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (!form.title.trim()) throw new Error('Title is required.');
      if (totalPaise === null || totalPaise <= 0) throw new Error('Enter a valid amount (e.g. 1200 or 1200.50).');
      if (form.participants.length === 0) throw new Error('Select at least one participant.');
      if (!form.paidBy) throw new Error('Select who paid.');
      const detail = buildDetail();
      // validate split up-front for a clear error message
      computeShares(form.splitMethod, totalPaise, form.participants, detail);
      setBusy(true);
      await onSave(
        {
          title: form.title,
          category: form.category,
          date: form.date,
          totalPaise,
          payers: { [form.paidBy]: totalPaise },
          participants: form.participants,
          splitMethod: form.splitMethod,
          splitDetail: detail,
          description: form.description,
        },
        receiptFile
      );
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-row">
          <div className="field">
            <label>Title</label>
            <input required value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Electricity bill" />
          </div>
          <div className="field">
            <label>Amount (₹)</label>
            <input required inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="1200.00" />
          </div>
        </div>
        <div className="form-row">
          <div className="field">
            <label>Date</label>
            <input type="date" required value={form.date} onChange={(e) => set('date', e.target.value)} />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Paid by</label>
          <select value={form.paidBy} onChange={(e) => set('paidBy', e.target.value)}>
            {members.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>

        <MemberSelect members={members} selected={form.participants} onChange={(p) => set('participants', p)} />

        <div className="field">
          <label>Split method</label>
          <div className="segmented">
            {[
              ['equal', 'Equal'],
              ['custom', 'Amounts'],
              ['percentage', 'Percent'],
              ['shares', 'Shares'],
            ].map(([k, label]) => (
              <button key={k} type="button" className={form.splitMethod === k ? 'active' : ''} onClick={() => set('splitMethod', k)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {form.splitMethod !== 'equal' && (
          <div className="field">
            <label>
              {form.splitMethod === 'custom' && 'Amount per member (₹) — must add up to the total'}
              {form.splitMethod === 'percentage' && 'Percentage per member — must add up to 100%'}
              {form.splitMethod === 'shares' && 'Shares per member (whole numbers)'}
            </label>
            {form.participants.map((uid) => (
              <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                <span style={{ flex: 1, fontSize: '0.88rem' }}>{memberName(uid)}</span>
                <input
                  style={{ width: 110 }}
                  inputMode="decimal"
                  value={detailInputs[uid] || ''}
                  onChange={(e) => setDetailInputs((d) => ({ ...d, [uid]: e.target.value }))}
                  placeholder={form.splitMethod === 'custom' ? '0.00' : form.splitMethod === 'percentage' ? '%' : '1'}
                />
              </div>
            ))}
          </div>
        )}

        {preview && (
          <div className="card" style={{ background: 'var(--green-50)', boxShadow: 'none', padding: '0.7rem 0.9rem' }}>
            <strong style={{ fontSize: '0.82rem' }}>Share preview</strong>
            {Object.entries(preview).map(([uid, share]) => (
              <div key={uid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span>{memberName(uid)}</span>
                <span>{formatPaise(share)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="field" style={{ marginTop: '0.8rem' }}>
          <label>Description (optional)</label>
          <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="field">
          <label>Receipt image (optional)</label>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!uploadsEnabled} onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
          {!uploadsEnabled && <span className="hint">Receipt uploads need Firebase Storage setup (Blaze billing and a bucket). Expenses work without an image.</span>}
        </div>

        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : 'Save expense'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
