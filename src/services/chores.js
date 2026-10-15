// Cloud chores with transaction-guarded completion and recurrence.
import { writeBatch, runTransaction, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, currentUser, memberAccess, recordRef, writeEvent, listenRecords } from './cloudStore.js';
import { nextDueDate, periodKey, rotationAssignee } from '../lib/recurrence.js';
function choreRecord(user, input, seriesId, dueDate, index = 0, anchorDate = dueDate) {
  if (!input.title?.trim()) throw new Error('Chore title is required.');
  const rotation = input.recurrence === 'one-time' ? null : input.rotation;
  const assignees = rotation?.length ? [rotationAssignee(rotation, index)] : input.assignees;
  if (!assignees?.length) throw new Error('Assign at least one member.');
  return { seriesId, title: input.title.trim(), instructions: input.instructions?.trim() || '', assignees, dueDate, anchorDate, recurrence: input.recurrence, priority: input.priority || 'medium', rotation: rotation || null, occurrenceIndex: index, completedAt: null, completedBy: null, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
}
export async function createChore(hid, input) {
  const user = currentUser(); const seriesId = crypto.randomUUID(); const id = `${seriesId}_${periodKey(input.recurrence, input.dueDate)}`;
  const record = choreRecord(user, input, seriesId, input.dueDate); const batch = writeBatch(db);
  batch.set(recordRef(hid, 'chores', id), record);
  writeEvent(batch, hid, user, `chore_created_${id}`, 'chore_created', { refId: id, summary: `${user.displayName || user.email} assigned "${record.title}"` }, record.assignees, 'Chore assigned to you');
  await batch.commit(); return id;
}
export async function updateChore(hid, id, patch) {
  const allowed = Object.fromEntries(Object.entries(patch).filter(([key]) => ['title', 'instructions', 'assignees', 'dueDate', 'priority', 'rotation'].includes(key)));
  await updateDoc(recordRef(hid, 'chores', id), { ...allowed, updatedAt: serverTimestamp() });
}
export const deleteChore = (hid, id) => deleteDoc(recordRef(hid, 'chores', id));
export async function completeChore(hid, chore) {
  return runTransaction(db, async (tx) => {
    const { user } = await memberAccess(hid, tx);
    const snap = await tx.get(recordRef(hid, 'chores', chore.id));
    if (!snap.exists()) throw new Error('Chore not found.');
    const current = snap.data();
    const due = current.recurrence === 'one-time' ? null : nextDueDate(current.recurrence, current.anchorDate, current.dueDate);
    const nextId = due ? `${current.seriesId}_${periodKey(current.recurrence, due)}` : null;
    if (current.completedAt) return nextId;
    const nextSnap = nextId ? await tx.get(recordRef(hid, 'chores', nextId)) : null;
    tx.update(snap.ref, { completedAt: serverTimestamp(), completedBy: user.uid, completedByName: user.displayName || user.email, updatedAt: serverTimestamp() });
    writeEvent(tx, hid, user, `chore_completed_${chore.id}`, 'chore_completed', { refId: chore.id, summary: `${user.displayName || user.email} completed "${current.title}"` });
    if (nextId && !nextSnap.exists()) {
      const next = choreRecord(user, current, current.seriesId, due, current.occurrenceIndex + 1, current.anchorDate);
      tx.set(nextSnap.ref, next);
      // Separate event id, still inside this guarded completion transaction.
      writeEvent(tx, hid, user, `chore_assigned_${nextId}`, 'chore_assigned', { refId: nextId, summary: `"${next.title}" is due ${due}` }, next.assignees, 'Chore assigned to you');
    }
    return nextId;
  });
}
export const listenChores = (hid, callback, onError) => listenRecords(hid, 'chores', callback, onError, 'dueDate', 'asc');
