// Vercel server-only endpoint: authenticated/read-only Firebase context ->
// Gemini structured drafts. No Admin keys, Storage, database writes or tools.
import { generateDrafts, GEMINI_MODEL } from '../server/gemini.js';
import { verifyFirebaseToken, readMemberContext } from '../server/firebaseIdentity.js';
export const config = { maxDuration: 60 };
const limits = new Map(); // per warm instance, not a claimed global quota
export function rateAllowed(uid, now = Date.now()) {
  for (const [key, entry] of limits) if (entry.until <= now) limits.delete(key);
  const entry = limits.get(uid) || { until: now + 60000, count: 0, active: false };
  if (entry.count >= 4 || entry.active || limits.size > 2000) return null;
  entry.count++; entry.active = true; limits.set(uid, entry);
  return () => { entry.active = false; };
}
export function createQuickAddHandler({ verifyToken = verifyFirebaseToken, readContext = readMemberContext, generate = generateDrafts, env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET') return res.status(200).json({ provider: env.GEMINI_API_KEY ? 'gemini' : 'local', configured: Boolean(env.GEMINI_API_KEY), model: env.GEMINI_API_KEY ? env.GEMINI_MODEL || GEMINI_MODEL : null });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST with a signed-in household request.' });
    let release;
    try {
      const origin = req.headers.origin;
      const allowed = ['https://roomsync-beta.vercel.app', env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '', env.VERCEL_BRANCH_URL ? `https://${env.VERCEL_BRANCH_URL}` : '', env.NODE_ENV !== 'production' ? 'http://localhost:5173' : ''];
      if (origin && !allowed.includes(origin)) return res.status(403).json({ error: 'This request origin is not allowed.' });
      if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).json({ error: 'Send a JSON request.' });
      if (Number(req.headers['content-length'] || 0) > 16000) return res.status(413).json({ error: 'Request is too large.' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || Object.keys(body).some((key) => !['text', 'householdId', 'today'].includes(key)) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 6000 || typeof body.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.today)) return res.status(400).json({ error: 'Describe 1–6,000 characters and supply the household/date context.' });
      const token = String(req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
      const projectId = env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID;
      const uid = await verifyToken(token, projectId);
      if (!env.GEMINI_API_KEY) return res.status(503).json({ error: 'Gemini server key is not configured. You may explicitly choose local parsing.' });
      release = rateAllowed(uid);
      if (!release) return res.status(429).json({ error: 'Please wait before parsing again (one active request and four attempts per minute per server instance).' });
      const context = await readContext({ token, projectId, householdId: body.householdId, uid });
      // Send pseudonymous refs + minimal member names, not UIDs/emails, ledger,
      // auth tokens, financial history or unrelated household data to Gemini.
      const drafts = await generate({ text: body.text, today: body.today, currentRef: context.currentRef, members: context.members.map(({ ref, name }) => ({ ref, name })), key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || GEMINI_MODEL });
      const refs = Object.fromEntries(context.members.map(({ ref, uid }) => [ref, uid]));
      const mapRef = (ref) => typeof ref === 'string' && Object.hasOwn(refs, ref) ? refs[ref] : '';
      const safe = drafts.map((draft) => ({
        type: ['expense', 'grocery', 'bill'].includes(draft.type) ? draft.type : 'unknown',
        title: typeof draft.title === 'string' ? draft.title.slice(0, 200) : '',
        amountRupees: typeof draft.amountRupees === 'string' ? draft.amountRupees.slice(0, 32) : '',
        date: typeof draft.date === 'string' ? draft.date.slice(0, 10) : '', category: typeof draft.category === 'string' ? draft.category.slice(0, 40) : '',
        payerUid: mapRef(draft.payerRef), assignedUid: mapRef(draft.assignedRef),
        participants: Array.isArray(draft.participants) ? [...new Set(draft.participants.map(mapRef).filter(Boolean))].slice(0, 8) : [],
        splitMethod: ['equal', 'custom', 'percentage', 'shares'].includes(draft.splitMethod) ? draft.splitMethod : draft.splitMethod === 'equally' ? 'equal' : '',
        allocations: Array.isArray(draft.allocations) ? draft.allocations.slice(0, 8).map((allocation) => ({ uid: mapRef(allocation.memberRef), value: typeof allocation.value === 'string' ? allocation.value.slice(0, 32) : '' })).filter((allocation) => allocation.uid) : [],
        recurrence: ['one-time', 'weekly', 'monthly', 'yearly'].includes(draft.recurrence) ? draft.recurrence : '',
        quantity: typeof draft.quantity === 'string' ? draft.quantity.slice(0, 30) : '', unit: typeof draft.unit === 'string' ? draft.unit.slice(0, 30) : '',
        description: typeof draft.description === 'string' ? draft.description.slice(0, 1000) : '', source: typeof draft.source === 'string' ? draft.source.slice(0, 800) : '',
        clarifications: Array.isArray(draft.clarifications) ? draft.clarifications.filter((text) => typeof text === 'string').slice(0, 10).map((text) => text.slice(0, 300)) : [],
      }));
      return res.status(200).json({ provider: 'gemini', model: env.GEMINI_MODEL || GEMINI_MODEL, drafts: safe });
    } catch (error) {
      const status = Number(error.status);
      return res.status([400, 401, 403, 413, 422, 429, 502, 503].includes(status) ? status : 503).json({ error: error.status ? error.message : error.name === 'TimeoutError' || error.name === 'AbortError' ? 'Parsing timed out. Nothing was saved. Retry or choose local parsing.' : 'Could not securely prepare Gemini drafts. Nothing was saved. Retry or use the normal forms.' });
    } finally { release?.(); }
  };
}
export default createQuickAddHandler();
