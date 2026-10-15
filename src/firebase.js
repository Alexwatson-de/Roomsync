// Firebase is the active backend. Old localStorage financial records are left
// untouched, never silently uploaded or treated as cloud accounts.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
export const usingEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
export const firebaseProjectId = config.projectId;
export const app = firebaseConfigured ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
// Memory cache avoids leaving another account's private records in IndexedDB
// on shared household devices. Authentication still persists via Firebase Auth.
export const db = app ? getFirestore(app) : null;
if (app && usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8089);
}
