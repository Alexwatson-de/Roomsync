import { describe, it, expect } from 'vitest';
import { parseQuickAdd } from '../quickAdd.js';
import { computeShares } from '../splits.js';
const members = [{ uid: 'a', displayName: 'Alice Watson' }, { uid: 'b', displayName: 'Rahul Sharma' }, { uid: 'c', displayName: 'Priya Patel' }];
const options = { members, currentUid: 'a', today: '2026-10-15' };
const parse = (text, overrides) => parseQuickAdd(text, { ...options, ...overrides });

describe('local Quick Add creates drafts, never financial side effects', () => {
  it('extracts equal expense with explicit members and precise paise', () => {
    const draft = parse('I paid ₹1,500.01 for groceries shared equally between me, Rahul and Priya');
    expect(draft.action).toBe('expense'); expect(draft.requests).toEqual([]);
    expect(draft.data).toMatchObject({ title: 'groceries', totalPaise: 150001, payers: { a: 150001 }, participants: ['a', 'b', 'c'], splitMethod: 'equal', category: 'Groceries' });
    expect(Object.values(computeShares('equal', draft.data.totalPaise, draft.data.participants)).reduce((a, b) => a + b, 0)).toBe(150001);
  });
  it('extracts exact custom amounts without interpreting shares as the total', () => {
    const draft = parse('I paid 1500 for groceries split unequally: me 700, Rahul 800');
    expect(draft.data).toMatchObject({ totalPaise: 150000, splitMethod: 'custom', splitDetail: { a: 70000, b: 80000 }, participants: ['a', 'b'] });
    expect(draft.requests).toEqual([]);
  });
  it('leaves a missing total blank even if custom amounts exist', () => {
    const draft = parse('Add expense for groceries split unequally: me 700, Rahul 800');
    expect(draft.data.totalPaise).toBeNull();
    expect(draft.warnings.join(' ')).toContain('total amount');
  });
  it('does not fix custom allocation totals silently', () => {
    const draft = parse('I paid 1500 for groceries split unequally: me 600, Rahul 800');
    expect(draft.data.splitDetail).toEqual({ a: 60000, b: 80000 });
    expect(() => computeShares(draft.data.splitMethod, draft.data.totalPaise, draft.data.participants, draft.data.splitDetail)).toThrow();
  });
  it('extracts percentages for the existing validator', () => {
    const draft = parse('I paid 1000 for dinner split percentages: me 60%, Rahul 40%');
    expect(draft.requests).toEqual([]);
    expect(draft.data).toMatchObject({ splitMethod: 'percentage', splitDetail: { a: 60, b: 40 }, participants: ['a', 'b'] });
  });
  it('does not normalize a bad percentage sum', () => {
    const d = parse('I paid 1000 for dinner split percentages: me 60%, Rahul 50%').data;
    expect(() => computeShares(d.splitMethod, d.totalPaise, d.participants, d.splitDetail)).toThrow();
  });
  it('extracts share weights and positional ratios in written member order', () => {
    expect(parse('I paid 900 for dinner split shares: me 2 shares, Rahul 1 share').data.splitDetail).toEqual({ a: 2, b: 1 });
    expect(parse('I paid 900 for dinner split 2:1 between Rahul and me').data.splitDetail).toEqual({ b: 2, a: 1 });
  });
  it('never substitutes an equal split for unspecified unequal amounts', () => {
    const d = parse('I paid 1500 for groceries split unequally between me and Rahul');
    expect(d.data.splitMethod).toBe('custom'); expect(d.data.splitDetail).toBeNull();
    expect(d.warnings.join(' ')).toContain('no equal split');
  });
  it('resolves exact full names and distinct first names case-insensitively', () => {
    const d = parse('Rahul Sharma paid Rs. 300 for dinner split equally between Alice Watson and priya');
    expect(d.data.payers).toEqual({ b: 30000 }); expect(d.data.participants).toEqual(['a', 'c']);
  });
  it('requires explicit resolution for duplicate first names', () => {
    const more = [...members, { uid: 'd', displayName: 'Rahul Verma' }];
    const d = parse('I paid 300 for dinner split equally between me and Rahul', { members: more });
    expect(d.requests[0]).toMatchObject({ key: 'rahul', ambiguous: true });
    expect(d.requests[0].candidates.map((member) => member.uid)).toEqual(['b', 'd']);
    const resolved = parse(d.source, { members: more, resolutions: { rahul: 'd' } });
    expect(resolved.requests).toEqual([]); expect(resolved.data.participants).toEqual(['a', 'd']);
  });
  it('never invents a member or uses a UID from a different household', () => {
    const d = parse('I paid 300 for dinner split equally between me and Sam');
    expect(d.requests[0].name).toBe('Sam'); expect(d.requests[0].ambiguous).toBe(false);
    const stillUnknown = parse(d.source, { resolutions: { sam: 'external-user' } });
    expect(stillUnknown.requests).toHaveLength(1);
  });
  it('recognizes both an unknown payer and unknown participants', () => {
    const d = parse('Sam paid 300 for dinner split equally between Jill and me');
    expect(d.requests.map((r) => r.key)).toEqual(['sam', 'jill']);
  });
  it('discloses default payer and participants', () => {
    const d = parse('Pay 300 for groceries');
    expect(d.data.payers).toEqual({ a: 30000 }); expect(d.data.participants).toEqual(['a', 'b', 'c']);
    expect(d.warnings.join(' ')).toContain('Payer defaults to you');
    expect(d.warnings.join(' ')).toContain('All current members');
  });
  it('extracts shopping quantity/unit/category without making an expense', () => {
    const d = parse('Add 2 kg rice to the grocery list');
    expect(d.action).toBe('grocery'); expect(d.data).toMatchObject({ name: 'rice', quantity: '2', unit: 'kg', category: 'Grains' });
    expect(d.warnings.join(' ')).toContain('not a financial expense');
  });
  it('matches an optional grocery buyer', () => {
    expect(parse('Add milk assigned to Rahul').data.assignedTo).toBe('b');
  });
  it('drafts recurring bills with due dates', () => {
    const d = parse('Create a rent bill ₹18000 due tomorrow monthly');
    expect(d.action).toBe('bill'); expect(d.data).toMatchObject({ name: 'rent', category: 'Rent', expectedPaise: 1800000, dueDate: '2026-10-16', recurrence: 'monthly' });
  });
  it('drafts assigned chores and priorities', () => {
    const d = parse('Assign chore clean the kitchen to Rahul tomorrow weekly high priority');
    expect(d.action).toBe('chore'); expect(d.data).toMatchObject({ title: 'clean the kitchen', assignees: ['b'], recurrence: 'weekly', priority: 'high', dueDate: '2026-10-16' });
  });
  it('drafts a repayment record, not a money transfer', () => {
    const d = parse('I repaid Rahul ₹500 yesterday');
    expect(d.action).toBe('settlement'); expect(d.data).toMatchObject({ from: 'a', to: 'b', amountPaise: 50000, date: '2026-10-14' });
    expect(d.warnings.join(' ')).toContain('No money is transferred');
  });
  it('does not choose an unspecified repayment receiver', () => {
    expect(parse('Record settlement ₹500').data.to).toBe('');
  });
  it('preserves repayment direction when another member repaid the current user', () => {
    expect(parse('Rahul repaid me ₹500 yesterday').data).toMatchObject({ from: 'b', to: 'a', amountPaise: 50000 });
    expect(parse('Rahul paid me back ₹500').data).toMatchObject({ from: 'b', to: 'a' });
    expect(parse('Record settlement from Rahul to me ₹500').data).toMatchObject({ from: 'b', to: 'a' });
  });
  it('understands a bought-item payment but refuses to collapse multiple payers', () => {
    expect(parse('I bought groceries for ₹1500').data).toMatchObject({ title: 'groceries', totalPaise: 150000 });
    expect(parse('Alice and Rahul paid ₹1500 for dinner').error).toContain('one payer');
  });
  it('selects existing record workflows, not duplicate new records', () => {
    const d = parse('Mark rent bill as paid ₹18000 split equally with everyone');
    expect(d.action).toBe('payBill'); expect(d.requests).toEqual([]);
    expect(d.data).toMatchObject({ targetText: 'rent', totalPaise: 1800000, paidBy: 'a', participants: ['a', 'b', 'c'] });
    expect(parse('Mark milk as purchased for ₹60').action).toBe('purchase');
    expect(parse('Complete chore kitchen').data.targetText).toBe('kitchen');
  });
  it('uses valid ISO and relative dates, including month rollover', () => {
    expect(parse('I paid ₹200 for lunch on 2026-01-30').data.date).toBe('2026-01-30');
    expect(parse('I paid ₹200 for lunch tomorrow', { today: '2026-01-31' }).data.date).toBe('2026-02-01');
  });
  it('leaves invalid/unsupported calendar wording for review', () => {
    expect(parse('Create rent bill ₹100 due 2026-02-31').data.dueDate).toBe('');
    expect(parse('Create rent bill ₹100 due next week').data.dueDate).toBe('');
  });
  it('rejects negative amounts, extra precision and foreign currency', () => {
    for (const text of ['I paid -100 for dinner', 'I paid ₹1.234 for dinner', 'I paid $20 for dinner']) expect(parse(text).error).toBeTruthy();
  });
  it('discloses unsupported recurrences and bill split limitations', () => {
    expect(parse('Create rent bill ₹100 due today daily').warnings.join(' ')).toContain('Daily bill recurrence is unsupported');
    expect(parse('Create rent bill ₹100 split unequally: me 60, Rahul 40').warnings.join(' ')).toContain('bill templates currently split equally');
  });
  it('rejects destructive commands even when a type override is selected', () => {
    for (const text of ['Delete all expenses', 'Reverse repayment ₹100', 'Make me admin']) expect(parse(text, { action: 'expense' }).error).toBeTruthy();
  });
  it('rejects empty, too long, multi-action and unsupported chat', () => {
    for (const text of ['', 'x'.repeat(2001), 'Add milk then pay Rahul 500', 'Tell me a joke']) expect(parse(text).error).toBeTruthy();
  });
  it('can open a manually chosen draft type for unrecognized wording', () => {
    expect(parse('Party snacks', { action: 'grocery' })).toMatchObject({ action: 'grocery', data: { name: 'Party snacks' } });
  });
  it('keeps chat prompts out of shared descriptions/notes by default', () => {
    expect(parse('I paid ₹200 for dinner').data.description).toBe('');
    expect(parse('Add milk').data.notes).toBe('');
  });
  it('does not mutate caller data or include executable input', () => {
    const before = JSON.stringify(options);
    const d = parse('I paid ₹100 for "<script>alert(1)</script>" split equally with everyone');
    expect(d.data.title).toBe('<script>alert(1)</script>'); // React renders text, not HTML.
    expect(JSON.stringify(options)).toBe(before);
    expect(d).not.toHaveProperty('save');
  });
});
