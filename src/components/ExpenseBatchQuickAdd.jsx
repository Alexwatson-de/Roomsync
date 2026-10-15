// One parsed batch, one expense modal at a time, one atomic final submission.
// No raw prompt/draft writes. Confirmed payloads only are kept in tab-scoped
// sessionStorage so reloads/lost acknowledgements can retry the SAME IDs.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './ui.jsx';
import ExpenseForm from './ExpenseForm.jsx';
import { ItemForm } from '../pages/Groceries.jsx';
import { BillForm } from '../pages/Bills.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { duplicateExpenseGroups, MAX_BATCH_EXPENSES } from '../lib/expenseBatch.js';
import { DRAFT_TYPES, buildHouseholdDraft, draftPeople, changeDraftKind } from '../lib/householdDrafts.js';
import { geminiStatus, parseGeminiRecords, parseLocalRecords } from '../services/aiDrafts.js';
import { formatPaise } from '../lib/money.js';
import { prepareExpenseBatch, saveExpenseBatch, checkExpenseBatch } from '../services/expenseBatches.js';
import '../styles/expense-batch.css';
const example = 'Add 2 kg rice to my grocery list; create an electricity bill ₹300 due tomorrow monthly; I paid ₹800 for dinner yesterday split equally with everyone.';
const remember = (key, value) => sessionStorage.setItem(key, JSON.stringify(value));
function readPending(key) {
  try { const value = JSON.parse(sessionStorage.getItem(key)); return value?.batchId && value?.fingerprint && value?.items?.length ? value : null; } catch { return null; }
}
function summaryValidation(items, members) {
  return items.filter((item) => !item.skipped).map((item) => {
    try {
      const kind = item.kind || 'expense';
      const value = buildHouseholdDraft(kind, item.input);
      if (draftPeople(kind, value).some((uid) => !members.some((member) => member.uid === uid))) throw new Error('A referenced person is not a current household member.');
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
  const [aiStatus, setAiStatus] = useState({ configured: false });
  const [parser, setParser] = useState('local');
  const [providerUsed, setProviderUsed] = useState('local');
  const [consent, setConsent] = useState(false);
  const valid = useMemo(() => summaryValidation(items, members), [items, members]);
  const duplicates = useMemo(() => duplicateExpenseGroups(items), [items]);
  const current = items[index];
  useEffect(() => {
    let active = true;
    geminiStatus().then((status) => { if (active) { setAiStatus(status); setParser(status.configured ? 'gemini' : 'local'); } }).catch(() => { if (active) setAiStatus({ configured: false }); });
    return () => { active = false; };
  }, []);
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
      const options = { members, currentUid: user.uid, householdId: activeId, useToday, useEqualHousehold };
      if (parser === 'gemini') {
        if (!consent) throw new Error('Confirm sending this request and household member names to Google Gemini first, or choose local parsing.');
        const response = await parseGeminiRecords(prompt, options);
        setItems(response.items); setProviderUsed(`Gemini · ${response.model}`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
        setItems(parseLocalRecords(prompt, options)); setProviderUsed('Local parser (not AI)');
      }
      setIndex(0); setPhase('review'); setDuplicatesAccepted(false);
    } catch (failure) { setError(failure.message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function editRaw(id, raw) {
    setItems((previous) => previous.map((item) => item.id !== id || JSON.stringify(item.editorState) === JSON.stringify(raw) ? item : { ...item, editorState: raw, reviewed: false }));
  }
  function next(input) {
    const kind = current.kind || 'expense';
    const value = buildHouseholdDraft(kind, input);
    if (draftPeople(kind, value).some((uid) => !members.some((member) => member.uid === uid))) throw new Error('Select current household members only.');
    setItems((previous) => previous.map((item, i) => i === index ? { ...item, input: value, reviewed: true, skipped: false } : item));
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
      request = await prepareExpenseBatch(activeId, batchId, valid.map(({ id, input, kind }) => ({ id, input, kind: kind || 'expense' })));
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
  const mixed = items.some((item) => !item.skipped && item.kind && item.kind !== 'expense');
  const confirmedMixed = confirmed?.items.some((item) => item.kind && item.kind !== 'expense');
  const identity = <p className="batch-household">Household: <strong>{household?.name || activeId}</strong> · All drafts remain unsaved until the final Add All confirmation.</p>;
  const destination = current && <div className="batch-review-note">
    <progress value={index + 1} max={items.length} aria-label="Expense review progress" />{identity}
    <p>Parsed by: <strong>{providerUsed}</strong>. Review the destination—nothing saves just from parsing.</p>
    <div className="field"><label htmlFor="record-destination">Save this record to</label><select id="record-destination" value={current.kind || 'expense'} onChange={(event) => { const kind = event.target.value; setItems((previous) => previous.map((item, i) => i === index ? changeDraftKind(item, kind) : item)); }}>
      <option value="unknown">Choose section</option><option value="expense">Expenses — already paid/spent</option><option value="grocery">Groceries — shopping-list item</option><option value="bill">Bills — unpaid bill reminder</option>
    </select></div>
    <p><strong>{DRAFT_TYPES[current.kind || 'expense']}</strong>: {current.kind === 'grocery' ? 'Adds an unpurchased shopping-list item. No balance change or expense is created.' : current.kind === 'bill' ? 'Adds an unpaid bill/template. No balance change until you later record payment.' : current.kind === 'unknown' ? 'Choose what you meant before reviewing a form.' : 'Records money spent, affects balances. It does not silently add a shopping item or bill.'}</p>
    {current.skipped && <p>Previously skipped. Validate this review to include it again.</p>}
    <details><summary>Extracted source and clarification notes</summary><p>{current.source}</p>{!!current.notices.length && <ul>{current.notices.map((notice, i) => <li key={`${i}:${notice}`}>{notice}</li>)}</ul>}</details>
  </div>;
  const reviewProps = current && { key: `${current.id}:${current.kind || 'expense'}`, title: `Expense ${index + 1} of ${items.length}`, members, draft: current.input, editorState: current.editorState, onEditorChange: (raw) => editRaw(current.id, raw), reviewNote: destination, onSave: next, onClose: close, onPrevious: index > 0 ? () => setIndex(index - 1) : undefined, onSkip: skip, onRemove: remove, submitLabel: index === items.length - 1 ? 'Review all expenses' : 'Next expense' };
  return <>
    <button className="btn btn-secondary" onClick={() => { setOpen(true); if (confirmed) setPhase('submission'); }} disabled={!activeId || !members.length}><span aria-hidden="true">✦</span> AI Quick Add</button>
    {open && discard ? <Modal title="Discard unsaved expense drafts?" onClose={() => setDiscard(false)}>
      <p>None of this batch has been saved. Discard the request and all its review steps?</p>
      <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setDiscard(false)}>Keep reviewing</button><button className="btn btn-danger" onClick={reset}>Discard drafts</button></div>
    </Modal> : open && phase === 'input' ? <Modal title="AI Quick Add" onClose={close}>
      {identity}
      {aiStatus.configured ? <p className="batch-disclosure"><strong>Gemini is configured securely on the server.</strong> It suggests the destination and fields; you still review everything before saving. Shopping-list plans go to Groceries, bill reminders to Bills, and payments already made to Expenses.</p> : <p className="batch-disclosure"><strong>No AI provider is configured.</strong> Free local parsing is active, not an AI model. A deployed server endpoint is required for Gemini; missing data stays editable.</p>}
      <form onSubmit={parse}>
        <div className="field"><label htmlFor="batch-request">Describe your expenses</label><textarea id="batch-request" rows={5} maxLength={6000} required value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={example} disabled={busy} /></div>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setPrompt(example)}>Use example</button>
        <div className="field"><label htmlFor="draft-provider">Parsing method</label><select id="draft-provider" value={parser} disabled={busy} onChange={(event) => setParser(event.target.value)}><option value="gemini" disabled={!aiStatus.configured}>Gemini AI (server protected)</option><option value="local">Local parser (no data sent to AI)</option></select></div>
        {parser === 'gemini' && <label className="checkbox-row"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />Send this request and current member display names to Google Gemini for parsing. Do not include sensitive data; provider free-tier terms and quota limits apply.</label>}
        <fieldset className="batch-defaults" disabled={busy}><legend>Optional defaults — applied only if you select them</legend>
          <label className="checkbox-row"><input type="checkbox" checked={useToday} onChange={(event) => setUseToday(event.target.checked)} />Use today for missing dates</label>
          <label className="checkbox-row"><input type="checkbox" checked={useEqualHousehold} onChange={(event) => setUseEqualHousehold(event.target.checked)} />Use equal split across current members when no split is stated</label>
        </fieldset>
        <p className="batch-disclosure">“I paid” means you. Unknown payers stay blank. Use YYYY-MM-DD/today/yesterday/tomorrow, or fill dates later. For named allocations: “split unequally: me 700, Rahul 800”. At most {MAX_BATCH_EXPENSES} expenses and 8 distinct members per atomic batch, within the existing rules. Missing or ambiguous details are never silently saved.</p>
        {error && <p role="alert" className="error-text">{error}</p>}
        <div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button><button className="btn" disabled={busy || !prompt.trim()}>{busy ? 'Parsing expenses…' : 'Parse expenses'}</button></div>
        {busy && <p role="status">{parser === 'gemini' ? 'Gemini is preparing editable drafts via the authenticated server…' : 'Preparing editable local drafts…'} Nothing is being saved.</p>}
      </form>
    </Modal> : open && phase === 'review' && current ? current.kind === 'grocery' ? <ItemForm {...reviewProps} /> : current.kind === 'bill' ? <BillForm {...reviewProps} /> : current.kind === 'unknown' ? <Modal title={`Expense ${index + 1} of ${items.length}`} onClose={close}>{destination}<div className="modal-footer"><button className="btn btn-secondary" onClick={skip}>Skip expense</button><button className="btn btn-secondary" onClick={remove}>Remove expense</button></div></Modal> : <ExpenseForm {...reviewProps} closeAfterSave={false} />
    : open && phase === 'summary' ? <Modal title="Confirm expense batch" onClose={close}>
      {identity}<p>Review the full batch below. <strong>{mixed ? 'No records have been added yet.' : 'No expenses have been added yet.'}</strong> All confirmed records, activity and relevant notifications save together, or none do.</p>
      <div className="batch-summary">{items.map((item, i) => {
        const checked = valid.find((value) => value.id === item.id);
        return <section key={item.id} className={`batch-summary-item ${item.skipped ? 'batch-skipped' : ''}`}>
          <div className="card-title"><h3>{i + 1}. {item.input.title || item.input.name || 'Untitled record'} {item.skipped && <span className="badge badge-grey">Skipped</span>}</h3><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setIndex(i); setPhase('review'); }}>{item.skipped ? 'Restore / edit' : 'Edit'}</button></div>
          {!item.skipped && <><p><strong>Destination: {DRAFT_TYPES[item.kind || 'expense']}</strong>{item.kind === 'grocery' ? ' — unpurchased shopping-list item; no expense' : item.kind === 'bill' ? ' — unpaid bill; no expense' : ' — paid expense ledger'}</p>
            {item.kind === 'grocery' ? <dl><dt>Quantity</dt><dd>{item.input.quantity || 'Not specified'} {item.input.unit}</dd><dt>Category</dt><dd>{item.input.category}</dd><dt>Buyer</dt><dd>{item.input.assignedTo ? memberName(item.input.assignedTo) : 'Anyone'}</dd></dl> : <dl><dt>Amount</dt><dd>{formatPaise(item.input.totalPaise ?? item.input.expectedPaise)}</dd><dt>Category</dt><dd>{item.input.category}</dd><dt>{item.kind === 'bill' ? 'Responsible' : 'Payer'}</dt><dd>{item.kind === 'bill' ? item.input.assignedTo ? memberName(item.input.assignedTo) : 'Anyone' : Object.keys(item.input.payers || {}).map(memberName).join(', ') || 'Not selected'}</dd><dt>{item.kind === 'bill' ? 'Due date' : 'Date'}</dt><dd>{item.input.date || item.input.dueDate || 'Not selected'}</dd><dt>Split</dt><dd>{item.input.splitMethod || 'Not selected'} · {(item.input.participants || []).map(memberName).join(', ') || 'No participants'}</dd>{item.kind === 'bill' && <><dt>Recurrence</dt><dd>{item.input.recurrence}</dd></>}</dl>}
            {checked?.input.shares && <ul className="batch-shares">{Object.entries(checked.input.shares).map(([uid, share]) => <li key={uid}>{memberName(uid)}: {formatPaise(share)}</li>)}</ul>}
            {checked?.error && <p className="error-text">{checked.error}</p>}
          </>}
        </section>;
      })}</div>
      {!valid.length && <p role="alert">No expenses are included. Restore an expense or cancel the batch.</p>}
      {!!duplicates.length && <label className="checkbox-row"><input type="checkbox" checked={duplicatesAccepted} onChange={(event) => setDuplicatesAccepted(event.target.checked)} />Some included expenses look identical. I checked these are separate, intentional expenses.</label>}
      <p><strong>{mixed ? 'Paid expenses total' : 'Batch total'}: {formatPaise(valid.reduce((sum, item) => sum + (item.input.totalPaise || 0), 0))}</strong> · {valid.length} included / {items.filter((item) => item.skipped).length} skipped</p>
      {mixed && <p className="batch-disclosure">Bill expected amounts and shopping items are separate records—not added to expense totals. All chosen destinations save together in one transaction.</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="modal-footer">{items.length > 0 && <button className="btn btn-secondary" disabled={busy} onClick={() => { setIndex(items.length - 1); setPhase('review'); }}>Previous expense</button>}<button className="btn btn-secondary" disabled={busy} onClick={close}>Cancel batch</button><button className="btn" disabled={busy || !valid.length || valid.some((item) => item.error) || (duplicates.length > 0 && !duplicatesAccepted)} onClick={submit}>{busy ? 'Confirming batch…' : mixed ? 'Add All Records' : 'Add All Expenses'}</button></div>
    </Modal> : open && phase === 'submission' && confirmed ? <Modal title={outcome?.state === 'saved' ? confirmedMixed ? 'Records added' : 'Expenses added' : 'Confirmed batch status'} onClose={() => { if (!busyRef.current) setOpen(false); }}>
      <p>Household: <strong>{household?.name || confirmed.householdId}</strong> · {confirmed.items.length} confirmed {confirmedMixed ? 'records' : 'expenses'}</p>
      {busy && <p role="status">Saving/checking the whole batch… Please keep this window open. Repeated clicks cannot create extra records.</p>}
      {outcome?.state === 'saved' ? <p role="status"><strong>All {confirmed.items.length} {confirmedMixed ? 'records' : 'expenses'} were saved.</strong> {outcome.alreadySaved && 'The prior commit was found; no duplicates were added.'} {confirmedMixed ? 'Shopping items are in Groceries; unpaid bill reminders are in Bills; paid expenses affect the normal balances/reports.' : 'Balances, reports, activity and notifications use the normal expense ledger.'}</p> : <>
        <p>The confirmed payload is locked in this tab for safe retry. Reloading does not generate new expense IDs. It is not sent to an AI service.</p>
        {outcome?.state === 'none' && <p role="status">The server currently reports <strong>0 of {confirmed.items.length}</strong> target records saved. Retry uses the same IDs, so a delayed prior commit will not be duplicated.</p>}
        {outcome?.state === 'conflict' && <p role="alert" className="error-text">{outcome.ids.length} target records exist, but the batch is incomplete or differs. No additional records will be written automatically. Contact the household administrator to inspect the IDs below; do not recreate the batch.</p>}
        {!outcome && <p>Submission outcome has not been checked. Use “Check saved status” first if you reloaded.</p>}
        {outcome?.state === 'unknown' && <p>Saved count is not yet verified. A transaction cannot save a subset, but a lost network acknowledgement can hide a complete commit.</p>}
      </>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <details><summary>Confirmed records and stable IDs</summary><ul>{confirmed.items.map((item) => <li key={item.id}>{DRAFT_TYPES[item.kind || 'expense']} · {item.input.title || item.input.name} · {item.kind === 'grocery' ? 'shopping item' : formatPaise(item.input.totalPaise ?? item.input.expectedPaise)}<br /><code>{item.documentId}</code>{outcome?.ids.includes(item.documentId) ? outcome.state === 'conflict' ? ' — target ID exists; contents require administrator review' : ' — found saved' : ''}</li>)}</ul></details>
      <div className="modal-footer">{outcome?.state === 'saved' ? <button className="btn" onClick={done}>Done</button> : <><button className="btn btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Close (keep retry)</button><button className="btn btn-secondary" disabled={busy} onClick={check}>Check saved status</button><button className="btn" disabled={busy || outcome?.state === 'conflict'} onClick={retry}>Retry Add All Expenses</button></>}</div>
    </Modal> : null}
  </>;
}
