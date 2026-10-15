// Active authentication is Firebase Auth; no passwords or verifiers are
// written to localStorage. Legacy local accounts do not become cloud accounts.
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile, updatePassword, deleteUser, reauthenticateWithCredential, EmailAuthProvider, onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, getDoc, deleteDoc, getDocs, query, collectionGroup, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { currentUser, uploadImage } from './cloudStore.js';
export const listenAuth = (callback) => onAuthStateChanged(auth, callback);
export async function register({ email, password, displayName }) {
  if (!displayName?.trim()) throw new Error('Your name is required.');
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(user, { displayName: displayName.trim() });
  // Membership onboarding does not depend on the optional user profile doc.
  // If Firestore is unavailable the UI reports it rather than silently using
  // local data; the Auth account itself has already been created.
  try {
    await setDoc(doc(db, 'users', user.uid), { uid: user.uid, displayName: user.displayName, photoURL: null, createdAt: serverTimestamp() });
  } catch (error) {
    throw new Error(`Your Firebase sign-in account was created, but the profile could not be saved (${error.code}). Enable Firestore and deploy rules, then sign in with this account. Do not register it again.`);
  }
  return user;
}
export const login = ({ email, password }) => signInWithEmailAndPassword(auth, email.trim(), password);
export const logout = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());
export async function updateUserProfile({ displayName, photoFile }) {
  const user = currentUser();
  if (!displayName?.trim()) throw new Error('Your name is required.');
  const photoURL = photoFile ? await uploadImage(`users/${user.uid}/avatar`, photoFile) : user.photoURL;
  await updateProfile(user, { displayName: displayName.trim(), photoURL: photoURL || null });
  await setDoc(doc(db, 'users', user.uid), { uid: user.uid, displayName: user.displayName, photoURL: user.photoURL }, { merge: true });
  const memberships = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', user.uid)));
  for (let i = 0; i < memberships.docs.length; i += 400) {
    const batch = writeBatch(db);
    memberships.docs.slice(i, i + 400).forEach((m) => batch.update(m.ref, { displayName: user.displayName, photoURL: user.photoURL }));
    await batch.commit();
  }
  return { displayName: user.displayName, photoURL: user.photoURL };
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
