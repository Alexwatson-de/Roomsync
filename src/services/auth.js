// Active authentication is Firebase Auth; no passwords or verifiers are
// written to localStorage. Legacy local accounts do not become cloud accounts.
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile, updatePassword, deleteUser, reauthenticateWithCredential, EmailAuthProvider, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, deleteDoc, getDocs, query, collectionGroup, where, writeBatch, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { currentUser } from './cloudStore.js';
import { defaultAvatar, resolveAvatar, validateAvatar } from '../lib/avatars.js';
export const listenAuth = (callback) => onAuthStateChanged(auth, callback);
export async function register({ email, password, displayName }) {
  if (!displayName?.trim()) throw new Error('Your name is required.');
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(user, { displayName: displayName.trim() });
  // Membership onboarding does not depend on the optional user profile doc.
  // If Firestore is unavailable the UI reports it rather than silently using
  // local data; the Auth account itself has already been created.
  try {
    await setDoc(doc(db, 'users', user.uid), { uid: user.uid, displayName: user.displayName, ...defaultAvatar(user.uid), createdAt: serverTimestamp() });
  } catch (error) {
    throw new Error(`Your Firebase sign-in account was created, but the profile could not be saved (${error.code}). Enable Firestore and deploy rules, then sign in with this account. Do not register it again.`);
  }
  return user;
}
export const login = ({ email, password }) => signInWithEmailAndPassword(auth, email.trim(), password);
export const logout = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());
export function listenUserProfile(uid, callback, onError) {
  // Read only; legacy records receive computed defaults without a migration.
  return onSnapshot(doc(db, 'users', uid), (snap) => callback(snap.exists() ? snap.data() : null), onError);
}
export async function updateUserProfile({ displayName, avatarStyle, avatarColor }) {
  const user = currentUser();
  if (!displayName?.trim()) throw new Error('Your name is required.');
  const avatar = validateAvatar({ avatarStyle, avatarColor });
  const patch = { displayName: displayName.trim(), ...avatar };
  const memberships = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', user.uid)));
  // Merge only the editable profile fields. Keep existing photoURL, custom
  // fields, creation time, household roles and all historical records intact.
  for (let i = 0; i < Math.max(memberships.docs.length, 1); i += 400) {
    const batch = writeBatch(db);
    if (i === 0) batch.set(doc(db, 'users', user.uid), { uid: user.uid, ...patch }, { merge: true });
    memberships.docs.slice(i, i + 400).forEach((m) => batch.update(m.ref, patch));
    await batch.commit();
  }
  await updateProfile(user, { displayName: patch.displayName });
  return patch;
}
export async function getAvatarProfile(user) {
  const stored = await getUserDoc(user.uid);
  const { avatarStyle, avatarColor } = resolveAvatar({ ...stored, uid: user.uid, name: stored?.displayName || user.displayName || user.email });
  return { avatarStyle, avatarColor };
}
export async function getUserDoc(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}
async function reauthenticate(password) {
  const user = currentUser();
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  return user;
}
export async function changePassword(currentPassword, newPassword) {
  const user = await reauthenticate(currentPassword);
  await updatePassword(user, newPassword);
}
export async function deleteAccount(password) {
  const user = await reauthenticate(password);
  const memberships = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', user.uid)));
  if (!memberships.empty) throw new Error('Leave all households or transfer ownership before deleting your account.');
  await deleteDoc(doc(db, 'users', user.uid));
  await deleteUser(user);
}
