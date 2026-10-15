import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createQuickAddHandler } from '../../api/quick-add.js';
import { generateDrafts, systemInstruction } from '../gemini.js';
import { verifyFirebaseToken, readMemberContext } from '../firebaseIdentity.js';
const response = () => { const res = { statusCode: 200, setHeader: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; return res; };
const request = (patch = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer firebase-test-token', origin: 'https://roomsync-beta.vercel.app' }, body: { text: 'Add milk', householdId: 'h1', today: '2026-10-15' }, ...patch });
function setup(patch = {}) {
  const verifyToken = vi.fn(async () => 'alice');
  const readContext = vi.fn(async () => ({ currentRef: 'm0', members: [{ ref: 'm0', uid: 'alice', name: 'Alice' }, { ref: 'm1', uid: 'rahul', name: 'Rahul' }] }));
  const generate = vi.fn(async () => [{ type: 'grocery', title: 'milk', amountRupees: '', date: '', category: 'Dairy', participants: [], clarifications: [] }]);
  return { verifyToken, readContext, generate, handler: createQuickAddHandler({ verifyToken, readContext, generate, env: { NODE_ENV: 'production', VITE_FIREBASE_PROJECT_ID: 'roomsync-test', GEMINI_API_KEY: 'server-secret-test', ...patch } }) };
}
describe('protected server-only Gemini endpoint', () => {
  it('exposes capability only, never the server secret', async () => {
    const { handler } = setup(); const res = response(); await handler(request({ method: 'GET' }), res);
    expect(res.body.configured).toBe(true); expect(JSON.stringify(res.body)).not.toContain('server-secret-test');
  });
  it('rejects invalid methods/origins/content types before inference', async () => {
    for (const req of [request({ method: 'DELETE' }), request({ headers: { origin: 'https://attacker.example', 'content-type': 'application/json' } }), request({ headers: { 'content-type': 'text/plain' } })]) {
      const { handler, generate } = setup(); const res = response(); await handler(req, res); expect(res.statusCode).toBeGreaterThanOrEqual(400); expect(generate).not.toHaveBeenCalled();
    }
  });
  it('does not accept caller member lists, payer ids or key overrides', async () => {
    const { handler, generate } = setup(); const res = response(); await handler(request({ body: { text: 'add milk', householdId: 'h1', today: '2026-10-15', members: ['fake'], apiKey: 'client' } }), res);
    expect(res.statusCode).toBe(400); expect(generate).not.toHaveBeenCalled();
  });
  it('rejects failed Firebase verification without calling Gemini', async () => {
    const generate = vi.fn(); const handler = createQuickAddHandler({ env: { GEMINI_API_KEY: 'secret' }, verifyToken: async () => { throw Object.assign(new Error('Sign in first'), { status: 401 }); }, generate });
    const res = response(); await handler(request(), res); expect(res.statusCode).toBe(401); expect(generate).not.toHaveBeenCalled();
  });
  it('rejects a nonmember before inference', async () => {
    const generate = vi.fn(); const handler = createQuickAddHandler({ env: { GEMINI_API_KEY: 'secret' }, verifyToken: async () => 'nonmember-test', readContext: async () => { throw Object.assign(new Error('Not a member'), { status: 403 }); }, generate });
    const res = response(); await handler(request(), res); expect(res.statusCode).toBe(403); expect(generate).not.toHaveBeenCalled();
  });
  it('sends only pseudonymous refs/minimal names and maps returned refs safely', async () => {
    const s = setup(); s.generate.mockResolvedValue([{ type: 'expense', title: 'Dinner', payerRef: 'm0', participants: ['m0', 'm1', 'external-uid'], amountRupees: '100', splitMethod: 'equally', allocations: [{ memberRef: 'other-household', value: '10' }], source: 'Dinner' }]);
    const res = response(); await s.handler(request(), res);
    expect(res.statusCode).toBe(200);
    const args = s.generate.mock.calls[0][0]; expect(args.members).toEqual([{ ref: 'm0', name: 'Alice' }, { ref: 'm1', name: 'Rahul' }]);
    expect(JSON.stringify(args)).not.toContain('firebase-test-token');
    expect(res.body.drafts[0]).toMatchObject({ payerUid: 'alice', participants: ['alice', 'rahul'], splitMethod: 'equal', allocations: [] });
    expect(JSON.stringify(res.body)).not.toContain('server-secret-test');
  });
  it('keeps missing key and provider quota errors explicit; never silently changes provider', async () => {
    const s = setup({ GEMINI_API_KEY: '' }); const res = response(); await s.handler(request(), res); expect(res.statusCode).toBe(503); expect(s.generate).not.toHaveBeenCalled();
    const q = setup(); q.verifyToken.mockResolvedValue('quota-test'); q.generate.mockRejectedValue(Object.assign(new Error('Quota exhausted'), { status: 429 }));
    const qres = response(); await q.handler(request(), qres); expect(qres.statusCode).toBe(429); expect(qres.body.error).toBe('Quota exhausted');
  });
});
describe('Gemini REST extraction', () => {
  it('uses server key header, complete JSON schema and domain-aware system prompt', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"drafts":[{"type":"grocery","title":"milk"}]}' }] } }] }) }));
    expect(await generateDrafts({ text: 'Add milk', members: [], currentRef: 'm0', today: '2026-10-15', key: 'only-server', fetcher })).toEqual([{ type: 'grocery', title: 'milk' }]);
    const [url, options] = fetcher.mock.calls[0]; expect(url).not.toContain('only-server'); expect(options.headers['x-goog-api-key']).toBe('only-server');
    expect(JSON.parse(options.body).generationConfig.responseMimeType).toBe('application/json');
    const instruction = systemInstruction({ members: [], currentRef: 'm0', today: '2026-10-15' }); expect(instruction).toContain('grocery:'); expect(instruction).toContain('bill:'); expect(instruction).toContain('expense:');
  });
  it('sanitizes provider errors, incomplete responses and malformed JSON', async () => {
    for (const mock of [ { ok: false, status: 403 }, { ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS' }] }) }, { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'NOT JSON' }] } }] }) } ]) {
      await expect(generateDrafts({ text: 'x', members: [], today: '2026-10-15', key: 'not-echoed-secret', fetcher: async () => mock })).rejects.not.toThrow('not-echoed-secret');
    }
  });
});
describe('Firebase ID token and membership verification', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const project = 'roomsync-token-test'; const now = Date.now();
  function token(patch = {}) {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'unit-key' })).toString('base64url');
    const c = Buffer.from(JSON.stringify({ aud: project, iss: `https://securetoken.google.com/${project}`, sub: 'alice', iat: Math.floor(now / 1000) - 5, auth_time: Math.floor(now / 1000) - 10, exp: Math.floor(now / 1000) + 300, ...patch })).toString('base64url');
    return `${h}.${c}.${sign('RSA-SHA256', Buffer.from(`${h}.${c}`), privateKey).toString('base64url')}`;
  }
  it('verifies RSA signature and audience/issuer/expiry, not just decoded claims', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, headers: new Headers({ 'cache-control': 'max-age=300' }), json: async () => ({ 'unit-key': publicKey.export({ type: 'spki', format: 'pem' }) }) }));
    expect(await verifyFirebaseToken(token(), project, { fetcher, now })).toBe('alice');
    await expect(verifyFirebaseToken(token({ aud: 'wrong-project' }), project, { fetcher, now })).rejects.toThrow();
    await expect(verifyFirebaseToken(token({ exp: 1 }), project, { fetcher, now })).rejects.toThrow();
    const bad = token().split('.'); bad[1] = Buffer.from(JSON.stringify({ sub: 'evil' })).toString('base64url');
    await expect(verifyFirebaseToken(bad.join('.'), project, { fetcher, now })).rejects.toThrow();
  });
  it('uses the caller token for Firestore reads and returns only current household members', async () => {
    const fetcher = vi.fn(async (url) => ({ ok: true, json: async () => String(url).includes('/members/alice') ? {} : { documents: [{ name: 'projects/p/databases/(default)/documents/households/h1/members/alice', fields: { displayName: { stringValue: 'Alice' } } }] } }));
    const context = await readMemberContext({ token: 'firebase-id-token', projectId: project, householdId: 'h1', uid: 'alice', fetcher });
    expect(context.currentRef).toBe('m0'); expect(context.members).toEqual([{ ref: 'm0', uid: 'alice', name: 'Alice' }]);
    expect(fetcher.mock.calls.every(([, options]) => options.headers.Authorization === 'Bearer firebase-id-token')).toBe(true);
    await expect(readMemberContext({ token: 'x', projectId: project, householdId: 'h1', uid: 'outsider', fetcher: async () => ({ ok: false, status: 403 }) })).rejects.toThrow('not authorized');
  });
});
