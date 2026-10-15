import { it, expect } from 'vitest';
import { normalizeGeminiDrafts, buildHouseholdDraft, draftCollection, changeDraftKind } from '../householdDrafts.js';
const opts = { members: [{ uid: 'alice', displayName: 'Alice' }, { uid: 'rahul', displayName: 'Rahul' }], today: '2026-10-15', useToday: false, useEqualHousehold: false };
it('routes shopping, future bill and paid expense independently with no invented amounts', () => {
  const items = normalizeGeminiDrafts([
    { type: 'grocery', title: 'Rice', category: 'Grains', quantity: '2', unit: 'kg' },
    { type: 'bill', title: 'Internet', amountRupees: '300', category: 'Internet', date: '2026-10-16', recurrence: 'monthly', participants: ['alice', 'rahul'] },
    { type: 'expense', title: 'Groceries paid', amountRupees: '1500.01', category: 'Groceries', payerUid: 'alice', date: '2026-10-14', participants: ['alice', 'rahul'], splitMethod: 'equal' },
  ], opts);
  expect(items.map((i) => draftCollection(i.kind))).toEqual(['shoppingItems', 'bills', 'expenses']);
  expect(buildHouseholdDraft('grocery', items[0].input)).toMatchObject({ name: 'Rice', quantity: '2', unit: 'kg' });
  expect(buildHouseholdDraft('bill', items[1].input).expectedPaise).toBe(30000);
  expect(buildHouseholdDraft('expense', items[2].input).shares).toEqual({ alice: 75001, rahul: 75000 });
});
it('leaves missing names/amounts/dates/splits blank and ignores foreign-member references', () => {
  const item = normalizeGeminiDrafts([{ type: 'expense', title: 'Food', amountRupees: 'bad', payerUid: 'outsider', participants: ['outsider'], date: '2026-02-31' }], opts)[0];
  expect(item.input).toMatchObject({ payers: {}, participants: [], splitMethod: '', date: '', totalPaise: null });
  expect(() => buildHouseholdDraft(item.kind, item.input)).toThrow();
});
it('allows changing a proposed destination without silently keeping a paid record or amount', () => {
  const item = normalizeGeminiDrafts([{ type: 'expense', title: 'Milk', amountRupees: '50', category: 'Groceries', payerUid: 'alice', date: '2026-10-14', participants: ['alice'], splitMethod: 'equal' }], opts)[0];
  const grocery = changeDraftKind(item, 'grocery');
  expect(grocery.kind).toBe('grocery'); expect(grocery.input).not.toHaveProperty('payers'); expect(grocery.reviewed).toBe(false);
  const bill = changeDraftKind(grocery, 'bill'); expect(bill.input.expectedPaise).toBe(5000); expect(bill.input.recurrence).toBe('');
});
it('does not create unsupported collections for malformed model types', () => {
  const item = normalizeGeminiDrafts([{ type: 'users/admin', title: 'Fake' }], opts)[0];
  expect(item.kind).toBe('unknown'); expect(() => buildHouseholdDraft(item.kind, item.input)).toThrow();
});
it('validates supported bill recurrence, date and split before save', () => {
  const input = { name: 'Rent', expectedPaise: 10000, category: 'Rent', dueDate: '2026-10-16', participants: ['alice'], recurrence: 'monthly' };
  expect(buildHouseholdDraft('bill', input).splitMethod).toBe('equal');
  for (const patch of [{ recurrence: '' }, { participants: [] }, { dueDate: '2026-02-31' }, { splitMethod: 'custom' }]) expect(() => buildHouseholdDraft('bill', { ...input, ...patch })).toThrow();
});
it('uses optional defaults only on explicit opt-in and preserves exact custom allocation paise', () => {
  const [item] = normalizeGeminiDrafts([{ type: 'expense', title: 'Food', amountRupees: '10.01', payerUid: 'alice', category: 'Food & dining' }], { ...opts, useToday: true, useEqualHousehold: true });
  expect(item.input.date).toBe('2026-10-15'); expect(item.input.splitMethod).toBe('equal'); expect(item.input.participants).toEqual(['alice', 'rahul']);
  const [custom] = normalizeGeminiDrafts([{ type: 'expense', title: 'Food', amountRupees: '10.01', payerUid: 'alice', category: 'Food & dining', date: '2026-10-14', participants: ['alice', 'rahul'], splitMethod: 'custom', allocations: [{ uid: 'alice', value: '7.01' }, { uid: 'rahul', value: '3' }] }], opts);
  expect(buildHouseholdDraft(custom.kind, custom.input).shares).toEqual({ alice: 701, rahul: 300 });
});
