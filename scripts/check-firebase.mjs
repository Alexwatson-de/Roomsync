// Read-only preflight. Never creates Auth users or reads private records.
import { loadEnv } from 'vite';
const env = loadEnv('development', process.cwd(), 'VITE_FIREBASE_');
const needed = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID'];
const missing = needed.filter((key) => !env[`VITE_FIREBASE_${key}`]);
if (missing.length) { console.error('Missing Firebase settings:', missing.join(', ')); process.exit(1); }
const project = env.VITE_FIREBASE_PROJECT_ID;
console.log('Checking Firebase project:', project);
let failed = false;
for (const [label, url] of [
  ['Auth configuration', `https://identitytoolkit.googleapis.com/v1/projects?key=${env.VITE_FIREBASE_API_KEY}`],
  ['Firestore access protection', `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/households/roomsync-connection-probe-no-write`],
]) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const body = await response.json();
    if (label.startsWith('Auth') && response.ok) {
      console.log(label + ': reachable. Authorized domains: ' + (body.authorizedDomains || []).join(', '));
    } else if (label.startsWith('Firestore') && response.status === 403 && body.error?.status === 'PERMISSION_DENIED' && !/not been used|disabled|SERVICE_DISABLED/.test(JSON.stringify(body))) {
      console.log(label + ': unauthenticated request denied (expected). Authenticated workflows still need verification.');
    } else {
      failed = true;
      console.error(label + ': HTTP ' + response.status + ' — ' + (body.error?.message || 'Unexpected response'));
    }
  } catch (error) { failed = true; console.error(label + ': ' + (error.cause?.code || error.message)); }
}
process.exitCode = failed ? 1 : 0;
