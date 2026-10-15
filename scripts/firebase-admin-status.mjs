// Read-only administrative health check. Uses existing Firebase CLI sign-in
// solely in memory. Only selected non-secret capability/status fields are
// printed or written. In particular never output Auth hash config or tokens.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const project = 'roomsync-9dceb';
const cache = join(homedir(), '.npm/_npx');
const cli = readdirSync(cache).map((entry) => join(cache, entry, 'node_modules/firebase-tools')).find((path) => existsSync(join(path, 'package.json')) && JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version.startsWith('13.'));
if (!cli) throw new Error('Run npx firebase-tools@13 login first.');
const auth = require(join(cli, 'lib/auth.js'));
const { requireAuth } = require(join(cli, 'lib/requireAuth.js'));
const { Client } = require(join(cli, 'lib/apiv2.js'));
const account = auth.getGlobalDefaultAccount();
if (!account) throw new Error('Firebase CLI administrator sign-in required.');
await requireAuth({ project, ...account });
async function get(origin, path) {
  return (await new Client({ urlPrefix: origin }).request({ method: 'GET', path, skipLog: { reqBody: true, resBody: true } })).body;
}
const authConfig = await get('https://identitytoolkit.googleapis.com', `/v2/projects/${project}/config`);
const billing = await get('https://cloudbilling.googleapis.com', `/v1/projects/${project}/billingInfo`);
const database = await get('https://firestore.googleapis.com', `/v1/projects/${project}/databases/(default)`);
const composite = await get('https://firestore.googleapis.com', `/v1/projects/${project}/databases/(default)/collectionGroups/-/indexes`);
const membership = await get('https://firestore.googleapis.com', `/v1/projects/${project}/databases/(default)/collectionGroups/members/fields/uid`);
const release = await get('https://firebaserules.googleapis.com', `/v1/projects/${project}/releases/cloud.firestore`);
const rules = await get('https://firebaserules.googleapis.com', `/v1/${release.rulesetName}`);
const source = rules.source?.files?.find((file) => file.name === 'firestore.rules')?.content || rules.source?.files?.[0]?.content;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const desired = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
const indexes = desired.indexes.map((expected) => {
  const actual = composite.indexes?.find((index) => index.name.includes(`/collectionGroups/${expected.collectionGroup}/`) && index.queryScope === expected.queryScope && expected.fields.every((field, i) => index.fields[i]?.fieldPath === field.fieldPath && index.fields[i]?.order === field.order));
  return { collectionGroup: expected.collectionGroup, fields: expected.fields, state: actual?.state || 'MISSING' };
});
const memberIndex = membership.indexConfig?.indexes?.find((index) => index.queryScope === 'COLLECTION_GROUP' && index.fields[0]?.fieldPath === 'uid');
const report = {
  checkedAt: new Date().toISOString(), projectId: project,
  authentication: { emailPasswordEnabled: authConfig.signIn?.email?.enabled === true && authConfig.signIn?.email?.passwordRequired === true, authorizedDomains: authConfig.authorizedDomains || [] },
  firestore: { database: '(default)', location: database.locationId, type: database.type, rulesMatchLocal: Boolean(source && hash(source) === hash(readFileSync('firestore.rules', 'utf8'))), ruleset: release.rulesetName, indexes, membershipIndexState: memberIndex?.state || 'MISSING' },
  billingEnabled: billing.billingEnabled === true,
  storage: { usedByApplication: false, note: 'Generated avatars and all active features use Auth/Firestore only. No bucket, uploads or billing account required.' },
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--report')) {
  mkdirSync('artifacts/firebase', { recursive: true });
  writeFileSync('artifacts/firebase/status.json', JSON.stringify(report, null, 2) + '\n');
}
if (!report.authentication.emailPasswordEnabled || !report.authentication.authorizedDomains.includes('localhost') || !report.firestore.rulesMatchLocal || indexes.some((i) => i.state !== 'READY') || report.firestore.membershipIndexState !== 'READY') process.exitCode = 1;
