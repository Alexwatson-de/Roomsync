// Cloud repayment records. These do not transfer money.
import { runTransaction, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { db, currentUser, recordRef, memberAccess, writeEvent, listenRecords } from './cloudStore.js';
export async function recordSettlement(hid, { from, to, amountPaise, date, note = '' }) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || from === to || !from || !to) throw new Error('Choose different members and a positive amount.');
  const id = recordRef(hid, 'settlements').id;
  await runTransaction(db, async (tx) => {
    const { user, member } = await memberAccess(hid, tx);
    if (![from, to].includes(user.uid) && !['owner', 'admin'].includes(member.role)) throw new Error('You can only record settlements involving you.');
    tx.set(recordRef(hid, 'settlements', id), { from, to, amountPaise, date, note: note.trim(), status: 'recorded', reversed: false, createdBy: user.uid, createdByName: user.displayName || user.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), audit: [{ action: 'created', by: user.uid, at: Date.now() }] });
    writeEvent(tx, hid, user, `settlement_recorded_${id}`, 'settlement_recorded', { refId: id, summary: `${user.displayName || user.email} recorded a settlement`, meta: { from, to, amountPaise } }, [from, to], 'Settlement recorded');
  });
  return id;
}
async function changeSettlement(hid, id, action) {
  await runTransaction(db, async (tx) => {
    const { user, member } = await memberAccess(hid, tx);
    const snap = await tx.get(recordRef(hid, 'settlements', id));
    if (!snap.exists()) throw new Error('Settlement not found.');
    const record = snap.data();
    if (record.reversed || (action === 'confirmed' && record.status === 'confirmed')) return;
    if (action === 'confirmed' && record.to !== user.uid) throw new Error('Only the receiver can confirm.');
    if (action === 'reversed' && ![record.from, record.to, record.createdBy].includes(user.uid) && !['owner', 'admin'].includes(member.role)) throw new Error('You cannot reverse this settlement.');
    tx.update(snap.ref, { ...(action === 'confirmed' ? { status: 'confirmed' } : { reversed: true }), updatedAt: serverTimestamp(), audit: arrayUnion({ action, by: user.uid, at: Date.now() }) });
    writeEvent(tx, hid, user, `settlement_${action}_${id}`, `settlement_${action}`, { refId: id, summary: `${user.displayName || user.email} ${action} a settlement` }, [record.from, record.to], `Settlement ${action}`);
  });
}
export const confirmSettlement = (hid, id) => changeSettlement(hid, id, 'confirmed');
export const reverseSettlement = (hid, id) => changeSettlement(hid, id, 'reversed');
export const listenSettlements = (hid, callback, onError) => listenRecords(hid, 'settlements', callback, onError, 'date', 'desc');
