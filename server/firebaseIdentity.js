// Verify end-user Firebase ID tokens without privileged Admin credentials.
// Subsequent Firestore REST reads use that SAME bearer, so existing security
// rules enforce household membership. No impersonation or server data writes.
import { verify } from 'node:crypto';
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cached = { until: 0, certificates: {} };
const fail = (message, status = 401) => Object.assign(new Error(message), { status });
export async function verifyFirebaseToken(token, projectId, { fetcher = fetch, now = Date.now() } = {}) {
  if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) throw fail('Firebase server project is not configured.', 503);
  if (!token || token.length > 10000) throw fail('Sign in to Firebase before using Gemini.');
  let header, claims, parts;
  try { parts = token.split('.'); if (parts.length !== 3) throw Error(); header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { throw fail('Invalid Firebase sign-in token.'); }
  const seconds = now / 1000;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` || typeof claims.sub !== 'string' || !claims.sub.length || claims.sub.length > 128 || !Number.isFinite(claims.exp) || claims.exp <= seconds || !Number.isFinite(claims.iat) || claims.iat > seconds + 30 || !Number.isFinite(claims.auth_time) || claims.auth_time > seconds + 30) throw fail('Expired or invalid Firebase session. Sign in again.');
  if (cached.until < now || !cached.certificates[header.kid]) {
    const response = await fetcher(CERTS_URL, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw fail('Firebase token verification is temporarily unavailable.', 503);
    const certificates = await response.json();
    const ttl = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 300);
    cached = { until: now + Math.min(ttl, 3600) * 1000, certificates };
  }
  let valid = false;
  try { valid = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), cached.certificates[header.kid], Buffer.from(parts[2], 'base64url')); } catch { /* fail closed */ }
  if (!valid) throw fail('Firebase session signature is invalid.');
  return claims.sub;
}
export async function readMemberContext({ token, projectId, householdId, uid, fetcher = fetch }) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(householdId || '')) throw fail('Choose a valid household.', 400);
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/households/${householdId}/members`;
  const options = { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) };
  const self = await fetcher(`${base}/${encodeURIComponent(uid)}`, options);
  if (!self.ok) throw fail('You are not authorized for this household, or its Firestore rules need attention.', self.status === 403 || self.status === 404 ? 403 : 503);
  const members = []; let pageToken;
  do {
    const url = new URL(base); url.searchParams.set('pageSize', '100'); if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetcher(url, options);
    if (!response.ok) throw fail('Could not load household members securely.', 503);
    const body = await response.json();
    for (const document of body.documents || []) {
      const id = document.name?.split('/').at(-1); const name = document.fields?.displayName?.stringValue;
      if (id && typeof name === 'string') members.push({ uid: id, name: name.slice(0, 80) });
    }
    pageToken = body.nextPageToken;
    if (members.length > 32) throw fail('Gemini Quick Add currently supports households of up to 32 members.', 422);
  } while (pageToken);
  const mapped = members.map((member, index) => ({ ...member, ref: `m${index}` }));
  const current = mapped.find((member) => member.uid === uid);
  if (!current) throw fail('Household membership changed. Refresh and try again.', 403);
  return { members: mapped, currentRef: current.ref };
}
