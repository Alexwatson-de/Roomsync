// Free local drafting, not an AI/LLM integration. Never writes to Firestore.
// Conservative extraction: ambiguous/unmentioned financial facts remain blank.
import { parseQuickAdd } from './quickAdd.js';
import { parseAmountToPaise } from './money.js';
import { isoDate } from './recurrence.js';
export const MAX_BATCH_EXPENSES = 8;
const NUMBER = '\\d[\\d,]*(?:\\.\\d{1,2})?';
const AMOUNT_FOR = new RegExp(`(?:₹|\\bINR\\b|\\bRs\\.?)?\\s*(${NUMBER})\\s+(?:for|on)\\s+`, 'i');
const CURRENCY_AMOUNT = new RegExp(`(?:₹|\\bINR\\b|\\bRs\\.?)\\s*(${NUMBER})(?![\\d.])`, 'i');
const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clean = (value) => value.replace(/^[\s,:-]+|[\s,.!?]+$/g, '').trim();
const DATE = /\b(?:\d{4}-\d{2}-\d{2}|today|yesterday|tomorrow)\b/i;
const SPLIT = /\b(?:split|shared|between|among)\b/i;
const ACTOR = /^\s*(?:today\s+|yesterday\s+|tomorrow\s+)?(.+?)\s+(?:paid|spent)\b/i;
const makeId = () => crypto.randomUUID();

function startsExpense(value) {
  const text = value.trim();
  return /^(?:today\s+|yesterday\s+|tomorrow\s+)?[\p{L}][\p{L}\s.'-]{0,65}\s+(?:paid|spent)\b/iu.test(text)
    || new RegExp(`^(?:₹|INR|Rs\\.?)?\\s*${NUMBER}\\s+(?:for|on)\\b`, 'i').test(text)
    || /^(?:groceries|electricity|rent|internet|dinner|lunch|food|transport|utilities|taxi|water|gas)\s+(?:₹|INR|Rs\.?|\d)/i.test(text);
}
function splitLinkedList(sentence) {
  const pieces = []; let start = 0;
  const separators = /,\s*(?:and\s+)?|\s+and\s+/gi;
  for (const match of sentence.matchAll(separators)) {
    // Commas inside INR grouping or named split allocations aren't boundaries.
    if (match[0] === ',' && /\d$/.test(sentence.slice(0, match.index)) && /^\d/.test(sentence.slice(match.index + 1))) continue;
    if (startsExpense(sentence.slice(match.index + match[0].length))) {
      pieces.push(clean(sentence.slice(start, match.index))); start = match.index + match[0].length;
    }
  }
  pieces.push(clean(sentence.slice(start)));
  return pieces.filter(Boolean);
}
function resolvePerson(name, members, currentUid) {
  const key = normalize(name);
  if (['i', 'me', 'myself'].includes(key)) return { uid: members.some((m) => m.uid === currentUid) ? currentUid : '', problem: 'The signed-in user must be a current household member.' };
  const exact = members.filter((m) => normalize(m.displayName) === key);
  const matches = exact.length ? exact : members.filter((m) => normalize(m.displayName).split(' ')[0] === key);
  if (matches.length === 1) return { uid: matches[0].uid };
  return { uid: '', problem: `${matches.length ? 'Ambiguous' : 'Unknown'} payer “${name}”. Select the correct current member.` };
}
function categoryOf(text) {
  if (/\b(?:rent)\b/i.test(text)) return 'Rent';
  if (/\belectric(?:ity)?\b/i.test(text)) return 'Electricity';
  if (/\b(?:internet|wifi|wi-fi)\b/i.test(text)) return 'Internet';
  if (/\b(?:groceries|grocery|vegetables|milk|rice)\b/i.test(text)) return 'Groceries';
  if (/\b(?:dinner|lunch|breakfast|food|dining|restaurant|pizza)\b/i.test(text)) return 'Food & dining';
  if (/\b(?:taxi|transport|uber|bus|fuel|petrol)\b/i.test(text)) return 'Transport';
  if (/\b(?:cleaning|detergent)\b/i.test(text)) return 'Cleaning supplies';
  if (/\bfurniture\b/i.test(text)) return 'Furniture';
  if (/\brepairs?\b/i.test(text)) return 'Repairs';
  return 'Other';
}
function amountAndTitle(clause) {
  // A custom share is never the expense total, even when the total is missing.
  clause = clause.split(SPLIT)[0];
  const match = clause.match(AMOUNT_FOR);
  if (match) return { amount: match[1], title: clause.slice(match.index + match[0].length) };
  const currency = clause.match(CURRENCY_AMOUNT);
  if (currency) {
    const before = clause.slice(0, currency.index).replace(ACTOR, '').replace(/^(?:add|record)\s+(?:an?\s+)?expense\s*(?:for)?\s*/i, '');
    const after = clause.slice(currency.index + currency[0].length).replace(/^\s*(?:for|on)\s+/i, '');
    return { amount: currency[1], title: before.trim() || after };
  }
  const labelAmount = clause.match(new RegExp(`^(?:I\\s+paid\\s+)?(.+?)\\s+(${NUMBER})(?=\\s*(?:today|yesterday|tomorrow|on|split|shared|$))`, 'i'));
  if (labelAmount) return { amount: labelAmount[2], title: labelAmount[1] };
  return { amount: null, title: clause.replace(ACTOR, '').replace(/^(?:add|record)\s+(?:an?\s+)?expense\s*(?:for)?\s*/i, '') };
}

export function parseExpenseBatch(text, { members = [], currentUid, today = isoDate(new Date()), useToday = false, useEqualHousehold = false } = {}) {
  const source = String(text || '').trim();
  if (!source || source.length > 6000) throw new Error('Describe between 1 and 6,000 characters, with at most 8 expenses.');
  if (/\b(?:delete|erase|refund|reverse|make me admin)\b/i.test(source)) throw new Error('This wizard only adds expenses. Deletions, refunds and permission changes are not supported.');
  if (/[€£$]/.test(source)) throw new Error('Use INR/rupee amounts only. No currency conversion is configured.');
  const sentences = source.replace(/\bRs\.(?=\s*\d)/gi, 'Rs').split(/[;\n]+|[.!?](?=\s+(?:[A-Z]|\d|₹)|\s*$)/).map(clean).filter(Boolean);
  const items = [];
  for (const sentence of sentences) {
    const clauses = splitLinkedList(sentence);
    const dates = clauses.map((c) => c.match(DATE)?.[0]);
    const splits = clauses.map((c) => c.match(/\b(?:split|shared|between|among)\b.+/i)?.[0]);
    // A single date/split at the very end of a linked list is explicit shared
    // list context. Never propagate context across separate sentences/lines.
    const sharedDate = clauses.length > 1 && dates.filter(Boolean).length === 1 && dates.at(-1) ? dates.at(-1) : null;
    const sharedSplit = clauses.length > 1 && splits.filter(Boolean).length === 1 && splits.at(-1) ? splits.at(-1) : null;
    let inheritedActor = sentence.match(ACTOR)?.[1]?.trim() || '';
    const leadingDate = sentence.match(/^(today|yesterday|tomorrow)\b/i)?.[1];
    for (const clause of clauses) {
      const notices = [];
      const extracted = amountAndTitle(clause);
      let amount = extracted.amount ? parseAmountToPaise(extracted.amount) : null;
      if (amount !== null && (amount <= 0 || amount > 1e10)) amount = null;
      if (/(?:₹|INR|Rs\.?)\s*-\s*\d|\bpaid\s+-\d|\b\d[\d,]*\.\d{3,}/i.test(clause)) amount = null;
      const explicitActor = clause.match(ACTOR)?.[1]?.trim();
      const byActor = clause.match(/\bpaid\s+by\s+(.+?)(?=\s+(?:for|on|split|shared|today|yesterday|tomorrow)|$)/i)?.[1]?.trim();
      if (explicitActor) inheritedActor = explicitActor;
      const actor = byActor || explicitActor || inheritedActor;
      const resolved = actor ? resolvePerson(actor, members, currentUid) : { uid: '', problem: 'Payer is missing. Choose who actually paid.' };
      if (!resolved.uid) notices.push(resolved.problem);
      if (!amount) notices.push('Amount is missing, invalid or ambiguous. Enter the exact rupee total.');
      const clauseDate = clause.match(DATE)?.[0] || sharedDate || leadingDate;
      const splitText = clause.match(/\b(?:split|shared|between|among)\b.+/i)?.[0] || sharedSplit || '';
      let title = extracted.title.split(/\b(?:today|yesterday|tomorrow|on\s+\d{4}-\d{2}-\d{2}|split|shared|between|among|paid by)\b/i)[0];
      title = clean(title.split(/\b(?:note|description)\s*[:=]/i)[0].replace(/^(?:for|on)\s+/i, '').replace(/\b(?:on|yesterday|today|tomorrow)$/i, ''));
      const quoted = clause.match(/["“]([^"”]+)["”]/); if (quoted) title = quoted[1];
      // Reuse the existing split/name/date parser on a canonical single-item
      // request. Its implicit defaults are deliberately cleared below.
      const canonical = `I paid ₹${amount ? (amount / 100).toFixed(2) : '0'} for "${title.replaceAll('"', '')}" ${clauseDate || ''} ${splitText}`;
      const parsed = parseQuickAdd(canonical, { members, currentUid, today, action: 'expense' });
      let date = clauseDate ? parsed.data?.date || '' : useToday ? today : '';
      if (/\b(?:next\s+(?:week|month|year)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}\/\d{1,2}\b/i.test(clause)) date = '';
      if (!date) notices.push('Date is missing or unsupported. Select the actual expense date.');
      else if (!clauseDate) notices.push('Today was selected using your explicit batch default.');
      if (sharedDate && !clause.match(DATE)) notices.push(`“${sharedDate}” at the end applies to this linked expense list. Check the date.`);
      let participants = splitText ? parsed.data?.participants || [] : useEqualHousehold ? members.map((m) => m.uid) : [];
      let splitMethod = splitText ? parsed.data?.splitMethod || '' : useEqualHousehold ? 'equal' : '';
      let splitDetail = splitText ? parsed.data?.splitDetail || null : null;
      const namedPeople = /\b(?:between|among|with)\b/i.test(splitText) || splitMethod !== 'equal';
      if (splitText && !namedPeople && !useEqualHousehold) participants = [];
      if (splitText && !/\b(?:equal(?:ly)?|unequal(?:ly)?|custom|amounts|shares?|percentages?)\b|%|\d\s*:\s*\d/i.test(splitText)) splitMethod = '';
      if (!participants.length) notices.push('Choose exactly who shares this expense.');
      if (!splitMethod) notices.push('Choose the split method; none was assumed.');
      if (!splitText && useEqualHousehold) notices.push('Equal split across current members was selected using your explicit batch default.');
      if (sharedSplit && !clause.match(SPLIT)) notices.push('The trailing split instruction applies to this linked list. Review participants and shares.');
      if (parsed.error || parsed.requests?.length) {
        notices.push(...(parsed.requests || []).map((r) => `${r.ambiguous ? 'Ambiguous' : 'Unknown'} split member “${r.name}”. Select members manually.`));
        if (parsed.error) notices.push(parsed.error);
        participants = []; splitDetail = null;
      }
      if (splitMethod && splitMethod !== 'equal' && !splitDetail) notices.push('Enter the unequal allocation for every selected participant.');
      if (/\b(?:utilities|water|gas)\b/i.test(title)) notices.push('Utilities are classified as Other in this household’s existing category list. Change the category if needed.');
      if (!title) notices.push('Add a short title/description for this expense.');
      const description = clause.match(/\b(?:note|description)\s*[:=]\s*(.+)$/i)?.[1]?.trim() || '';
      items.push({ id: makeId(), source: clause, notices: [...new Set(notices)], input: { title: title.slice(0, 200), totalPaise: amount, category: categoryOf(title), description, date, payers: resolved.uid ? { [resolved.uid]: amount || 0 } : {}, participants, splitMethod, splitDetail }, reviewed: false, skipped: false });
    }
  }
  if (!items.length) throw new Error('No expense clauses were found. Try separate expenses with commas, new lines, or semicolons.');
  if (items.length > MAX_BATCH_EXPENSES) throw new Error(`Review at most ${MAX_BATCH_EXPENSES} expenses per atomic batch. Please split the request into smaller batches.`);
  return items;
}

export function duplicateExpenseGroups(items) {
  const groups = new Map();
  for (const item of items.filter((entry) => !entry.skipped)) {
    const input = item.input;
    const signature = JSON.stringify([item.kind || 'expense', normalize(input.title || input.name), input.totalPaise ?? input.expectedPaise, input.date || input.dueDate, input.quantity, input.unit, input.assignedTo, input.recurrence, Object.entries(input.payers || {}).sort(), input.participants?.slice().sort(), input.splitMethod, input.splitDetail ? Object.entries(input.splitDetail).sort() : null]);
    groups.set(signature, [...(groups.get(signature) || []), item.id]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function batchDocumentId(batchId, itemId) {
  if (!/^[a-f0-9-]{36}$/.test(batchId) || !/^[a-f0-9-]{36}$/.test(itemId)) throw new Error('Invalid batch identity. Start a new batch before submitting.');
  return `batch_${batchId}_${itemId}`;
}
export async function batchFingerprint({ householdId, uid, items }) {
  // Preserve v1 expense-only fingerprints so an already confirmed old batch
  // can still check/retry after this release, without a migration.
  const canonical = items.map(({ id, input, kind }) => kind && kind !== 'expense' ? { id, kind, ...input, ...(input.participants ? { participants: [...input.participants].sort() } : {}) } : ({ id, ...input, payers: Object.fromEntries(Object.entries(input.payers).sort()), shares: Object.fromEntries(Object.entries(input.shares).sort()), participants: [...input.participants].sort(), payerIds: [...input.payerIds].sort(), splitDetail: input.splitDetail ? Object.fromEntries(Object.entries(input.splitDetail).sort()) : null }));
  const bytes = new TextEncoder().encode(JSON.stringify({ householdId, uid, items: canonical }));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
