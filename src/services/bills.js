// Atomic Firestore bill payment, optional expense, activity and recurrence.
import { runTransaction, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, currentUser, memberAccess, recordRef, writeEvent, listenRecords } from './cloudStore.js';
import { writeExpense, buildExpenseData } from './expenses.js';
import { nextDueDate, periodKey } from '../lib/recurrence.js';
function billRecord(user, input, seriesId, dueDate, anchorDate = dueDate) {
  if (!input.name?.trim() || !Number.isSafeInteger(input.expectedPaise) || input.expectedPaise <= 0) throw new Error('Enter a bill name and positive amount.');
  return { seriesId, name: input.name.trim(), category: input.category, expectedPaise: input.expectedPaise, dueDate, anchorDate, recurrence: input.recurrence, assignedTo: input.assignedTo || null, splitMethod: input.splitMethod || 'equal', splitDetail: input.splitDetail || null, participants: input.participants || [], notes: input.notes?.trim() || '', paidAt: null, paidBy: null, paidPaise: null, expenseId: null, archived: false, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
}
export async function createBill(hid, input) {
  const user = currentUser(); const seriesId = crypto.randomUUID(); const id = `${seriesId}_${periodKey(input.recurrence, input.dueDate)}`;
  const batch = writeBatch(db); const bill = billRecord(user, input, seriesId, input.dueDate);
  batch.set(recordRef(hid, 'bills', id), bill);
  writeEvent(batch, hid, user, `bill_created_${id}`, 'bill_created', { refId: id, summary: `${user.displayName || user.email} created "${bill.name}"` }, [bill.assignedTo], 'Bill assigned');
  await batch.commit(); return id;
}
export async function updateBill(hid, id, patch) {
  const allowed = Object.fromEntries(Object.entries(patch).filter(([key]) => ['name', 'category', 'expectedPaise', 'dueDate', 'assignedTo', 'splitMethod', 'splitDetail', 'participants', 'notes', 'archived'].includes(key)));
  await updateDoc(recordRef(hid, 'bills', id), { ...allowed, updatedAt: serverTimestamp() });
}
export const archiveBill = (hid, id) => updateBill(hid, id, { archived: true });
export async function markBillPaid(hid, bill, { paidPaise, expenseInput = null, paidBy = null }) {
  if (!Number.isSafeInteger(paidPaise) || paidPaise <= 0) throw new Error('Enter a positive amount.');
  if (expenseInput) { buildExpenseData(expenseInput); if (expenseInput.totalPaise !== paidPaise) throw new Error('Bill and expense amounts must match.'); }
  return runTransaction(db, async (tx) => {
    const { user } = await memberAccess(hid, tx);
    const snap = await tx.get(recordRef(hid, 'bills', bill.id));
    if (!snap.exists() || snap.data().archived) throw new Error('Bill is unavailable.');
    const current = snap.data();
    const due = current.recurrence === 'one-time' ? null : nextDueDate(current.recurrence, current.anchorDate, current.dueDate);
    const nextId = due ? `${current.seriesId}_${periodKey(current.recurrence, due)}` : null;
    if (current.paidAt) return nextId;
    const paymentPayer = expenseInput ? Object.keys(expenseInput.payers)[0] : paidBy || user.uid;
    const payerMember = await tx.get(recordRef(hid, 'members', paymentPayer));
    if (!payerMember.exists()) throw new Error('Choose a current household member as the bill payer.');
    const nextSnap = nextId ? await tx.get(recordRef(hid, 'bills', nextId)) : null;
    const expenseId = expenseInput ? `bill_payment_${bill.id}` : null;
    const expenseSnap = expenseId ? await tx.get(recordRef(hid, 'expenses', expenseId)) : null;
    if (expenseInput && !expenseSnap.exists()) writeExpense(tx, hid, user, expenseId, expenseInput);
    tx.update(snap.ref, { paidAt: serverTimestamp(), paidBy: paymentPayer, paidPaise, expenseId, updatedAt: serverTimestamp() });
    writeEvent(tx, hid, user, `bill_paid_${bill.id}`, 'bill_paid', { refId: bill.id, summary: `${user.displayName || user.email} marked "${current.name}" paid`, meta: { paidPaise } });
    if (nextId && !nextSnap.exists()) tx.set(nextSnap.ref, billRecord(user, current, current.seriesId, due, current.anchorDate));
    return nextId;
  });
}
export const listenBills = (hid, callback, onError) => listenRecords(hid, 'bills', callback, onError, 'dueDate', 'asc');
