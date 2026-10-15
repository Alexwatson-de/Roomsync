// Shared cloud shopping list, with atomic purchase-to-expense linking.
import { writeBatch, runTransaction, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, currentUser, memberAccess, recordRef, writeEvent, listenRecords } from './cloudStore.js';
import { writeExpense, buildExpenseData } from './expenses.js';
export function writeGroceryItem(batch, hid, user, id, { name, quantity = '', unit = '', category = 'Miscellaneous', notes = '', assignedTo = null }, metadata = {}) {
  if (!name?.trim()) throw new Error('Item name is required.');
  batch.set(recordRef(hid, 'shoppingItems', id), { name: name.trim(), quantity, unit, category, notes, assignedTo, ...metadata, purchased: false, purchasedAt: null, purchasedBy: null, pricePaise: null, paidBy: null, expenseId: null, createdBy: user.uid, createdByName: user.displayName || user.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  writeEvent(batch, hid, user, `item_added_${id}`, 'item_added', { refId: id, summary: `${user.displayName || user.email} added "${name}" to the shopping list` });
}
export async function addItem(hid, input) {
  const user = currentUser(); const target = recordRef(hid, 'shoppingItems'); const batch = writeBatch(db);
  writeGroceryItem(batch, hid, user, target.id, input);
  await batch.commit(); return target.id;
}
export async function updateItem(hid, id, patch) {
  const allowed = Object.fromEntries(Object.entries(patch).filter(([key]) => ['name', 'quantity', 'unit', 'category', 'notes', 'assignedTo'].includes(key)));
  await updateDoc(recordRef(hid, 'shoppingItems', id), { ...allowed, updatedAt: serverTimestamp() });
}
export const removeItem = (hid, id) => deleteDoc(recordRef(hid, 'shoppingItems', id));
export async function markPurchased(hid, item, { pricePaise = null, paidBy = null, expenseInput = null } = {}) {
  if (pricePaise !== null && (!Number.isSafeInteger(pricePaise) || pricePaise < 0)) throw new Error('Invalid price.');
  if (expenseInput) { buildExpenseData(expenseInput); if (expenseInput.totalPaise !== pricePaise) throw new Error('Purchase and expense amounts must match.'); }
  return runTransaction(db, async (tx) => {
    const { user } = await memberAccess(hid, tx);
    const snap = await tx.get(recordRef(hid, 'shoppingItems', item.id));
    if (!snap.exists()) throw new Error('Item not found.');
    const current = snap.data();
    if (current.purchased) return current.expenseId;
    const expenseId = expenseInput ? `grocery_purchase_${item.id}` : null;
    const existing = expenseId ? await tx.get(recordRef(hid, 'expenses', expenseId)) : null;
    if (expenseInput && !existing.exists()) writeExpense(tx, hid, user, expenseId, expenseInput);
    tx.update(snap.ref, { purchased: true, purchasedAt: serverTimestamp(), purchasedBy: user.uid, purchasedByName: user.displayName || user.email, pricePaise, paidBy, expenseId, updatedAt: serverTimestamp() });
    writeEvent(tx, hid, user, `item_purchased_${item.id}`, 'item_purchased', { refId: item.id, summary: `${user.displayName || user.email} purchased "${current.name}"` });
    return expenseId;
  });
}
export async function unmarkPurchased(hid, id) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(recordRef(hid, 'shoppingItems', id));
    if (!snap.exists()) throw new Error('Item not found.');
    if (snap.data().expenseId) throw new Error('This purchase is linked to Expenses. Correct the ledger instead of purchasing it again.');
    tx.update(snap.ref, { purchased: false, purchasedAt: null, purchasedBy: null, paidBy: null, pricePaise: null, updatedAt: serverTimestamp() });
  });
}
export const listenItems = (hid, callback, onError) => listenRecords(hid, 'shoppingItems', callback, onError);
