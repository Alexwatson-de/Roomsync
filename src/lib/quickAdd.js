// Free, deterministic Quick Add: text -> editable draft ONLY. No network,
// database writes, AI credentials or arbitrary command execution. Unknown and
// ambiguous facts remain visible for review instead of being silently guessed.
import { parseAmountToPaise } from './money.js';
import { isoDate, fromIso } from './recurrence.js';
export const QUICK_ACTIONS = [
  ['expense', 'Shared expense'], ['grocery', 'Grocery item'], ['bill', 'New bill'],
  ['chore', 'New chore'], ['settlement', 'Repayment record'],
  ['payBill', 'Mark existing bill paid'], ['purchase', 'Purchase an existing item'],
  ['completeChore', 'Complete an existing chore'],
];
const NUMBER = '\\d[\\d,]*(?:\\.\\d{1,2})?';
const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clean = (value) => String(value || '').trim().replace(/^["']|["'.!]$/g, '').trim();
const money = (value) => { const parsed = parseAmountToPaise(value); return parsed !== null && parsed > 0 && parsed <= 1e10 ? parsed : null; };

function classify(text) {
  if (/\b(delete|remove|erase|reverse|refund|change role|make.+admin)\b/i.test(text)) return null;
  if (/\b(mark|set)\b.+\b(?:bill|rent|internet|electricity)\b.+\bpaid\b|\bpay\s+(?:the\s+)?(?:existing\s+)?bill\b/i.test(text)) return 'payBill';
  if (/\b(?:mark|set)\b.+\b(?:purchased|bought)\b/i.test(text)) return 'purchase';
  if (/\b(?:complete|finish|completed|finished)\b.+|\bmark\b.+\b(?:chore|task)\b.+\bdone\b/i.test(text)) return 'completeChore';
  if (/\b(?:repay|repaid|repayment|settlement|settle up|paid back)\b|\b(?:paid|pay)\b.+\bback\b/i.test(text)) return 'settlement';
  if (/\b(?:bill|remind)\b.*\b(?:due|monthly|weekly|yearly|recurring)\b|\b(?:add|create|schedule)\b.*\bbill\b/i.test(text)) return 'bill';
  if (/\b(?:chore|task|assign|rotate)\b|^(?:clean|wash|take out|vacuum|sweep)\b/i.test(text)) return 'chore';
  if (/\b(?:paid|pay|spent|expense|cost|split|shared equally|shared unequally)\b/i.test(text)) return 'expense';
  if (/\b(?:bought|purchased)\b.*(?:₹|INR|Rs\.?|for\s+\d)/i.test(text)) return 'expense';
  if (/\b(?:add|buy|need|shopping|grocery|groceries|list)\b/i.test(text)) return 'grocery';
  return null;
}

function dateFrom(text, today, warnings) {
  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicit) {
    const value = explicit[1];
    if (isoDate(fromIso(value)) === value) return value;
    warnings.push('The written date is invalid. Choose the correct date in the form.');
    return '';
  }
  const offset = /\byesterday\b/i.test(text) ? -1 : /\btomorrow\b/i.test(text) ? 1 : 0;
  const day = fromIso(today); day.setDate(day.getDate() + offset);
  if (!/\b(today|yesterday|tomorrow)\b/i.test(text)) warnings.push('Date defaults to today. Change it if needed; use YYYY-MM-DD for an exact date.');
  if (/\b(next\s+(?:week|month|year)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}[\/-]\d{1,2}\b/i.test(text)) {
    warnings.push('This date wording needs review. Select the intended calendar date.');
    return '';
  }
  return isoDate(day);
}
function extractAmount(text) {
  // Restrict the total to the portion BEFORE split allocations, avoiding the
  // dangerous mistake of interpreting a member's custom share as the total.
  const head = text.split(/\b(?:split|shared|between|among|participants|shares|percentages?)\b/i)[0].replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
  const patterns = [
    new RegExp(`(?:₹|\\bINR\\b|\\bRs\\.?|\\brupees?)\\s*(${NUMBER})(?![\\d.])`, 'i'),
    new RegExp(`\\b(${NUMBER})\\s*(?:rupees?|INR|rs\\.?)(?!\\w)`, 'i'),
    new RegExp(`\\b(?:paid|pay|spent|costs?|amount|repay|repaid|settlement)\\s+(?:of\\s+)?(${NUMBER})(?![\\d.])`, 'i'),
    new RegExp(`\\b(?:paid|pay|spent|repay|repaid|bill)\\b.*?\\b(${NUMBER})(?![\\d.])`, 'i'),
  ];
  for (const pattern of patterns) { const match = head.match(pattern); if (match) return money(match[1]); }
  return null;
}
function categoryFrom(text, kind) {
  const entries = kind === 'grocery' ? [
    ['Cleaning supplies', /cleaning|detergent|soap/i], ['Dairy', /milk|cheese|butter|curd|yogurt/i],
    ['Vegetables', /tomato|potato|onion|vegetable|spinach/i], ['Fruits', /apple|banana|fruit|orange/i],
    ['Grains', /rice|flour|grain|wheat|bread/i], ['Snacks', /snack|chips|biscuit|cookie/i],
  ] : [
    ['Rent', /\brent\b/i], ['Electricity', /\belectric(?:ity)?\b/i], ['Internet', /\b(?:internet|wifi|wi-fi)\b/i],
    ['Groceries', /\b(?:grocer\w*|milk|rice|vegetables)\b/i], ['Cleaning supplies', /\b(?:detergent|cleaning supplies)\b/i],
    ['Furniture', /\b(?:furniture|sofa|chair)\b/i], ['Repairs', /\b(?:repair|plumber)\b/i],
    ['Food & dining', /\b(?:dinner|lunch|food|restaurant|pizza)\b/i], ['Transport', /\b(?:taxi|uber|transport|petrol|fuel)\b/i],
  ];
  return entries.find(([, pattern]) => pattern.test(text))?.[0] || (kind === 'grocery' ? 'Miscellaneous' : 'Other');
}
function recurrenceFrom(text) {
  if (/\b(?:every day|daily)\b/i.test(text)) return 'daily';
  if (/\b(?:every week|weekly)\b/i.test(text)) return 'weekly';
  if (/\b(?:every month|monthly)\b/i.test(text)) return 'monthly';
  if (/\b(?:every year|yearly|annually)\b/i.test(text)) return 'yearly';
  return 'one-time';
}
function trimTail(text) {
  return text.split(/\b(?:shared|split|between|among|due|today|yesterday|tomorrow|every|daily|weekly|monthly|yearly|assigned|assign to|for me|priority|notes?)\b|\bon\s+\d{4}-\d{2}-\d{2}\b/i)[0].trim();
}
function titleFrom(text, kind, total) {
  const quoted = text.match(/["“]([^"”]+)["”]/);
  if (quoted) return quoted[1].slice(0, 200);
  let title = text;
  if (kind === 'expense') {
    const forMatch = text.match(/\bfor\s+(.+)/i);
    const boughtMatch = text.match(/\b(?:bought|purchased)\s+(.+?)\s+for\s+(?:₹|INR|Rs\.?|\d)/i);
    title = boughtMatch ? boughtMatch[1] : forMatch ? forMatch[1] : text.replace(/^.*?\b(?:paid|pay|spent|add\s+(?:an?\s+)?expense)\b/i, '');
  } else if (kind === 'grocery') title = text.replace(/^(?:please\s+)?(?:i\s+)?(?:add|buy|need)\s+(?:a\s+)?(?:grocery\s+item\s+)?/i, '').replace(/\s+to (?:the |my |our )?(?:shopping|grocery) list.*$/i, '');
  else if (kind === 'bill') title = text.replace(/^(?:please\s+)?(?:add|create|schedule)\s+(?:an?\s+)?/i, '').replace(/\bbill\b/i, '');
  else if (kind === 'chore') title = text.replace(/^(?:please\s+)?(?:add|create|assign|schedule)\s+(?:an?\s+)?(?:chore|task)?\s*/i, '').replace(/\s+to\s+.+$/i, '');
  title = trimTail(title);
  if (kind === 'expense' || kind === 'bill') title = title.replace(new RegExp(`(?:₹|\\bINR\\b|\\bRs\\.?|\\brupees?)?\\s*${NUMBER}\\s*(?:rupees?|INR|rs\\.?)?`, 'ig'), '');
  title = title.replace(/\b(?:equally|unequally|paid|pay|amount|by|for)\s*$/i, '').replace(/^[\s:=-]+|[\s:=-]+$/g, '');
  return clean(title).slice(0, 200);
}

export function parseQuickAdd(text, { members = [], currentUid, today = isoDate(new Date()), action: override, resolutions = {} } = {}) {
  const source = String(text || '').trim();
  if (!source || source.length > 2000) return { error: 'Enter one request of 1–2,000 characters.' };
  if (/\b(delete|remove|erase|reverse|refund|change role|make.+admin)\b/i.test(source)) return { error: 'Quick Add does not delete data, reverse payments or change permissions. Use the normal authorized workflow.' };
  if (/[€£$]/.test(source)) return { error: 'This household uses INR. Enter the amount in rupees; I will not convert currencies.' };
  if (/(?:₹|\bRs\.?|\bINR)?\s*-\s*\d|\b\d[\d,]*\.\d{3,}/i.test(source.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ''))) return { error: 'Use positive rupee amounts with at most two decimal places. No amount was rounded or saved.' };
  const action = override || classify(source);
  if (!QUICK_ACTIONS.some(([id]) => id === action)) return { error: 'I could not safely identify one supported action. Choose a draft type below, or use the normal forms. Deletion, role changes and automatic transfers are not supported.' };
  if (/\b(?:then|also)\s+(?:add|pay|create|record|mark|complete)\b/i.test(source)) return { error: 'Please send one action at a time so each record gets its own review.' };
  const warnings = [];
  const requests = [];
  const me = members.find((member) => member.uid === currentUid);
  function resolveName(value, label) {
    const name = clean(value).replace(/^(?:member|person)\s+/i, '');
    const key = normalize(name);
    if (!key) return '';
    if (['i', 'me', 'myself', 'you', 'my'].includes(key)) {
      if (!me) warnings.push('The signed-in user is not in the current member list. Choose the member in the form.');
      return me?.uid || '';
    }
    const selected = resolutions[key];
    if (selected && members.some((member) => member.uid === selected)) return selected;
    const matches = members.filter((member) => normalize(member.displayName) === key || normalize(member.displayName).split(' ')[0] === key);
    if (matches.length === 1) return matches[0].uid;
    if (!requests.some((request) => request.key === key)) requests.push({ key, name, label, candidates: (matches.length ? matches : members).map((member) => ({ uid: member.uid, name: member.displayName })), ambiguous: matches.length > 1 });
    return '';
  }
  const date = dateFrom(source, today, warnings);
  const totalPaise = extractAmount(source);
  const recurrence = recurrenceFrom(source);
  let payerQuery = source.match(/\bpaid\s+by\s+(.+?)(?=\s+(?:for|shared|split|on|today|yesterday|tomorrow)\b|$)/i)?.[1];
  if (!payerQuery && action === 'expense' && !/^(?:mark|set|add|create|record)\b/i.test(source)) payerQuery = source.match(/^(.+?)\s+(?:paid|spent)\b/i)?.[1];
  let payer = payerQuery ? resolveName(payerQuery, 'Who paid?') : me?.uid || '';
  if (payerQuery && /\band\b|,|&/.test(payerQuery)) return { error: 'This draft form supports one payer per expense. I will not collapse multiple payers into one member. Enter a single-payer record or use a supported ledger workflow.' };
  if (!payerQuery && ['expense', 'payBill', 'purchase'].includes(action)) warnings.push('Payer defaults to you. Review who actually paid.');

  // Named custom allocations must be separated by commas/"and":
  // "split unequally: me 700, Rahul 800"; percentages/shares use the same
  // syntax. Positional ratios use "split 2:1 between me and Rahul".
  let splitMethod = /%|\bpercent(?:age)?s?\b/i.test(source) ? 'percentage' : /\bshares?\b|\b\d+\s*:\s*\d+/i.test(source) ? 'shares' : /\b(?:unequal(?:ly)?|custom|amounts)\b/i.test(source) ? 'custom' : 'equal';
  const splitStart = source.match(/\b(?:split|shared)\b\s*(.*)/i)?.[1] || '';
  let participantText = source.match(/\b(?:between|among|with)\s+(.+)/i)?.[1] || '';
  participantText = participantText.split(/\b(?:on\s+\d{4}-\d{2}-\d{2}|today|tomorrow|yesterday|due|using)\b/i)[0].replace(/[.!]$/, '').trim();
  let participants = [];
  let splitDetail = null;
  if (splitMethod !== 'equal' && !/\b\d+\s*:\s*\d+/.test(source)) {
    const allocationText = splitStart.replace(/^(?:(?:unequally|unequal|custom|amounts|by|percentages?|shares|between|among)\s*[:=-]?\s*)+/i, '').split(/\b(?:on\s+\d{4}-\d{2}-\d{2}|today|tomorrow|yesterday)\b/i)[0];
    const chunks = allocationText.split(/\s*(?:,|;|\band\b)\s*/i).filter(Boolean);
    const details = {};
    const names = [];
    let valid = chunks.length > 0;
    for (const chunk of chunks) {
      const match = chunk.match(new RegExp(`^(.+?)\\s*(?::|=|\\s)\\s*(?:₹|INR|Rs\\.?)?\\s*(${NUMBER})\\s*(?:%|percent|shares?)?\\s*$`, 'i'));
      if (!match) { valid = false; break; }
      const uid = resolveName(match[1], 'Split participant');
      const value = splitMethod === 'custom' ? parseAmountToPaise(match[2]) : Number(match[2].replaceAll(',', ''));
      if (uid && uid in details) { valid = false; break; }
      if (uid) { names.push(uid); details[uid] = value; }
    }
    if (valid) { participants = names; splitDetail = details; }
    else warnings.push('Unequal allocation values need review. Fill every selected member’s amount, percentage or shares; no equal split was substituted.');
  }
  if (!participants.length && participantText && !splitDetail) {
    if (/^(?:everyone|everybody|all(?: of us| members| roommates)?|the household)$/i.test(participantText)) participants = members.map((member) => member.uid);
    else participants = participantText.split(/\s*(?:,|&|\band\b)\s*/i).filter(Boolean).map((name) => resolveName(name, 'Split participant')).filter(Boolean);
  }
  const ratio = source.match(/\b(\d+(?:\s*:\s*\d+)+)\b/);
  if (ratio && splitMethod === 'shares') {
    const weights = ratio[1].split(':').map(Number);
    if (participants.length === weights.length && weights.every((value) => value > 0)) splitDetail = Object.fromEntries(participants.map((uid, index) => [uid, weights[index]]));
    else warnings.push('The ratio needs one positive share per selected member, in the written order. Review the shares.');
  }
  if (!participants.length && !participantText && !requests.length && !splitDetail) {
    participants = members.map((member) => member.uid);
    if (['expense', 'bill', 'payBill', 'purchase'].includes(action)) warnings.push('No participant list was understood. All current members are selected for review.');
  }
  if (new Set(participants).size !== participants.length) { participants = [...new Set(participants)]; warnings.push('A member was repeated; each participant is included once.'); }
  if (!totalPaise && ['expense', 'bill', 'settlement'].includes(action)) warnings.push('No valid total amount was found. Enter it before saving.');
  // Keep the original prompt in tab memory only; don't silently log chat text
  // to a shared financial record. The user can add a description in the form.
  const notes = '';
  let data;
  if (action === 'expense') data = { title: titleFrom(source, action, totalPaise), totalPaise, date, category: categoryFrom(source, 'expense'), payers: payer ? { [payer]: totalPaise || 0 } : {}, participants, splitMethod, splitDetail, description: notes };
  if (action === 'grocery') {
    let name = titleFrom(source, action);
    const quantityMatch = name.match(/^(\d+(?:\.\d+)?)\s*(kg|g|grams?|kilograms?|litres?|liters?|l|ml|packets?|packs?|pieces?|pcs|bottles?)\s+(?:of\s+)?(.+)$/i);
    let quantity = '', unit = '';
    if (quantityMatch) { quantity = quantityMatch[1]; unit = quantityMatch[2]; name = quantityMatch[3]; }
    const assigned = source.match(/\b(?:assign(?:ed)? to|bought by|buyer)\s+(.+?)(?=\s+(?:today|tomorrow|on|notes?)\b|$)/i)?.[1];
    data = { name, quantity, unit, category: categoryFrom(name, 'grocery'), assignedTo: assigned ? resolveName(assigned, 'Who buys it?') : '', notes };
    warnings.push('This adds a shopping-list item only, not a financial expense.');
    if (/\band\b|,/.test(name)) warnings.push('One item per draft is supported. Review the item name or add items separately.');
  }
  if (action === 'bill') {
    const responsible = source.match(/\b(?:assign(?:ed)? to|responsible member)\s+(.+?)(?=\s+(?:due|today|tomorrow|on|monthly|weekly|yearly)\b|$)/i)?.[1];
    data = { name: titleFrom(source, 'bill', totalPaise), category: categoryFrom(source, 'expense'), expectedPaise: totalPaise, dueDate: date, recurrence: recurrence === 'daily' ? 'one-time' : recurrence, assignedTo: responsible ? resolveName(responsible, 'Responsible member') : payerQuery ? payer : '', participants, notes };
    if (splitMethod !== 'equal') warnings.push('New bill templates currently split equally; choose an expense draft instead for an immediate unequal payment. The form shows the bill split explicitly.');
  }
  if (action === 'chore') {
    const assigned = source.match(/\b(?:assign(?:ed)? to|to)\s+(.+?)(?=\s+(?:due|today|tomorrow|daily|weekly|monthly|every|on|priority)\b|$)/i)?.[1];
    const assignees = assigned ? assigned.split(/\s*(?:,|&|\band\b)\s*/i).map((name) => resolveName(name, 'Chore assignee')).filter(Boolean) : [];
    if (!assigned) warnings.push('Choose the chore’s assignees in the form.');
    data = { title: titleFrom(source, 'chore'), dueDate: date, recurrence: recurrence === 'yearly' ? 'one-time' : recurrence, assignees, priority: /\b(?:urgent|high priority)\b/i.test(source) ? 'high' : /\blow priority\b/i.test(source) ? 'low' : 'medium', instructions: notes };
  }
  if (action === 'settlement') {
    const explicit = source.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:₹|INR|Rs\.?|\d|on|today|yesterday|tomorrow)|$)/i);
    const actor = source.match(/^(.+?)\s+(?:repaid|paid back|paid)\b/i)?.[1];
    const receiver = explicit?.[2] || source.match(/\b(?:repaid|repay|paid back|pay back)\s+(.+?)(?=\s+(?:₹|INR|Rs\.?|\d|on|today|yesterday|tomorrow)|$)/i)?.[1] || source.match(/\b(?:paid|pay)\s+(.+?)\s+(?:₹|INR|Rs\.?|\d)/i)?.[1];
    data = { from: explicit ? resolveName(explicit[1], 'Repayment payer') : actor ? resolveName(actor, 'Repayment payer') : me?.uid || '', to: receiver ? resolveName(receiver.replace(/\s+back$/i, ''), 'Repayment receiver') : '', amountPaise: totalPaise, date, note: notes };
    warnings.push('A settlement only records repayment outside RoomSync. No money is transferred.');
  }
  if (['payBill', 'purchase', 'completeChore'].includes(action)) {
    const targetText = clean(source.replace(/^(?:please\s+)?(?:mark|set|pay|complete|completed|finish|finished)\s+(?:the\s+)?(?:existing\s+)?/i, '').replace(/\s+(?:as\s+)?(?:paid|purchased|bought|done|completed)\b.*$/i, '').replace(/\b(?:bill|chore|task|item)\b/i, '').replace(/\s+(?:for\s+)?(?:₹|INR|Rs\.?|\d).*/i, ''));
    data = { targetText, totalPaise, paidBy: payer, participants, splitMethod, splitDetail, date };
    warnings.push('Choose the exact existing record. Nothing has been marked paid, purchased or completed yet.');
  }
  if (/\b(?:rotate|rotation)\b/i.test(source) && action === 'chore') warnings.push('Review and enable the rotation in the chore form.');
  if (/\b(?:daily)\b/i.test(source) && action === 'bill') warnings.push('Daily bill recurrence is unsupported; choose a supported recurrence.');
  if (/\b(?:yearly|annually)\b/i.test(source) && action === 'chore') warnings.push('Yearly chore recurrence is unsupported; choose a supported recurrence.');
  return { source, action, data, warnings: [...new Set(warnings)], requests };
}
