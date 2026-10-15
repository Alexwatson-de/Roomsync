// Chat-style local Quick Add. Parsing and opening reviews NEVER call writers.
// Only existing forms' explicit Save/Confirm callbacks can write to Firestore.
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useHousehold } from '../context/HouseholdContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Modal, Spinner } from './ui.jsx';
import ExpenseForm from './ExpenseForm.jsx';
import { ItemForm, PurchaseModal } from '../pages/Groceries.jsx';
import { BillForm, PayBillModal } from '../pages/Bills.jsx';
import { ChoreForm } from '../pages/Chores.jsx';
import { SettlementForm } from '../pages/Balances.jsx';
import { parseQuickAdd, QUICK_ACTIONS } from '../lib/quickAdd.js';
import { isoDate } from '../lib/recurrence.js';
import { formatPaise } from '../lib/money.js';
import { addExpense } from '../services/expenses.js';
import { addItem, markPurchased, listenItems } from '../services/groceries.js';
import { createBill, markBillPaid, listenBills } from '../services/bills.js';
import { createChore, completeChore, listenChores } from '../services/chores.js';
import { recordSettlement } from '../services/settlements.js';
import '../styles/quick-add.css';

const examples = [
  'Add 2 kg rice to the grocery list',
  'I paid ₹1500 for groceries split equally with everyone',
  'Create a rent bill ₹18000 due tomorrow monthly',
  'Add chore clean the kitchen tomorrow',
];
const actionLabel = (action) => QUICK_ACTIONS.find(([id]) => id === action)?.[1] || 'Draft';
export function QuickAddNotice({ result, householdName }) {
  return <div className="quick-review" role="note">
    <strong>Review draft · {householdName}</strong>
    <p>Nothing has been saved. Check every field, member and amount before confirming.</p>
    {!!result.warnings.length && <ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    <details><summary>Original request</summary><p className="quick-source">{result.source}</p></details>
  </div>;
}

export default function QuickAdd() {
  const { user } = useAuth();
  const { activeId, household, members, myRole } = useHousehold();
  const toast = useToast();
  const [phase, setPhase] = useState('closed');
  const [prompt, setPrompt] = useState('');
  const [action, setAction] = useState('');
  const [resolutions, setResolutions] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [ledger, setLedger] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => { if (!busy) { setPhase('closed'); setSelectedRecord(null); } };
  const backToChat = () => {
    setMessages((previous) => [...previous.slice(-9), { role: 'assistant', text: 'Draft dismissed. No changes were saved. Edit your request or try another.' }]);
    setSelectedRecord(null); setPhase('chat');
  };
  const prepare = (event) => {
    event?.preventDefault(); setError('');
    const parsed = parseQuickAdd(prompt, { members, currentUid: user.uid, action: action || undefined, resolutions });
    if (parsed.error) { setError(parsed.error); return; }
    setResult(parsed);
    if (parsed.requests.length) return;
    setMessages((previous) => [...previous.slice(-8), { role: 'user', text: prompt }, { role: 'assistant', text: `${actionLabel(parsed.action)} draft prepared. Review it in the form. No changes saved yet.` }]);
    setPhase(['payBill', 'purchase', 'completeChore'].includes(parsed.action) ? 'record' : 'draft');
  };
  const saved = (message) => {
    toast(message);
    setMessages((previous) => [...previous.slice(-9), { role: 'assistant', text: message + ' — saved after your confirmation.' }]);
    setPrompt(''); setAction(''); setResult(null); setResolutions({}); setSelectedRecord(null); setPhase('chat');
  };
  const note = result && <QuickAddNotice result={result} householdName={household?.name || 'Current household'} />;
  async function saveNew(kind, data) {
    if (!activeId || !members.some((member) => member.uid === user.uid)) throw new Error('Your active household is unavailable.');
    if (kind === 'expense') await addExpense(activeId, data);
    if (kind === 'grocery') await addItem(activeId, data);
    if (kind === 'bill') await createBill(activeId, data);
    if (kind === 'chore') await createChore(activeId, data);
    if (kind === 'settlement') await recordSettlement(activeId, data);
    // ExpenseForm invokes onClose after onSave, so defer success presentation
    // until that close; other existing forms rely on their parent to close.
    saved(kind === 'settlement' ? 'Settlement recorded (no money transferred)' : `${actionLabel(kind)} saved`);
  }
  // ExpenseForm calls onClose after a successful save. It must not erase the
  // success response produced by saved(), or mark a successful draft cancelled.
  const expenseClose = () => setPhase((current) => current === 'draft' || current === 'payment' ? 'chat' : current);

  return <>
    <button type="button" className="btn btn-secondary quick-launch" onClick={() => { setError(''); setPhase('chat'); }} disabled={!activeId || !members.length}>
      <span aria-hidden="true">✦</span> Quick Add
    </button>
    {phase === 'chat' && <Modal title="Quick Add" onClose={close}>
      <p className="quick-intro">Tell RoomSync what happened. Review the draft, then save.</p>
      <p className="quick-disclosure">Free local text parser — not an AI/LLM service. Requests stay in this tab unless you confirm a record. One action at a time.</p>
      <div className="quick-log" role="log" aria-label="Quick Add conversation" aria-live="polite">
        {messages.length ? messages.map((message, index) => <div key={index} className={`quick-message quick-${message.role}`}><strong>{message.role === 'user' ? 'You' : 'RoomSync'}</strong><p>{message.text}</p></div>) : <div className="quick-message quick-assistant"><strong>RoomSync</strong><p>I can draft expenses, shopping items, bills, chores and repayment records. I can also help review an existing bill payment, grocery purchase or chore completion. I never save from a message alone.</p></div>}
      </div>
      <form onSubmit={prepare}>
        <div className="field"><label htmlFor="quick-prompt">What would you like to record?</label>
          <textarea id="quick-prompt" rows={3} maxLength={2000} required placeholder="I paid ₹1500 for groceries split equally with everyone" value={prompt} onChange={(event) => { setPrompt(event.target.value); setResolutions({}); setResult(null); setError(''); }} />
        </div>
        <div className="field"><label htmlFor="quick-kind">Draft type</label><select id="quick-kind" value={action} onChange={(event) => { setAction(event.target.value); setResult(null); setResolutions({}); }}><option value="">Detect from my request</option>{QUICK_ACTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
        <div className="quick-examples">{examples.map((example) => <button key={example} type="button" className="btn btn-ghost btn-sm" onClick={() => { setPrompt(example); setAction(''); setResult(null); setResolutions({}); setError(''); }}>{example}</button>)}</div>
        {result?.requests.length > 0 && <div className="quick-review"><strong>Choose the correct household members</strong><p>I could not match these names safely. No record is saved.</p>{result.requests.map((request) => <div className="field" key={request.key}>
          <label htmlFor={`quick-member-${request.key}`}>{request.label}: “{request.name}” {request.ambiguous ? '(multiple matches)' : '(not found)'}</label>
          <select id={`quick-member-${request.key}`} value={resolutions[request.key] || ''} onChange={(event) => setResolutions((value) => ({ ...value, [request.key]: event.target.value }))}><option value="">Choose member</option>{request.candidates.map((candidate) => <option key={candidate.uid} value={candidate.uid}>{candidate.name} · {candidate.uid.slice(0, 5)}</option>)}</select>
        </div>)}</div>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <p className="quick-disclosure">Tip: “split unequally: me 700, Rahul 800”, “split percentages: me 60%, Rahul 40%”, or “split 2:1 between me and Rahul”. Missing/unsupported details stay editable in the form. Normal forms remain available.</p>
        <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={close}>Close</button><button className="btn" disabled={!prompt.trim()}>Review draft</button></div>
      </form>
    </Modal>}
    {phase === 'draft' && result?.action === 'expense' && <ExpenseForm members={members} draft={result.data} reviewNote={note} title="Review expense draft" onClose={expenseClose} onSave={(data) => saveNew('expense', data)} />}
    {phase === 'draft' && result?.action === 'grocery' && <ItemForm members={members} draft={result.data} reviewNote={note} onClose={backToChat} onSave={(data) => saveNew('grocery', data)} />}
    {phase === 'draft' && result?.action === 'bill' && <BillForm members={members} draft={result.data} reviewNote={note} onClose={backToChat} onSave={(data) => saveNew('bill', data)} />}
    {phase === 'draft' && result?.action === 'chore' && <ChoreForm members={members} draft={result.data} reviewNote={note} onClose={backToChat} onSave={(data) => saveNew('chore', data)} />}
    {phase === 'draft' && result?.action === 'settlement' && <SettlementForm members={members} prefill={result.data} reviewNote={note} currentUid={user.uid} canManageOthers={['owner', 'admin'].includes(myRole)} onClose={backToChat} onSave={(data) => saveNew('settlement', data)} />}
    {phase === 'record' && <ChooseExisting result={result} hid={activeId} reviewNote={note} onClose={backToChat} onChoose={(record, includeExpense) => { setSelectedRecord(record); setLedger(includeExpense); setPhase('payment'); }} />}
    {phase === 'payment' && selectedRecord && result.action === 'completeChore' && <Modal title="Review chore completion" onClose={close}>
      {note}<h3>{selectedRecord.title}</h3><p>Due {selectedRecord.dueDate}. Completing this may create its next recurring occurrence.</p>
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="modal-footer"><button className="btn btn-secondary" disabled={busy} onClick={backToChat}>Cancel</button><button className="btn" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); try { await completeChore(activeId, selectedRecord); saved('Chore completed'); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
      }}>{busy ? 'Saving…' : 'Confirm completion'}</button></div>
    </Modal>}
    {phase === 'payment' && selectedRecord && ['payBill', 'purchase'].includes(result.action) && ledger && <ExpenseForm members={members} title={`Review payment: ${selectedRecord.name}`} reviewNote={<>{note}<p className="quick-review">Saving this expense also marks this specific {result.action === 'payBill' ? 'bill paid' : 'shopping item purchased'}. They save together; cancelling saves neither. No money is transferred.</p></>}
      draft={{ title: selectedRecord.name, totalPaise: result.data.totalPaise || selectedRecord.expectedPaise || null, date: result.data.date || isoDate(new Date()), category: result.action === 'purchase' ? 'Groceries' : selectedRecord.category === 'Rent' ? 'Rent' : selectedRecord.category === 'Internet' ? 'Internet' : selectedRecord.category === 'Electricity' ? 'Electricity' : 'Other', payers: result.data.paidBy ? { [result.data.paidBy]: result.data.totalPaise || selectedRecord.expectedPaise || 0 } : {}, participants: result.data.participants, splitMethod: result.data.splitMethod, splitDetail: result.data.splitDetail, description: `Payment linked to ${result.action === 'payBill' ? 'bill' : 'shopping item'}: ${selectedRecord.name}` }}
      onClose={expenseClose} onSave={async (data) => {
        if (result.action === 'payBill') await markBillPaid(activeId, selectedRecord, { paidPaise: data.totalPaise, expenseInput: data });
        else await markPurchased(activeId, selectedRecord, { pricePaise: data.totalPaise, paidBy: Object.keys(data.payers)[0], expenseInput: data });
        saved('Payment recorded and linked to one shared expense');
      }} />}
    {phase === 'payment' && selectedRecord && result.action === 'payBill' && !ledger && <PayBillModal bill={selectedRecord} members={members} prefill={result.data} reviewNote={note} allowLedger={false} onClose={backToChat} onSave={async ({ paidPaise, paidBy }) => { await markBillPaid(activeId, selectedRecord, { paidPaise, paidBy }); saved('Bill marked paid — no expense added'); }} />}
    {phase === 'payment' && selectedRecord && result.action === 'purchase' && !ledger && <PurchaseModal item={selectedRecord} members={members} currentUid={user.uid} prefill={result.data} reviewNote={note} allowLedger={false} onClose={backToChat} onSave={async ({ pricePaise, paidBy }) => { await markPurchased(activeId, selectedRecord, { pricePaise, paidBy }); saved('Shopping item marked purchased — no expense added'); }} />}
  </>;
}

function ChooseExisting({ result, hid, reviewNote, onClose, onChoose }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  const [id, setId] = useState('');
  const [ledger, setLedger] = useState(Boolean(result.data.totalPaise));
  useEffect(() => {
    const listen = result.action === 'payBill' ? listenBills : result.action === 'purchase' ? listenItems : listenChores;
    return listen(hid, (all) => setRecords(all.filter((record) => result.action === 'payBill' ? !record.paidAt && !record.archived : result.action === 'purchase' ? !record.purchased : !record.completedAt)), (failure) => setError(failure.message));
  }, [hid, result.action]);
  // Choose automatically only a unique exact name match; partial or multiple
  // matches require the user to identify the record. Always show the selector.
  useEffect(() => {
    if (!records || id) return;
    const matches = records.filter((record) => (record.name || record.title).toLowerCase() === result.data.targetText.toLowerCase());
    if (matches.length === 1) setId(matches[0].id);
  }, [records, id, result.data.targetText]);
  const selected = records?.find((record) => record.id === id);
  return <Modal title="Choose existing record" onClose={onClose}>{reviewNote}
    {records === null && !error ? <Spinner label="Loading household records…" /> : <>
      <div className="field"><label htmlFor="quick-record">{result.data.targetText ? `Requested: “${result.data.targetText}”` : 'Select the exact record'}</label><select id="quick-record" value={id} onChange={(event) => setId(event.target.value)}><option value="">Choose record</option>{records?.map((record) => <option key={record.id} value={record.id}>{record.name || record.title}{record.dueDate ? ` · due ${record.dueDate}` : ''}</option>)}</select></div>
      {records?.length === 0 && <p>No open records match this action. Create a new record through Quick Add or the normal form.</p>}
      {selected && result.action === 'payBill' && <p>Expected amount: {formatPaise(selected.expectedPaise)}</p>}
      {result.action !== 'completeChore' && <label className="checkbox-row"><input type="checkbox" checked={ledger} onChange={(event) => setLedger(event.target.checked)} />Also create a linked shared expense (updates balances)</label>}
      {result.action !== 'completeChore' && <p className="quick-disclosure">{ledger ? 'The next modal reviews the amount, payer and exact split. Status and one linked expense save together.' : 'Only the paid/purchased status is recorded. Balances are unchanged. No bank transfer is made.'}</p>}
    </>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn" disabled={!selected || Boolean(error)} onClick={() => onChoose(selected, ledger)}>Review {result.action === 'completeChore' ? 'completion' : 'payment'}</button></div>
  </Modal>;
}
