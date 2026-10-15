import { describe, it, expect } from 'vitest';
import { parseExpenseBatch, duplicateExpenseGroups, batchDocumentId, batchFingerprint } from '../expenseBatch.js';
import { buildExpenseData } from '../expenseData.js';
const members = [{ uid: 'alice', displayName: 'Alice Watson' }, { uid: 'rahul', displayName: 'Rahul Sharma' }, { uid: 'priya', displayName: 'Priya Patel' }];
const opts = { members, currentUid: 'alice', today: '2026-10-15' };
const parse = (text, extra) => parseExpenseBatch(text, { ...opts, ...extra });
const valid = (item) => buildExpenseData(item.input);
const base = () => parse('I paid 100 for groceries yesterday split equally between me and Rahul')[0];
describe('multi-expense natural-language drafts', () => {
  it('extracts the requested three amounts/items and shared explicit yesterday/payer', () => {
    const items = parse('I paid 2500 for groceries, 300 for electricity, and 800 for dinner yesterday.');
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.input.title)).toEqual(['groceries', 'electricity', 'dinner']);
    expect(items.map((item) => item.input.totalPaise)).toEqual([250000, 30000, 80000]);
    for (const item of items) { expect(item.input.date).toBe('2026-10-14'); expect(Object.keys(item.input.payers)).toEqual(['alice']); expect(item.input.participants).toEqual([]); expect(item.reviewed).toBe(false); }
  });
  it('uses declared batch defaults only after explicit opt-in', () => {
    const missing = parse('I paid 100 for groceries')[0];
    expect(missing.input.date).toBe(''); expect(missing.input.splitMethod).toBe(''); expect(missing.input.participants).toEqual([]);
    const opted = parse('I paid 100 for groceries', { useToday: true, useEqualHousehold: true })[0];
    expect(opted.input).toMatchObject({ date: '2026-10-15', splitMethod: 'equal', participants: ['alice', 'rahul', 'priya'] });
    expect(valid(opted).totalPaise).toBe(10000);
  });
  it('does not invent a payer from an unmentioned actor', () => {
    const items = parse('groceries ₹2500 yesterday, electricity ₹300 today', { useEqualHousehold: true });
    expect(items.map((item) => item.input.payers)).toEqual([{}, {}]);
  });
  it('preserves multiple explicit payers/dates/splits independently', () => {
    const items = parse('I paid ₹2,500.50 for groceries yesterday split equally between me and Rahul; Rahul paid ₹300 for electricity today split 2:1 between Rahul and me.');
    expect(items.map((item) => item.input.date)).toEqual(['2026-10-14', '2026-10-15']);
    expect(items[0].input.totalPaise).toBe(250050); expect(items[1].input.payers).toEqual({ rahul: 30000 });
    expect(valid(items[1]).shares).toEqual({ alice: 10000, rahul: 20000 });
  });
  it('does not propagate a payer across separate sentences or paragraphs', () => {
    expect(parse('I paid 100 for groceries yesterday. 300 for internet today.')[1].input.payers).toEqual({});
    expect(parse('I paid 100 for groceries yesterday\n300 for internet today')[1].input.payers).toEqual({});
  });
  it('handles comma and and boundaries without splitting grouping or named allocations', () => {
    expect(parse('I paid 2,50,000 for rent and 300 for internet yesterday')).toHaveLength(2);
    expect(parse('I paid 1500 for dinner yesterday split unequally: me 700, Rahul 800.')).toHaveLength(1);
    expect(parse('I paid Rs. 2500 for groceries, Rs. 300 for internet yesterday')).toHaveLength(2);
  });
  it('handles custom amounts, percentages and shares with existing validators', () => {
    expect(valid(parse('I paid 1500 for dinner yesterday split unequally: me 700, Rahul 800')[0]).shares).toEqual({ alice: 70000, rahul: 80000 });
    expect(valid(parse('I paid 1000 for food today split percentages: me 60%, Rahul 40%')[0]).shares).toEqual({ alice: 60000, rahul: 40000 });
    expect(valid(parse('I paid 900 for food today split shares: me 2, Rahul 1')[0]).shares).toEqual({ alice: 60000, rahul: 30000 });
  });
  it('does not force equal when only participants are given', () => {
    const item = parse('I paid 100 for groceries today between me and Rahul')[0];
    expect(item.input.participants).toEqual(['alice', 'rahul']); expect(item.input.splitMethod).toBe('');
  });
  it('does not assume everyone when equal has no explicit participants', () => {
    expect(parse('I paid 100 for groceries today split equally')[0].input.participants).toEqual([]);
  });
  it('leaves unknown/ambiguous names for manual clarification', () => {
    expect(parse('Sam paid 100 for dinner yesterday split equally between me and Rahul')[0].input.payers).toEqual({});
    const extra = [...members, { uid: 'rahul2', displayName: 'Rahul Verma' }];
    const item = parse('I paid 100 for dinner yesterday split equally between me and Rahul', { members: extra })[0];
    expect(item.input.participants).toEqual([]); expect(item.notices.join(' ')).toContain('Ambiguous');
  });
  it('never infers the total from split allocations', () => {
    const item = parse('I paid for groceries yesterday split unequally: me 700, Rahul 800')[0];
    expect(item.input.totalPaise).toBeNull(); expect(() => valid(item)).toThrow();
  });
  it('preserves a missing expense as an editable step', () => {
    const items = parse('I paid for groceries yesterday; 300 for internet today.');
    expect(items).toHaveLength(2); expect(items[0].input.totalPaise).toBeNull();
  });
  it('leaves invalid amounts and dates blank', () => {
    expect(parse('I paid ₹1.234 for food yesterday')[0].input.totalPaise).toBeNull();
    expect(parse('I paid -100 for food yesterday')[0].input.totalPaise).toBeNull();
    expect(parse('I paid 100 for food on 2026-02-31')[0].input.date).toBe('');
    expect(parse('I paid 100 for food next Monday')[0].input.date).toBe('');
  });
  it('keeps trailing shared split context explicit and warns on inheritance', () => {
    const items = parse('I paid 100 for groceries, 50 for electricity yesterday split equally between me and Rahul');
    expect(items).toHaveLength(2); expect(items.every((item) => item.input.splitMethod === 'equal')).toBe(true);
    expect(items[0].notices.join(' ')).toContain('trailing split');
  });
  it('maps common categories into the existing schema, utilities into Other with notice', () => {
    const items = parse('I paid 100 for rent, 200 for internet, 300 for taxi, 400 for utilities, 500 for dinner today');
    expect(items.map((item) => item.input.category)).toEqual(['Rent', 'Internet', 'Transport', 'Other', 'Food & dining']);
    expect(items[3].notices.join(' ')).toContain('Other');
  });
  it('bounds input and batch size and refuses destructive/foreign-currency requests', () => {
    for (const text of ['', 'x'.repeat(6001), 'Delete all expenses', 'I paid $10 for dinner']) expect(() => parse(text)).toThrow();
    expect(() => parse(Array.from({ length: 9 }, (_, index) => `I paid ${index + 1} for food today`).join(';'))).toThrow('8');
  });
  it('keeps prompts in memory only and never mutates caller membership data', () => {
    const before = JSON.stringify(opts); const item = base();
    expect(item.input.description).toBe(''); expect(JSON.stringify(opts)).toBe(before); expect(item).not.toHaveProperty('save');
  });
  it('extracts an explicitly labeled description without persisting the whole request', () => {
    const item = parse('I paid 100 for groceries yesterday note: vegetables from the market')[0];
    expect(item.input.title).toBe('groceries'); expect(item.input.description).toBe('vegetables from the market');
  });
});
describe('review validation and idempotent batch identities', () => {
  it('validates calendar/category/participants as well as money and splits', () => {
    const item = base();
    for (const patch of [{ date: '2026-02-31' }, { category: 'Invented' }, { participants: [] }, { totalPaise: 0 }, { splitMethod: '' }]) expect(() => buildExpenseData({ ...item.input, ...patch })).toThrow();
  });
  it('flags identical included drafts but ignores skipped duplicates', () => {
    const a = base(); const b = { ...a, id: crypto.randomUUID() };
    expect(duplicateExpenseGroups([a, b])).toEqual([[a.id, b.id]]);
    expect(duplicateExpenseGroups([a, { ...b, skipped: true }])).toEqual([]);
  });
  it('uses stable safe document identities and rejects invalid IDs', () => {
    const batchId = crypto.randomUUID(), id = crypto.randomUUID();
    expect(batchDocumentId(batchId, id)).toBe(batchDocumentId(batchId, id));
    expect(() => batchDocumentId('../bad', id)).toThrow();
  });
  it('fingerprints exact confirmed payload plus household and user', async () => {
    const entry = { id: crypto.randomUUID(), input: valid(base()) };
    const request = { householdId: 'h1', uid: 'alice', items: [entry] };
    const hash = await batchFingerprint(request);
    expect(await batchFingerprint(request)).toBe(hash);
    expect(await batchFingerprint({ ...request, householdId: 'h2' })).not.toBe(hash);
    expect(await batchFingerprint({ ...request, uid: 'other' })).not.toBe(hash);
    expect(await batchFingerprint({ ...request, items: [{ ...entry, input: { ...entry.input, title: 'Changed' } }] })).not.toBe(hash);
  });
});
