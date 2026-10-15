// Untrusted AI output is only a draft. Destination and values stay editable.
// Only these fixed collections/types can ever be confirmed. No model tools.
import { parseAmountToPaise } from './money.js';
import { buildExpenseData } from './expenseData.js';
import { BILL_CATEGORIES, GROCERY_CATEGORIES, EXPENSE_CATEGORIES } from './constants.js';
export const DRAFT_TYPES = { expense: 'Expenses', grocery: 'Groceries', bill: 'Bills', unknown: 'Choose section' };
export const draftCollection = (kind) => ({ expense: 'expenses', grocery: 'shoppingItems', bill: 'bills' }[kind]);
export function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '1900-01-01' && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function buildHouseholdDraft(kind, input) {
  if (kind === 'expense') return buildExpenseData(input);
  if (kind === 'grocery') {
    if (!input.name?.trim() || input.name.length > 200) throw new Error('Enter a shopping item name of 1–200 characters.');
    if (!GROCERY_CATEGORIES.includes(input.category)) throw new Error('Choose a grocery category.');
    return { name: input.name.trim(), quantity: String(input.quantity || '').slice(0, 30), unit: String(input.unit || '').slice(0, 30), category: input.category, notes: String(input.notes || '').trim().slice(0, 1000), assignedTo: input.assignedTo || null };
  }
  if (kind === 'bill') {
    if (!input.name?.trim() || input.name.length > 200) throw new Error('Enter a bill name of 1–200 characters.');
    if (!Number.isSafeInteger(input.expectedPaise) || input.expectedPaise <= 0 || input.expectedPaise > 1e10) throw new Error('Enter a valid expected bill amount.');
    if (!validDate(input.dueDate)) throw new Error('Choose the actual bill due date.');
    if (!BILL_CATEGORIES.includes(input.category)) throw new Error('Choose a bill category.');
    if (!['one-time', 'weekly', 'monthly', 'yearly'].includes(input.recurrence)) throw new Error('Choose whether this bill repeats.');
    if (!input.participants?.length || new Set(input.participants).size !== input.participants.length || input.participants.length > 8) throw new Error('Select 1–8 bill participants.');
    if (input.splitMethod && input.splitMethod !== 'equal') throw new Error('Bill templates currently use equal splits; record unequal paid amounts as an expense.');
    return { name: input.name.trim(), category: input.category, expectedPaise: input.expectedPaise, dueDate: input.dueDate, recurrence: input.recurrence, assignedTo: input.assignedTo || null, participants: [...input.participants], splitMethod: 'equal', splitDetail: null, notes: String(input.notes || '').trim().slice(0, 1000) };
  }
  throw new Error('Choose Expenses, Groceries or Bills before continuing.');
}
export function draftPeople(kind, input) {
  return kind === 'grocery' ? (input.assignedTo ? [input.assignedTo] : []) : kind === 'bill' ? [...input.participants, ...(input.assignedTo ? [input.assignedTo] : [])] : [...input.participants, ...input.payerIds];
}
export function normalizeGeminiDrafts(raw, { members, useToday, useEqualHousehold, today }) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 8) throw new Error('The parser must return 1–8 draft records.');
  const uids = new Set(members.map((m) => m.uid));
  return raw.map((draft) => {
    const kind = draftCollection(draft.type) ? draft.type : 'unknown';
    const amount = parseAmountToPaise(draft.amountRupees);
    const notices = [...(draft.clarifications || []), 'Gemini suggestions may be wrong. Verify section, values and members; no records have been saved.'];
    const payerUid = uids.has(draft.payerUid) ? draft.payerUid : '';
    const assignedTo = uids.has(draft.assignedUid) ? draft.assignedUid : '';
    let participants = (draft.participants || []).filter((uid) => uids.has(uid));
    let splitMethod = ['equal', 'custom', 'percentage', 'shares'].includes(draft.splitMethod) ? draft.splitMethod : '';
    if (!participants.length && useEqualHousehold && (!splitMethod || splitMethod === 'equal')) { participants = [...uids]; splitMethod = 'equal'; notices.push('You enabled equal-household defaults for missing split information.'); }
    let date = validDate(draft.date) ? draft.date : '';
    if (!date && useToday) { date = today; notices.push('You enabled today as the missing-date default.'); }
    let splitDetail = null;
    if (splitMethod && splitMethod !== 'equal') {
      const allocations = {}; let safe = true;
      for (const entry of draft.allocations || []) {
        if (!uids.has(entry.uid) || entry.uid in allocations) { safe = false; break; }
        const value = splitMethod === 'custom' ? parseAmountToPaise(entry.value) : /^\d+(?:\.\d{1,2})?$/.test(entry.value) ? Number(entry.value) : null;
        if (value === null) { safe = false; break; }
        allocations[entry.uid] = value;
      }
      if (safe && Object.keys(allocations).length) splitDetail = allocations;
      else notices.push('Review the unequal allocations; unresolved or invalid values were not invented.');
    }
    const title = typeof draft.title === 'string' ? draft.title.slice(0, 200) : '';
    let input;
    if (kind === 'grocery') input = { name: title, quantity: draft.quantity || '', unit: draft.unit || '', category: GROCERY_CATEGORIES.includes(draft.category) ? draft.category : 'Miscellaneous', notes: draft.description || '', assignedTo };
    else if (kind === 'bill') input = { name: title, category: BILL_CATEGORIES.includes(draft.category) ? draft.category : 'Other', expectedPaise: amount && amount > 0 ? amount : null, dueDate: date, recurrence: ['one-time', 'weekly', 'monthly', 'yearly'].includes(draft.recurrence) ? draft.recurrence : '', assignedTo, participants, notes: draft.description || '', splitMethod: 'equal' };
    else input = { title, totalPaise: amount && amount > 0 ? amount : null, category: EXPENSE_CATEGORIES.includes(draft.category) ? draft.category : 'Other', description: draft.description || '', date, payers: payerUid ? { [payerUid]: amount || 0 } : {}, participants, splitMethod, splitDetail };
    if (kind === 'grocery') notices.push('Groceries = shopping-list item only. No expense or balance change will be created.');
    if (kind === 'bill') notices.push('Bills = unpaid bill reminder/template only. No expense is created until you later record its payment.');
    if (kind === 'expense') notices.push('Expenses = money paid/spent. A Groceries category does not automatically add a shopping item. Change section if this was only a plan to buy.');
    if (kind === 'bill' && draft.splitMethod && draft.splitMethod !== 'equal') notices.push('This bill form supports equal splits only. Review this explicitly; use Expenses for an unequal paid expense.');
    return { id: crypto.randomUUID(), kind, source: String(draft.source || '').slice(0, 800), notices, input, reviewed: false, skipped: false, aiEvidence: { title, amount, date, payerUid, assignedTo, participants, splitMethod, splitDetail, recurrence: draft.recurrence, quantity: draft.quantity, unit: draft.unit, category: draft.category, description: draft.description } };
  });
}
export function changeDraftKind(item, kind) {
  if (!draftCollection(kind)) return { ...item, kind: 'unknown', reviewed: false, editorState: undefined };
  const old = item.input; const e = item.aiEvidence || {};
  const title = old.title || old.name || e.title || '';
  const amount = old.totalPaise ?? old.expectedPaise ?? e.amount ?? null;
  const date = old.date || old.dueDate || e.date || '';
  let input;
  if (kind === 'grocery') input = { name: title, quantity: e.quantity || '', unit: e.unit || '', category: GROCERY_CATEGORIES.includes(old.category) ? old.category : 'Miscellaneous', notes: old.description || old.notes || '', assignedTo: old.assignedTo || e.assignedTo || '' };
  if (kind === 'bill') input = { name: title, expectedPaise: amount, dueDate: date, category: BILL_CATEGORIES.includes(old.category) ? old.category : 'Other', recurrence: e.recurrence || '', assignedTo: e.assignedTo || '', participants: old.participants || e.participants || [], notes: old.description || old.notes || '', splitMethod: 'equal' };
  if (kind === 'expense') input = { title, totalPaise: amount, date, category: EXPENSE_CATEGORIES.includes(old.category) ? old.category : 'Other', payers: old.payers || (e.payerUid ? { [e.payerUid]: amount || 0 } : {}), participants: old.participants || e.participants || [], splitMethod: e.splitMethod || old.splitMethod || '', splitDetail: e.splitDetail || null, description: old.notes || old.description || '' };
  return { ...item, kind, input, editorState: undefined, reviewed: false };
}
