// Cloud membership source of truth: households/{hid}/members/{uid}.
// Bootstrap uses a batch and rules getAfter; joins validate expiry on server.
import { collection, collectionGroup, doc, getDoc, getDocs, query, where, onSnapshot, writeBatch, runTransaction, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, currentUser, recordRef, memberAccess, writeEvent } from './cloudStore.js';
import { getAvatarProfile } from './auth.js';

export async function createHousehold({ name, description = '', currency = 'INR' }) {
  const user = currentUser();
  if (!name?.trim()) throw new Error('Household name is required.');
  const avatar = await getAvatarProfile(user);
  const h = doc(collection(db, 'households'));
  const batch = writeBatch(db);
  batch.set(h, { name: name.trim(), description: description.trim(), currency, imageUrl: null, createdBy: user.uid, createdAt: serverTimestamp(), archived: false });
  batch.set(recordRef(h.id, 'members', user.uid), { uid: user.uid, householdId: h.id, householdName: name.trim(), displayName: user.displayName || user.email, ...avatar, role: 'owner', joinedAt: serverTimestamp() });
  await batch.commit();
  return h.id;
}
export async function updateHousehold(hid, { name, description }) {
  const { member } = await memberAccess(hid);
  if (!['owner', 'admin'].includes(member.role)) throw new Error('Only owners and admins can edit household settings.');
  if (!name?.trim()) throw new Error('Household name is required.');
  await updateDoc(doc(db, 'households', hid), { name: name.trim(), description: description?.trim() || '' });
}
export async function createInvite(hid, householdName, role = 'member', expiresDays = 7) {
  const { user, member } = await memberAccess(hid);
  if (!['owner', 'admin'].includes(member.role) || !['member', 'admin'].includes(role)) throw new Error('Not permitted to invite this role.');
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const batch = writeBatch(db);
  batch.set(doc(db, 'invites', token), { householdId: hid, householdName, role, createdBy: user.uid, createdAt: serverTimestamp(), expiresAt: Date.now() + Math.min(expiresDays, 7) * 86400000, active: true });
  await batch.commit(); return token;
}
export async function getInvite(token) {
  const snap = await getDoc(doc(db, 'invites', token.trim()));
  if (!snap.exists() || !snap.data().active || snap.data().expiresAt <= Date.now()) return null;
  return { token: snap.id, ...snap.data() };
}
export const revokeInvite = (token) => updateDoc(doc(db, 'invites', token), { active: false });
export async function listInvites(hid) {
  return (await getDocs(query(collection(db, 'invites'), where('householdId', '==', hid)))).docs.map((d) => ({ token: d.id, ...d.data() }));
}
export async function joinHousehold(token) {
  const user = currentUser();
  const avatar = await getAvatarProfile(user);
  return runTransaction(db, async (tx) => {
    const inviteSnap = await tx.get(doc(db, 'invites', token.trim()));
    if (!inviteSnap.exists()) throw new Error('This invitation is invalid.');
    const invite = inviteSnap.data();
    if (!invite.active || invite.expiresAt <= Date.now()) throw new Error('This invitation has expired or been revoked.');
    const memberRef = recordRef(invite.householdId, 'members', user.uid);
    // No read of a nonmember household is needed before claiming a capability.
    tx.set(memberRef, { uid: user.uid, householdId: invite.householdId, householdName: invite.householdName, displayName: user.displayName || user.email, ...avatar, role: invite.role, inviteCode: token.trim(), joinedAt: serverTimestamp() });
    return invite.householdId;
  });
}
export function listenMyMemberships(uid, callback, onError) {
  return onSnapshot(query(collectionGroup(db, 'members'), where('uid', '==', uid)), { includeMetadataChanges: true }, (snap) => {
    // A pending local member write is not yet a server-authorized membership.
    // Starting household queries before commit can permanently deny listeners.
    if (!snap.metadata.hasPendingWrites) callback(snap.docs.map((d) => d.data()));
  }, onError);
}
export function listenHousehold(hid, callback, onError) {
  return onSnapshot(doc(db, 'households', hid), (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null), onError);
}
export function listenMembers(hid, callback, onError) {
  return onSnapshot(collection(db, 'households', hid, 'members'), (snap) => callback(snap.docs.map((d) => d.data())), onError);
}
export async function setMemberRole(hid, uid, role) {
  if (!['admin', 'member'].includes(role)) throw new Error('Invalid role.');
  await updateDoc(recordRef(hid, 'members', uid), { role });
}
export async function removeMember(hid, uid, removedName) {
  const user = currentUser();
  const batch = writeBatch(db);
  batch.delete(recordRef(hid, 'members', uid));
  // Rules use pre-write membership for an actor leaving in this same batch.
  writeEvent(batch, hid, user, crypto.randomUUID(), uid === user.uid ? 'member_left' : 'member_removed', { refId: uid, summary: `${removedName || 'A member'} ${uid === user.uid ? 'left' : 'was removed from'} the household` });
  await batch.commit();
}
// Firestore cannot securely cascade arbitrary subcollections from an untrusted
// client. Do not leave partially deleted ledgers or pretend a cascade ran.
export async function deleteHousehold() {
  throw new Error('Permanent cloud household deletion requires a trusted server-side recursive deletion operation. It is not configured. No records were deleted.');
}
