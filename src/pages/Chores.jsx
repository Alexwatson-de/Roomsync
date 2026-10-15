// Chores — assignment, recurrence, rotation, history, workload summary.
import { useMemo, useState } from 'react';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { useChores } from '../hooks/useHouseholdData.js';
import { createChore, updateChore, deleteChore, completeChore } from '../services/chores.js';
import { isoDate } from '../lib/recurrence.js';
import { CHORE_PRIORITIES } from '../lib/constants.js';
import { Spinner, Modal, EmptyState, MemberSelect, ConfirmDialog, Avatar } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';

const PRIORITY_BADGE = { high: 'badge badge-red', medium: 'badge badge-amber', low: 'badge badge-grey' };

export default function Chores() {
  const { activeId, members, memberName } = useHousehold();
  const { data: chores, loading } = useChores();
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const today = isoDate(new Date());

  const { pending, overdue, completed, workload } = useMemo(() => {
    const all = chores || [];
    const pending = all.filter((c) => !c.completedAt && c.dueDate >= today);
    const overdue = all.filter((c) => !c.completedAt && c.dueDate < today);
    const completed = all
      .filter((c) => c.completedAt)
      .sort((a, b) => (b.completedAt?.seconds || 0) - (a.completedAt?.seconds || 0));
    const workload = {};
    for (const c of completed) {
      if (c.completedBy) workload[c.completedBy] = (workload[c.completedBy] || 0) + 1;
    }
    return { pending, overdue, completed, workload };
  }, [chores, today]);

  if (loading) return <Spinner label="Loading chores…" />;

  const lists = { pending: [...overdue, ...pending], completed };
  const list = lists[tab];

  return (
    <>
      <div className="section-head">
        <h1>Chores</h1>
        <button className="btn" onClick={() => setShowForm(true)}>+ Add chore</button>
      </div>

      <div className="grid grid-3">
        <div className="card stat">
          <span className="label">Pending</span>
          <span className="value">{pending.length}</span>
        </div>
        <div className="card stat">
          <span className="label">Overdue</span>
          <span className="value" style={{ color: overdue.length ? 'var(--red-600)' : undefined }}>{overdue.length}</span>
        </div>
        <div className="card stat">
          <span className="label">Completed</span>
          <span className="value">{completed.length}</span>
        </div>
      </div>

      <div style={{ margin: '1rem 0 0.8rem' }}>
        <div className="segmented">
          <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>Pending</button>
          <button className={tab === 'completed' ? 'active' : ''} onClick={() => setTab('completed')}>History</button>
        </div>
      </div>

      <div className="card">
        {list.length === 0 ? (
          <EmptyState
            icon="✓"
            title={tab === 'pending' ? 'No pending chores' : 'No completed chores yet'}
            hint={tab === 'pending' ? 'Add chores and assign them to household members.' : 'Completed chores appear here with who did them.'}
          />
        ) : (
          list.map((c) => (
            <div className="list-row" key={c.id}>
              <div className="grow">
                <div className="title">
                  {c.title}{' '}
                  <span className={PRIORITY_BADGE[c.priority] || 'badge badge-grey'}>{c.priority}</span>{' '}
                  {c.recurrence !== 'one-time' && <span className="badge badge-blue">{c.recurrence}{c.rotation?.length ? ' · rotates' : ''}</span>}
                </div>
                <div className="sub">
                  {tab === 'pending' ? (
                    <>
                      {(c.assignees || []).map(memberName).join(', ') || 'Unassigned'} · due {c.dueDate}
                      {c.dueDate < today && <strong style={{ color: 'var(--red-600)' }}> · overdue</strong>}
                    </>
                  ) : (
                    <>done by {c.completedByName || memberName(c.completedBy)} {c.completedAt?.toDate ? `· ${c.completedAt.toDate().toLocaleString()}` : ''}</>
                  )}
                  {c.instructions && <> · {c.instructions}</>}
                </div>
              </div>
              {tab === 'pending' && (
                <span style={{ display: 'flex', gap: '0.3rem' }}>
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      const nextId = await completeChore(activeId, c);
                      toast('Chore completed');
                      if (nextId) toast.info('Next occurrence scheduled' + (c.rotation?.length ? ' — rotated to the next member' : ''));
                    }}
                  >
                    Done
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}>Edit</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red-600)' }} onClick={() => setDeleting(c)}>Delete</button>
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {Object.keys(workload).length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="card-title"><h3>Workload summary</h3></div>
          <p className="hint" style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginBottom: '0.5rem' }}>
            Count of recorded completed chores per member — a bookkeeping count, not a definitive measure of fairness.
          </p>
          {Object.entries(workload)
            .sort((a, b) => b[1] - a[1])
            .map(([uid, count]) => {
              const m = members.find((x) => x.uid === uid);
              const max = Math.max(...Object.values(workload));
              return (
                <div className="list-row" key={uid}>
                  <span className="member-chip" style={{ width: 160 }}>
                    <Avatar name={m?.displayName || 'Former member'} uid={uid} profile={m} />
                    {m?.displayName || 'Former member'}
                  </span>
                  <div className="grow progress-track">
                    <div className="progress-fill" style={{ width: `${(count / max) * 100}%` }} />
                  </div>
                  <span style={{ width: 30, textAlign: 'right' }}>{count}</span>
                </div>
              );
            })}
        </div>
      )}

      {(showForm || editing) && (
        <ChoreForm
          members={members}
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={async (data) => {
            if (editing) {
              await updateChore(activeId, editing.id, data);
              toast('Chore updated');
            } else {
              await createChore(activeId, data);
              toast('Chore created');
            }
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete chore?"
          message={`"${deleting.title}" will be removed.`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await deleteChore(activeId, deleting.id);
              toast('Chore deleted');
              setDeleting(null);
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

function ChoreForm({ members, initial, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    title: initial?.title || '',
    instructions: initial?.instructions || '',
    assignees: initial?.assignees || [],
    dueDate: initial?.dueDate || isoDate(new Date()),
    recurrence: initial?.recurrence || 'one-time',
    priority: initial?.priority || 'medium',
    useRotation: !!initial?.rotation?.length,
    rotation: initial?.rotation || [],
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) return setError('Title is required.');
    if (form.useRotation && form.rotation.length < 2) return setError('A rotation needs at least 2 members.');
    if (!form.useRotation && form.assignees.length === 0) return setError('Assign at least one member.');
    setBusy(true);
    try {
      await onSave({
        title: form.title,
        instructions: form.instructions,
        assignees: form.assignees,
        dueDate: form.dueDate,
        recurrence: form.recurrence,
        priority: form.priority,
        rotation: form.useRotation ? form.rotation : null,
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? 'Edit chore' : 'Add chore'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Title</label>
          <input required value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Clean the kitchen" />
        </div>
        <div className="field">
          <label>Instructions (optional)</label>
          <textarea rows={2} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} />
        </div>
        <div className="form-row">
          <div className="field">
            <label>Due date</label>
            <input type="date" required value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </div>
          <div className="field">
            <label>Recurrence</label>
            <select value={form.recurrence} onChange={(e) => set('recurrence', e.target.value)} disabled={!!initial}>
              <option value="one-time">One-time</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="field">
            <label>Priority</label>
            <select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              {CHORE_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {form.recurrence !== 'one-time' && (
          <label className="checkbox-row">
            <input type="checkbox" checked={form.useRotation} onChange={(e) => set('useRotation', e.target.checked)} />
            Rotate between members each occurrence
          </label>
        )}

        {form.useRotation && form.recurrence !== 'one-time' ? (
          <MemberSelect members={members} selected={form.rotation} onChange={(r) => set('rotation', r)} label="Rotation order (selection order = rotation order)" />
        ) : (
          <MemberSelect members={members} selected={form.assignees} onChange={(a) => set('assignees', a)} label="Assigned to" />
        )}

        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save chore'}</button>
        </div>
      </form>
    </Modal>
  );
}
