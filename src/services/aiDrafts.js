// Browser sends only the prompt, household ID and local date to its same-origin
// authenticated server endpoint. Gemini key is NEVER read from frontend env.
import { auth } from '../firebase.js';
import { normalizeGeminiDrafts } from '../lib/householdDrafts.js';
import { parseExpenseBatch } from '../lib/expenseBatch.js';
import { parseQuickAdd } from '../lib/quickAdd.js';
import { isoDate } from '../lib/recurrence.js';
export async function geminiStatus() {
  const response = await fetch('/api/quick-add', { cache: 'no-store' });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return { configured: false, error: 'The Gemini server endpoint is unavailable. Local parsing remains available.' };
  return response.json();
}
export async function parseGeminiRecords(text, { householdId, members, useToday, useEqualHousehold, today = isoDate(new Date()) }) {
  if (!auth.currentUser) throw new Error('Sign in before asking Gemini.');
  const token = await auth.currentUser.getIdToken();
  const response = await fetch('/api/quick-add', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text, householdId, today }), signal: AbortSignal.timeout(55000) });
  let body; try { body = await response.json(); } catch { throw new Error('The AI endpoint is unavailable. No records saved. Use local parsing or normal forms.'); }
  if (!response.ok) throw new Error(body.error || 'Gemini parsing failed. No records saved.');
  if (body.provider !== 'gemini') throw new Error('The server did not return a verified Gemini draft response.');
  return { provider: 'gemini', model: body.model, items: normalizeGeminiDrafts(body.drafts, { members, useToday, useEqualHousehold, today }) };
}
export function parseLocalRecords(text, options) {
  const clauses = text.split(/[;\n]+/).map((part) => part.trim()).filter(Boolean);
  const routed = clauses.some((part) => /^(?:add|create|buy|need|schedule)\b/i.test(part) && /\b(?:bill|grocery|shopping|milk|rice|bread)\b/i.test(part));
  if (!routed) return parseExpenseBatch(text, options).map((item) => ({ ...item, kind: 'expense' }));
  const items = clauses.flatMap((clause) => {
    const result = parseQuickAdd(clause, options);
    if (!result.error && result.action === 'grocery') return [{ id: crypto.randomUUID(), kind: 'grocery', source: clause, notices: [...result.warnings, 'Local parsing, not Gemini. Shopping-list item only.'], input: result.data, reviewed: false, skipped: false }];
    if (!result.error && result.action === 'bill') return [{ id: crypto.randomUUID(), kind: 'bill', source: clause, notices: [...result.warnings, 'Local parsing, not Gemini. Upcoming unpaid bill only. Review due date and split.'], input: result.data, reviewed: false, skipped: false }];
    return parseExpenseBatch(clause, options).map((item) => ({ ...item, kind: 'expense' }));
  });
  if (items.length > 8) throw new Error('Review up to 8 records per batch.');
  return items;
}
