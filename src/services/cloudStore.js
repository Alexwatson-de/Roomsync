// Shared Firestore primitives, not a localStorage database adapter.
import { collection, doc, getDoc, getDocs, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
export { db, auth, serverTimestamp };
export function currentUser() {
  if (!auth?.currentUser) throw new Error('Please sign in to Firebase.');
  return auth.currentUser;
}
export const recordRef = (hid, kind, id) => id ? doc(db, 'households', hid, kind, id) : doc(collection(db, 'households', hid, kind));
export function listenRecords(hid, kind, callback, onError, field = 'createdAt', direction = 'desc') {
  return onSnapshot(query(collection(db, 'households', hid, kind), orderBy(field, direction)), { includeMetadataChanges: true }, (snap) => callback(snap.docs.map((d) => ({ ...d.data(), id: d.id })), snap.metadata), onError);
}
export async function memberAccess(hid, transaction) {
  const user = currentUser();
  const memberRef = recordRef(hid, 'members', user.uid);
  const snap = transaction ? await transaction.get(memberRef) : await getDoc(memberRef);
  if (!snap.exists()) throw new Error('You are not a member of this household.');
  return { user, member: snap.data() };
}
export async function householdMembers(hid) {
  return (await getDocs(collection(db, 'households', hid, 'members'))).docs.map((d) => ({ ...d.data(), uid: d.id }));
}
export function requireEditor(record, user, member) {
  if (record.createdBy !== user.uid && !['owner', 'admin'].includes(member.role)) throw new Error('Only the author or an admin can change this record.');
}
export function writeEvent(writer, hid, user, id, type, { refId = null, summary, meta = {} }, recipients = [], title = summary) {
  writer.set(recordRef(hid, 'activity', id), { type, refId, actorId: user.uid, actorName: user.displayName || user.email, summary, meta, createdAt: serverTimestamp() });
  for (const recipientId of new Set(recipients)) {
    if (!recipientId || recipientId === user.uid) continue;
    writer.set(recordRef(hid, 'notifications', `${id}_${recipientId}`), { recipientId, actorId: user.uid, actorName: user.displayName || user.email, type: type.startsWith('chore') ? 'chore' : type.startsWith('bill') ? 'bill' : type.startsWith('settlement') ? 'settlement' : 'expense', refId, title, body: summary, read: false, createdAt: serverTimestamp() });
  }
}
