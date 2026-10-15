// Shared events are normally created atomically by domain transactions.
import { collection, query, where, orderBy, limit, onSnapshot, updateDoc, writeBatch } from 'firebase/firestore';
import { db, currentUser, recordRef, writeEvent } from './cloudStore.js';
export function listenActivity(hid, callback, onError, max = 50) {
  return onSnapshot(query(collection(db, 'households', hid, 'activity'), orderBy('createdAt', 'desc'), limit(max)), (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}
export async function logActivity(hid, type, { dedupeId, ...details }) {
  const batch = writeBatch(db); writeEvent(batch, hid, currentUser(), dedupeId || crypto.randomUUID(), type, details); await batch.commit();
}
export function listenNotifications(hid, uid, callback, onError, max = 50) {
  return onSnapshot(query(collection(db, 'households', hid, 'notifications'), where('recipientId', '==', uid), orderBy('createdAt', 'desc'), limit(max)), (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}
export const markNotificationRead = (hid, id) => updateDoc(recordRef(hid, 'notifications', id), { read: true });
export async function markAllNotificationsRead(hid, notifications) {
  const unread = notifications.filter((n) => !n.read);
  for (let i = 0; i < unread.length; i += 400) {
    const batch = writeBatch(db); unread.slice(i, i + 400).forEach((n) => batch.update(recordRef(hid, 'notifications', n.id), { read: true })); await batch.commit();
  }
}
