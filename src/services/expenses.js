// Cloud expense ledger. Related records are committed in one transaction.
import { runTransaction, serverTimestamp, arrayUnion, collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db, currentUser, recordRef, memberAccess, requireEditor, writeEvent } from './cloudStore.js';
import { buildExpenseData } from '../lib/expenseData.js';
export { buildExpenseData };
// Called by bill/grocery transactions too. Reads must all occur before this.
export function writeExpense(tx, hid, user, id, input, metadata = {}) {
  const data = buildExpenseData(input);
  tx.set(recordRef(hid, 'expenses', id), { ...data, ...metadata, deleted: false, createdBy: user.uid, createdByName: user.displayName || user.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user.uid, audit: [{ action: 'created', by: user.uid, at: Date.now() }] });
  writeEvent(tx, hid, user, `expense_added_${id}`, 'expense_added', { refId: id, summary: `${user.displayName || user.email} added expense "${data.title}"`, meta: { totalPaise: data.totalPaise } }, [...data.participants, ...data.payerIds], 'New shared expense');
  return id;
}
export async function addExpense(hid, input) {
  buildExpenseData(input);
  const user = currentUser();
  const id = recordRef(hid, 'expenses').id;
  await runTransaction(db, async (tx) => { await memberAccess(hid, tx); writeExpense(tx, hid, user, id, input); });
  return id;
}
export async function updateExpense(hid, id, input) {
  const next = buildExpenseData(input);
  const eventId = crypto.randomUUID();
  await runTransaction(db, async (tx) => {
    const { user, member } = await memberAccess(hid, tx);
    const snap = await tx.get(recordRef(hid, 'expenses', id));
    if (!snap.exists() || snap.data().deleted) throw new Error('Expense not found.');
    const previous = snap.data(); requireEditor(previous, user, member);
    // Merge normal expense changes without touching any historical attachment.
    tx.update(snap.ref, { ...next, updatedAt: serverTimestamp(), updatedBy: user.uid, audit: arrayUnion({ action: 'edited', by: user.uid, at: Date.now(), previous: { totalPaise: previous.totalPaise, payers: previous.payers, shares: previous.shares } }) });
    writeEvent(tx, hid, user, eventId, 'expense_edited', { refId: id, summary: `${user.displayName || user.email} edited "${next.title}"` }, [...previous.participants, ...next.participants], 'Expense updated');
  });
}
export async function deleteExpense(hid, id) {
  await runTransaction(db, async (tx) => {
    const { user, member } = await memberAccess(hid, tx);
    const snap = await tx.get(recordRef(hid, 'expenses', id));
    if (!snap.exists() || snap.data().deleted) return;
    const expense = snap.data(); requireEditor(expense, user, member);
    tx.update(snap.ref, { deleted: true, updatedAt: serverTimestamp(), updatedBy: user.uid, audit: arrayUnion({ action: 'deleted', by: user.uid, at: Date.now() }) });
    writeEvent(tx, hid, user, `expense_deleted_${id}`, 'expense_deleted', { refId: id, summary: `${user.displayName || user.email} removed "${expense.title}"` }, expense.participants, 'Expense removed');
  });
}
export function listenExpenses(hid, callback, onError) {
  return onSnapshot(query(collection(db, 'households', hid, 'expenses'), where('deleted', '==', false), orderBy('date', 'desc')), (snap) => callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), onError);
}
