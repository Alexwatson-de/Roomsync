// Administrative cleanup for our explicitly marked disposable LIVE checks.
// Uses existing Firebase CLI login in memory; no service account or token file.
// Refuses unmarked households/accounts and never enumerates real financial data.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const project = 'roomsync-9dceb';
const artifactRoot = resolve('artifacts/tests');
const files = process.argv.slice(2);
if (!files.length) throw new Error('Provide one or more generated live-test manifest paths under artifacts/tests.');
// The CLI is already installed in npx's cache after deployment/test commands.
// Resolve its auth library, but never inspect, export, print or copy its tokens.
const npxRoot = join(homedir(), '.npm/_npx');
const candidates = readdirSync(npxRoot).map((name) => join(npxRoot, name, 'node_modules/firebase-tools'));
const cliRoot = candidates.find((path) => existsSync(join(path, 'package.json')) && JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version.startsWith('13.'));
if (!cliRoot) throw new Error('Run npx firebase-tools@13 login first.');
const auth = require(join(cliRoot, 'lib/auth.js'));
const { requireAuth } = require(join(cliRoot, 'lib/requireAuth.js'));
const { Client } = require(join(cliRoot, 'lib/apiv2.js'));
const account = auth.getGlobalDefaultAccount();
if (!account) throw new Error('Firebase administrator login required.');
await requireAuth({ project, ...account });
const firestore = new Client({ urlPrefix: 'https://firestore.googleapis.com' });
const identity = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com' });
async function request(client, method, path, body) {
  return (await client.request({ method, path, ...(body ? { body } : {}), skipLog: { reqBody: true, resBody: true } })).body;
}
async function getDocument(path) {
  try { return await request(firestore, 'GET', `/v1/projects/${project}/databases/(default)/documents/${path}`); }
  catch (error) { if (error.status === 404) return null; throw error; }
}
async function deleteDocument(path) {
  await request(firestore, 'DELETE', `/v1/projects/${project}/databases/(default)/documents/${path}`);
}
for (const file of files) {
  const fullPath = resolve(file);
  if (!fullPath.startsWith(artifactRoot + '/')) throw new Error('Manifest must be in the ignored test artifacts directory.');
  const m = JSON.parse(readFileSync(fullPath, 'utf8'));
  if (m.projectId !== project || !/^ROOMSYNC-TEST-\d{13}-[a-f0-9]{8}$/.test(m.marker)) throw new Error('Refusing unrecognized test manifest.');
  const emails = m.accountEmails || ['owner', 'member'].map((role) => `${m.marker.toLowerCase()}-${role}@example.test`);
  const users = [];
  for (const email of emails) {
    if (!email.startsWith(m.marker.toLowerCase() + '-') || !email.endsWith('@example.test')) throw new Error('Refusing non-test account.');
    const result = await request(identity, 'POST', `/v1/projects/${project}/accounts:lookup`, { email: [email] });
    for (const user of result.users || []) {
      if (user.email !== email || (user.displayName && !user.displayName.startsWith(m.marker))) throw new Error('Test account identity mismatch.');
      users.push(user);
    }
  }
  const userIds = new Set(users.map((u) => u.localId));
  for (const hid of m.householdIds) {
    if (!/^[a-zA-Z0-9_-]+$/.test(hid)) throw new Error('Invalid test household ID.');
    const h = await getDocument(`households/${hid}`);
    if (!h) continue;
    if (h.fields?.name?.stringValue !== m.marker || !userIds.has(h.fields?.createdBy?.stringValue)) throw new Error('Refusing to delete a household not owned by these disposable users.');
    const result = spawnSync(process.execPath, [join(cliRoot, 'lib/bin/firebase.js'), 'firestore:delete', `households/${hid}`, '--recursive', '--force', '--project', project, '--non-interactive'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Scoped test-household cleanup failed. Retry after checking Firebase access.');
  }
  for (const token of m.inviteIds) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid generated test invite ID.');
    const invite = await getDocument(`invites/${token}`);
    if (invite && (!m.householdIds.includes(invite.fields?.householdId?.stringValue) || !userIds.has(invite.fields?.createdBy?.stringValue))) throw new Error('Invite does not belong to this disposable test.');
    if (invite) await deleteDocument(`invites/${token}`);
  }
  for (const user of users) {
    const profile = await getDocument(`users/${user.localId}`);
    if (profile && !profile.fields?.displayName?.stringValue?.startsWith(m.marker)) throw new Error('Profile is not disposable.');
    if (profile) await deleteDocument(`users/${user.localId}`);
    await request(identity, 'POST', `/v1/projects/${project}/accounts:delete`, { localId: user.localId });
  }
  for (const hid of m.householdIds) if (await getDocument(`households/${hid}`)) throw new Error('Test household still exists after cleanup.');
  console.log(`${m.marker}: removed ${m.householdIds.length} marked households, ${m.inviteIds.length} test invites and ${users.length} test accounts; household deletion verified.`);
}
