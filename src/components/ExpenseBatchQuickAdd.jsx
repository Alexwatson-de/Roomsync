// One parsed batch, one expense modal at a time, one atomic final submission.
// No raw prompt/draft writes. Confirmed payloads only are kept in tab-scoped
// sessionStorage so reloads/lost acknowledgements can retry the SAME IDs.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './ui.jsx';
import ExpenseForm from './ExpenseForm.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { parseExpenseBatch, duplicateExpenseGroups, MAX_BATCH_EXPENSES } from '../lib/expenseBatch.js';
import { buildExpenseData } from '../lib/expenseData.js';
import { formatPaise } from '../lib/money.js';
import { prepareExpenseBatch, saveExpenseBatch, checkExpenseBatch } from '../services/expenseBatches.js';
import '../styles/expense-batch.css';
const example = 'I paid 2500 for groceries, 300 for electricity, and 800 for dinner yesterday.';
const remember = (key, value) => sessionStorage.setItem(key, JSON.stringify(value));
function readPending(key) {
  try { const value = JSON.parse(sessionStorage.getItem(key)); return value?.batchId && value?.fingerprint && value?.items?.length ? value : null; } catch { return null; }
}
function summaryValidation(items, members) {
  return items.filter((item) => !item.skipped).map((item) => {
    try {
      const value = buildExpenseData(item.input);
      if ([...value.participants, ...value.payerIds].some((uid) => !members.some((member) => member.uid === uid))) throw new Error('A payer/participant is not a current member.');
      if (!item.reviewed) throw new Error('Review this expense before confirming.');
      return { ...item, input: value };
    } catch (error) { return { ...item, error: error.message }; }
  });
}
export default function ExpenseBatchQuickAdd() {
  const { user } = useAuth();
  const { activeId, household, members, memberName } = useHousehold();
  const storageKey = `roomsync.confirmed-expense-batch:${user.uid}:${activeId}`;
  const [confirmed, setConfirmed] = useState(() => readPending(storageKey));
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState(confirmed ? 'submission' : 'input');
  const [prompt, setPrompt] = useState('');
  const [useToday, setUseToday] = useState(false);
  const [useEqualHousehold, setUseEqualHousehold] = useState(false);
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [batchId, setBatchId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [discard, setDiscard] = useState(false);
  const [duplicatesAccepted, setDuplicatesAccepted] = useState(false);
  const valid = useMemo(() => summaryValidation(items, members), [items, members]);
  const duplicates = useMemo(() => duplicateExpenseGroups(items), [items]);
  const current = items[index];
  useEffect(() => {
    if (!busy) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  function reset() {
    setItems([]); setIndex(0); setPrompt(''); setPhase('input'); setError(''); setDiscard(false); setOutcome(null); setBatchId(crypto.randomUUID()); setDuplicatesAccepted(false); setOpen(false);
  }
  function close() {
    if (busyRef.current) return;
    if (confirmed) { setOpen(false); return; } // retain a confirmed request for safe retry
    if (items.length || prompt.trim()) setDiscard(true); else setOpen(false);
  }
  async function parse(event) {
    event.preventDefault(); if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      // Yield for the accessible parsing state without implying a model call.
      await new Promise((resolve) => setTimeout(resolve, 0));
      setItems(parseExpenseBatch(prompt, { members, currentUid: user.uid, useToday, useEqualHousehold }));
      setIndex(0); setPhase('review'); setDuplicatesAccepted(false);
    } catch (failure) { setError(failure.message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function editRaw(id, raw) {
    setItems((previous) => previous.map((item) => item.id !== id || JSON.stringify(item.editorState) === JSON.stringify(raw) ? item : { ...item, editorState: raw, reviewed: false }));
  }
  function next(input) {
    setItems((previous) => previous.map((item, i) => i === index ? { ...item, input, reviewed: true, skipped: false } : item));
    setDuplicatesAccepted(false);
    if (index < items.length - 1) setIndex(index + 1); else setPhase('summary');
  }
  function skip() {
    setItems((previous) => previous.map((item, i) => i === index ? { ...item, skipped: true, reviewed: false } : item));
    if (index < items.length - 1) setIndex(index + 1); else setPhase('summary');
  }
  function remove() {
    const nextItems = items.filter((_, i) => i !== index); setItems(nextItems); setDuplicatesAccepted(false);
    if (!nextItems.length || index >= nextItems.length) setPhase('summary');
  }
  async function submit() {
    if (busyRef.current || !valid.length || valid.some((item) => item.error) || (duplicates.length && !duplicatesAccepted)) return;
    busyRef.current = true; setBusy(true); setError('');
    let request;
    try {
      request = await prepareExpenseBatch(activeId, batchId, valid.map(({ id, input }) => ({ id, input })));
      // Only after explicit Add All confirmation. If retry identity cannot be
      // retained, do NOT start a financial write that would be unsafe on reload.
      remember(storageKey, request);
      setConfirmed(request); setPhase('submission');
    } catch (failure) { setError(`Nothing was submitted. ${failure.message}`); busyRef.current = false; setBusy(false); return; }
    await runSave(request);
  }
  async function runSave(request) {
    try { const result = await saveExpenseBatch(request); setOutcome(result); setError(''); }
    catch (failure) {
      setOutcome({ state: 'unknown', ids: [] });
      setError(`${failure.message} The batch is atomic: this attempt cannot save a subset. Its acknowledgement may be unknown. Check saved status or retry the identical confirmed batch—do not recreate these expenses manually.`);
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function retry() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    await runSave(confirmed);
  }
  async function check() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { setOutcome(await checkExpenseBatch(confirmed)); }
    catch (failure) { setError(`Saved status could not be verified: ${failure.message}. Keep this confirmed batch for a safe retry.`); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function done() {
    sessionStorage.removeItem(storageKey); setConfirmed(null); reset();
  }
  const identity = <p className="batch-household">Household: <strong>{household?.name || activeId}</strong> · All drafts remain unsaved until “Add All Expenses”.</p>;
  return <>
    <button className="btn btn-secondary" onClick={() => { setOpen(true); if (confirmed) setPhase('submission'); }} disabled={!activeId || !members.length}><span aria-hidden="true">✦</span> AI Quick Add</button>
    {open && discard ? <Modal title="Discard unsaved expense drafts?" onClose={() => setDiscard(false)}>
      <p>None of this batch has been saved. Discard the request and all its review steps?</p>
      <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDiscard(false)}>Keep reviewing</button><button className="btn btn-danger" onClick={reset}>Discard drafts</button></div>
    </Modal> : open && phase === 'input' ? <Modal title="AI Quick Add" onClose={close}>
      {identity}
      <p className="batch-disclosure"><strong>No AI provider is configured.</strong> Free local parsing is active, not an AI model. It supports common expense wording; unclear values must be completed during review. No request goes to an AI API.</p>
      <form onSubmit={parse}>
        <div className="field"><label htmlFor="batch-request">Describe your expenses</label><textarea id="batch-request" rows={5} maxLength={6000} required value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={example} disabled={busy} /></div>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setPrompt(example)}>Use example</button>
        <fieldset className="batch-defaults" disabled={busy}><legend>Optional defaults — applied only if you select them</legend>
          <label className="checkbox-row"><input type="checkbox" checked={useToday} onChange={(event) => setUseToday(event.target.checked)} />Use today for missing dates</label>
          <label className="checkbox-row"><input type="checkbox" checked={useEqualHousehold} onChange={(event) => setUseEqualHousehold(event.target.checked)} />Use equal split across current members when no split is stated</label>
        </fieldset>
        <p className="batch-disclosure">“I paid” means you. Unknown payers stay blank. Use YYYY-MM-DD/today/yesterday/tomorrow, or fill dates later. For named allocations: “split unequally: me 700, Rahul 800”. At most {MAX_BATCH_EXPENSES} expenses and 8 distinct members per atomic batch, within the existing rules. Missing or ambiguous details are never silently saved.</p>
        {error && <p role="alert" className="error-text">{error}</p>}
        <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button><button className="btn" disabled={busy || !prompt.trim()}>{busy ? 'Parsing expenses…' : 'Parse expenses'}</button></div>
        {busy && <p role="status">Preparing editable local drafts. Nothing is being saved.</p>}
      </form>
    </Modal> : open && phase === 'review' && current ? <ExpenseForm key={current.id} title={`Expense ${index + 1} of ${items.length}`} members={members} draft={current.input} editorState={current.editorState} onEditorChange={(raw) => editRaw(current.id, raw)} closeAfterSave={false}
      reviewNote={<div className="batch-review-note"><progress value={index + 1} max={items.length} aria-label="Expense review progress" />{identity}<p><strong>{current.skipped ? 'Previously skipped — save this review to include it.' : 'Review and edit this expense.'}</strong> Previous preserves edits; Skip excludes it until restored.</p><details><summary>Extracted source and clarification notes</summary><p>{current.source}</p>{!!current.notices.length && <ul>{current.notices.map((notice) => <li key={notice}>{notice}</li>)}</ul>}</details>{(!current.input.date || !current.input.splitMethod || !current.input.participants.length || !Object.keys(current.input.payers).length || !current.input.totalPaise) && <p role="note">Some details were not understood. Fill the blank fields, select members and choose a split to continue.</p>}</div>}
      onSave={next} onClose={close} onPrevious={index > 0 ? () => setIndex(index - 1) : undefined} onSkip={skip} onRemove={remove} submitLabel={index === items.length - 1 ? 'Review all expenses' : 'Next expense'} />
    : open && phase === 'summary' ? <Modal title="Confirm expense batch" onClose={close}>
      {identity}<p>Review the full batch below. <strong>No expenses have been added yet.</strong> All confirmed expenses, activity and relevant notifications save together, or none do.</p>
      <div className="batch-summary">{items.map((item, i) => {
        const checked = valid.find((value) => value.id === item.id);
        return <section key={item.id} className={`batch-summary-item ${item.skipped ? 'batch-skipped' : ''}`}>
          <div className="card-title"><h3>{i + 1}. {item.input.title || 'Untitled expense'} {item.skipped && <span className="badge badge-grey">Skipped</span>}</h3><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setIndex(i); setPhase('review'); }}>{item.skipped ? 'Restore / edit' : 'Edit'}</button></div>
          {!item.skipped && <><dl><dt>Amount</dt><dd>{formatPaise(item.input.totalPaise)}</dd><dt>Category</dt><dd>{item.input.category}</dd><dt>Payer</dt><dd>{Object.keys(item.input.payers || {}).map(memberName).join(', ') || 'Not selected'}</dd><dt>Date</dt><dd>{item.input.date || 'Not selected'}</dd><dt>Split</dt><dd>{item.input.splitMethod || 'Not selected'} · {item.input.participants.map(memberName).join(', ') || 'No participants'}</dd></dl>
            {checked?.input.shares && <ul className="batch-shares">{Object.entries(checked.input.shares).map(([uid, share]) => <li key={uid}>{memberName(uid)}: {formatPaise(share)}</li>)}</ul>}
            {checked?.error && <p className="error-text">{checked.error}</p>}
          </>}
        </section>;
      })}</div>
      {!valid.length && <p role="alert">No expenses are included. Restore an expense or cancel the batch.</p>}
      {!!duplicates.length && <label className="checkbox-row"><input type="checkbox" checked={duplicatesAccepted} onChange={(event) => setDuplicatesAccepted(event.target.checked)} />Some included expenses look identical. I checked these are separate, intentional expenses.</label>}
      <p><strong>Batch total: {formatPaise(valid.reduce((sum, item) => sum + (item.input.totalPaise || 0), 0))}</strong> · {valid.length} included / {items.filter((item) => item.skipped).length} skipped</p>
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="modal-footer">{items.length > 0 && <button className="btn btn-secondary" disabled={busy} onClick={() => { setIndex(items.length - 1); setPhase('review'); }}>Previous expense</button>}<button className="btn btn-secondary" disabled={busy} onClick={close}>Cancel batch</button><button className="btn" disabled={busy || !valid.length || valid.some((item) => item.error) || (duplicates.length > 0 && !duplicatesAccepted)} onClick={submit}>{busy ? 'Confirming batch…' : 'Add All Expenses'}</button></div>
    </Modal> : open && phase === 'submission' && confirmed ? <Modal title={outcome?.state === 'saved' ? 'Expenses added' : 'Confirmed batch status'} onClose={() => { if (!busyRef.current) setOpen(false); }}>
      <p>Household: <strong>{household?.name || confirmed.householdId}</strong> · {confirmed.items.length} confirmed expenses</p>
      {busy && <p role="status">Saving/checking the whole batch… Please keep this window open. Repeated clicks cannot create extra records.</p>}
      {outcome?.state === 'saved' ? <p role="status"><strong>All {confirmed.items.length} expenses were saved.</strong> {outcome.alreadySaved && 'The prior commit was found; no duplicates were added.'} Balances, reports, activity and notifications use the normal expense ledger.</p> : <>
        <p>The confirmed payload is locked in this tab for safe retry. Reloading does not generate new expense IDs. It is not sent to an AI service.</p>
        {outcome?.state === 'none' && <p role="status">The server currently reports <strong>0 of {confirmed.items.length}</strong> target records saved. Retry uses the same IDs, so a delayed prior commit will not be duplicated.</p>}
        {outcome?.state === 'conflict' && <p role="alert" className="error-text">{outcome.ids.length} target records exist, but the batch is incomplete or differs. No additional records will be written automatically. Contact the household administrator to inspect the IDs below; do not recreate the batch.</p>}
        {!outcome && <p>Submission outcome has not been checked. Use “Check saved status” first if you reloaded.</p>}
        {outcome?.state === 'unknown' && <p>Saved count is not yet verified. A transaction cannot save a subset, but a lost network acknowledgement can hide a complete commit.</p>}
      </>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <details><summary>Confirmed expenses and stable IDs</summary><ul>{confirmed.items.map((item) => <li key={item.id}>{item.input.title} · {formatPaise(item.input.totalPaise)}<br /><code>{item.documentId}</code>{outcome?.ids.includes(item.documentId) ? outcome.state === 'conflict' ? ' — target ID exists; contents require administrator review' : ' — found saved' : ''}</li>)}</ul></details>
      <div className="modal-footer">{outcome?.state === 'saved' ? <button className="btn" onClick={done}>Done</button> : <><button className="btn btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Close (keep retry)</button><button className="btn btn-secondary" disabled={busy} onClick={check}>Check saved status</button><button className="btn" disabled={busy || outcome?.state === 'conflict'} onClick={retry}>Retry Add All Expenses</button></>}</div>
    </Modal> : null}
  </>;
}
