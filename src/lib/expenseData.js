// One pure financial validator shared by manual forms and batch confirmation.
// Its output is the existing expense schema, never rounded display strings.
import { computeShares } from './splits.js';
import { EXPENSE_CATEGORIES } from './constants.js';
export function buildExpenseData(input) {
  const { title, date, category, totalPaise, payers, participants, splitMethod, splitDetail, description } = input;
  if (!title?.trim() || title.length > 200) throw new Error('Enter a title of 1–200 characters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < '1900-01-01' || date > '9999-12-31' || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Select a valid calendar date.');
  if (!EXPENSE_CATEGORIES.includes(category)) throw new Error('Choose an existing household expense category.');
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0 || totalPaise > 1e10) throw new Error('Enter a positive amount of at most ₹10 crore.');
  const payerIds = Object.keys(payers || {});
  if (!Array.isArray(participants) || !participants.length) throw new Error('Select at least one participant.');
  if (!payerIds.length || new Set([...payerIds, ...participants]).size > 8) throw new Error('Up to 8 distinct payers/participants are supported per expense.');
  if (Object.values(payers).some((p) => !Number.isSafeInteger(p) || p < 0) || Object.values(payers).reduce((a, b) => a + b, 0) !== totalPaise) throw new Error('Payer amounts must equal the total.');
  const shares = computeShares(splitMethod, totalPaise, participants, splitDetail);
  if (Object.keys(shares).length !== participants.length || participants.some((uid) => !(uid in shares))) throw new Error('Split details must match participants.');
  return { title: title.trim(), date, category, totalPaise, payers, payerIds, participants: Object.keys(shares), splitMethod, splitDetail: splitDetail || null, shares, description: description?.trim() || '' };
}
