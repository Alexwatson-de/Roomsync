// Cloud expense ledger. Related records are committed in one transaction.
import { runTransaction, serverTimestamp, arrayUnion, collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db, currentUser, recordRef, memberAccess, requireEditor, writeEvent, uploadImage } from './cloudStore.js';
import { computeShares } from '../lib/splits.js';

// The security rules can verify every allocated minor unit for up to 8
// payers/participants. This explicit bound is surfaced as validation, never a
// silent truncation. Larger households require trusted server-side validation.
export function buildExpenseData(input) {
  const { title, date, category, totalPaise, payers, participants, splitMethod, splitDetail, description } = input;
  if (!title?.trim() || title.length > 200) throw new Error('Enter a title of 1–200 characters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid date is required.');
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0 || totalPaise > 1e10) throw new Error('Enter a positive amount of at most ₹10 crore.');
  const payerIds = Object.keys(payers || {});
  if (!payerIds.length || new Set([...payerIds, ...participants]).size > 8) throw new Error('Up to 8 distinct payers/participants are supported per expense. Larger allocations require trusted server-side validation.');
  if (Object.values(payers).some((p) => !Number.isSafeInteger(p) || p < 0) || Object.values(payers).reduce((a, b) => a + b, 0) !== totalPaise) throw new Error('Payer amounts must equal the total.');
  const shares = computeShares(splitMethod, totalPaise, participants, splitDetail);
  if (Object.keys(shares).length !== participants.length || participants.some((uid) => !(uid in shares))) throw new Error('Split details must match participants.');
  return { title: title.trim(), date, category, totalPaise, payers, payerIds, participants: Object.keys(shares), splitMethod, splitDetail: splitDetail || null, shares, description: description?.trim() || '' };
}
// Called by bill/grocery transactions too. Reads must all occur before this.
export function writeExpense(tx, hid, user, id, input, receiptUrl = null) {
  const data = buildExpenseData(input);
  tx.set(recordRef(hid, 'expenses', id), { ...data, receiptUrl, deleted: false, createdBy: user.uid, createdByName: user.displayName || user.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user.uid, audit: [{ action: 'created', by: user.uid, at: Date.now() }] });
  writeEvent(tx, hid, user, `expense_added_${id}`, 'expense_added', { refId: id, summary: `${user.displayName || user.email} added expense "${data.title}"`, meta: { totalPaise: data.totalPaise } }, [...data.participants, ...data.payerIds], 'New shared expense');
  return id;
}
export const uploadReceipt = (hid, file) => uploadImage(`households/${hid}/receipts/${currentUser().uid}/${crypto.randomUUID()}`, file);
export async function addExpense(hid, input, receiptFile) {
  buildExpenseData(input);
  const user = currentUser();
  const receiptUrl = receiptFile ? await uploadReceipt(hid, receiptFile) : null;
  const id = recordRef(hid, 'expenses').id;
  await runTransaction(db, async (tx) => { await memberAccess(hid, tx); writeExpense(tx, hid, user, id, input, receiptUrl); });
  return id;
}
export async function updateExpense(hid, id, input, receiptFile) {
  const next = buildExpenseData(input);
  const receiptUrl = receiptFile ? await uploadReceipt(hid, receiptFile) : null;
  const eventId = crypto.randomUUID();
  await runTransaction(db, async (tx) => {
    const { user, member } = await memberAccess(hid, tx);
    const snap = await tx.get(recordRef(hid, 'expenses', id));
    if (!snap.exists() || snap.data().deleted) throw new Error('Expense not found.');
    const previous = snap.data(); requireEditor(previous, user, member);
    tx.update(snap.ref, { ...next, ...(receiptUrl ? { receiptUrl } : {}), updatedAt: serverTimestamp(), updatedBy: user.uid, audit: arrayUnion({ action: 'edited', by: user.uid, at: Date.now(), previous: { totalPaise: previous.totalPaise, payers: previous.payers, shares: previous.shares } }) });
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
