// These tests use isolated in-memory browser storage, never user financial data.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { register, login, logout, changePassword, deleteAccount, listenAuth, resetPassword } from '../auth.js';
import { createHousehold, createInvite, joinHousehold, revokeInvite, deleteHousehold, updateHousehold, removeMember, setMemberRole } from '../households.js';
import { addExpense, updateExpense, deleteExpense, listenExpenses } from '../expenses.js';
import { recordSettlement, confirmSettlement, reverseSettlement } from '../settlements.js';
import { createBill, markBillPaid } from '../bills.js';
import { createChore, completeChore } from '../chores.js';
import { addItem, markPurchased, unmarkPurchased } from '../groceries.js';
import { markNotificationRead } from '../activity.js';
import { readDatabase, DATABASE_KEY, SESSION_KEY } from '../localStore.js';
import { computeNetBalances } from '../../lib/balances.js';

let storage;
beforeEach(() => {
  const values = new Map();
  storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key), clear: () => values.clear() };
  vi.stubGlobal('localStorage', storage);
  // Exercise the synchronous fallback here. Real browser Web Locks and
  // storage events are covered separately by the Playwright workflow tests.
  vi.stubGlobal('navigator', {});
});

const PASSWORD = 'test-only-password';
async function setup() {
  const alice = await register({ email: 'alice@example.test', password: PASSWORD, displayName: 'Alice' });
  const hid = await createHousehold({ name: 'Test Flat' });
  const invite = await createInvite(hid, 'Test Flat');
  await logout();
  const bob = await register({ email: 'bob@example.test', password: PASSWORD, displayName: 'Bob' });
  await joinHousehold(invite);
  await logout();
  await login({ email: alice.email, password: PASSWORD });
  return { alice, bob, hid, invite };
}
const expenseInput = (alice, bob, totalPaise = 120000) => ({ title: 'Groceries', category: 'Groceries', date: '2026-10-15', totalPaise, payers: { [alice.uid]: totalPaise }, participants: [alice.uid, bob.uid], splitMethod: 'equal', splitDetail: null });
const household = (hid) => readDatabase().households[hid];

it('persists registration/session without storing plaintext passwords', async () => {
  const user = await register({ email: '  Alice@EXAMPLE.test ', password: PASSWORD, displayName: 'Alice' });
  expect(user.email).toBe('alice@example.test');
  expect(user.passwordHash).toBeUndefined();
  expect(localStorage.getItem(DATABASE_KEY)).not.toContain(PASSWORD);
  expect(localStorage.getItem(SESSION_KEY)).toBe(user.uid);
  await logout();
  await expect(login({ email: 'alice@example.test', password: 'wrong-password' })).rejects.toThrow();
  await login({ email: 'alice@example.test', password: PASSWORD });
  expect(localStorage.getItem(SESSION_KEY)).toBe(user.uid);
});

it('rejects duplicate local accounts and never pretends to send recovery email', async () => {
  await register({ email: 'a@example.test', password: PASSWORD, displayName: 'A' });
  await expect(register({ email: 'A@example.test', password: PASSWORD, displayName: 'Other A' })).rejects.toThrow('already');
  await expect(resetPassword('a@example.test')).rejects.toThrow('No email was sent');
});

it('supports changing the password with current-password verification', async () => {
  await register({ email: 'a@example.test', password: PASSWORD, displayName: 'A' });
  await expect(changePassword('wrong', 'new-password')).rejects.toThrow();
  await changePassword(PASSWORD, 'new-password');
  await logout();
  await expect(login({ email: 'a@example.test', password: PASSWORD })).rejects.toThrow();
  await login({ email: 'a@example.test', password: 'new-password' });
});

it('auth subscriptions can be cleaned up', async () => {
  const seen = [];
  const stop = listenAuth((user) => seen.push(user?.uid || null));
  await Promise.resolve();
  const user = await register({ email: 'a@example.test', password: PASSWORD, displayName: 'A' });
  await Promise.resolve();
  expect(seen).toContain(user.uid);
  stop();
  const count = seen.length;
  await logout();
  await Promise.resolve();
  expect(seen).toHaveLength(count);
});

it('supports household switching data and invite membership in one browser', async () => {
  const { alice, bob, hid } = await setup();
  const secondId = await createHousehold({ name: 'Second Flat' });
  expect(household(hid).members[bob.uid].role).toBe('member');
  expect(household(secondId).members[alice.uid].role).toBe('owner');
  await updateHousehold(hid, { name: 'Renamed Flat' });
  expect(household(hid).members[bob.uid].householdName).toBe('Renamed Flat');
});

it('enforces revoked and expired local invite codes', async () => {
  const { hid } = await setup();
  const revoked = await createInvite(hid, 'Flat');
  const expired = await createInvite(hid, 'Flat', 'member', -1);
  await revokeInvite(revoked);
  await logout();
  await register({ email: 'eve@example.test', password: PASSWORD, displayName: 'Eve' });
  await expect(joinHousehold(revoked)).rejects.toThrow('revoked');
  await expect(joinHousehold(expired)).rejects.toThrow('expired');
});

it('local role checks reject self-escalation and non-member changes', async () => {
  const { alice, bob, hid } = await setup();
  await logout(); await login({ email: bob.email, password: PASSWORD });
  await expect(setMemberRole(hid, bob.uid, 'admin')).rejects.toThrow();
  await expect(updateHousehold(hid, { name: 'Hijacked' })).rejects.toThrow();
  await expect(removeMember(hid, alice.uid)).rejects.toThrow();
  await logout(); await register({ email: 'eve@example.test', password: PASSWORD, displayName: 'Eve' });
  await expect(addExpense(hid, expenseInput(alice, bob))).rejects.toThrow('not a member');
});

it('writes expense + audit + relevant notification atomically and recomputes edits/deletes', async () => {
  const { alice, bob, hid } = await setup();
  const id = await addExpense(hid, expenseInput(alice, bob));
  let h = household(hid);
  expect(computeNetBalances(Object.values(h.expenses))[bob.uid]).toBe(-60000);
  expect(h.activity[`expense_added_${id}`]).toBeTruthy();
  expect(Object.values(h.notifications).map((n) => n.recipientId)).toEqual([bob.uid]);
  await updateExpense(hid, id, expenseInput(alice, bob, 10001));
  h = household(hid);
  expect(Object.values(h.expenses[id].shares).reduce((a, b) => a + b, 0)).toBe(10001);
  expect(h.expenses[id].audit[1].previous.totalPaise).toBe(120000);
  await deleteExpense(hid, id);
  expect(computeNetBalances(Object.values(household(hid).expenses))).toEqual({});
});

it('reports persisted dates to the UI and stops data subscriptions after cleanup', async () => {
  const { alice, bob, hid } = await setup();
  const seen = [];
  const stop = listenExpenses(hid, (records) => seen.push(records));
  await addExpense(hid, expenseInput(alice, bob));
  await Promise.resolve();
  const record = seen.at(-1)[0];
  expect(record.createdAt.toDate()).toBeInstanceOf(Date);
  stop(); const count = seen.length;
  await addExpense(hid, expenseInput(alice, bob, 500));
  await Promise.resolve();
  expect(seen).toHaveLength(count);
});

it('settlements and reversals produce the expected partial balance', async () => {
  const { alice, bob, hid } = await setup();
  await addExpense(hid, expenseInput(alice, bob));
  const sid = await recordSettlement(hid, { from: bob.uid, to: alice.uid, amountPaise: 25000, date: '2026-10-15' });
  await confirmSettlement(hid, sid);
  let h = household(hid);
  expect(computeNetBalances(Object.values(h.expenses), Object.values(h.settlements))[bob.uid]).toBe(-35000);
  await reverseSettlement(hid, sid);
  h = household(hid);
  expect(computeNetBalances(Object.values(h.expenses), Object.values(h.settlements))[bob.uid]).toBe(-60000);
});

it('bill payment retries create one expense and one next occurrence', async () => {
  const { alice, bob, hid } = await setup();
  const id = await createBill(hid, { name: 'Rent', category: 'Rent', expectedPaise: 120000, dueDate: '2026-10-31', recurrence: 'monthly', participants: [alice.uid, bob.uid] });
  const input = { paidPaise: 120000, expenseInput: expenseInput(alice, bob) };
  const next1 = await markBillPaid(hid, { id }, input);
  const next2 = await markBillPaid(hid, { id }, input);
  const h = household(hid);
  expect(next1).toBe(next2);
  expect(Object.keys(h.bills)).toHaveLength(2);
  expect(h.bills[next1].dueDate).toBe('2026-11-30');
  expect(Object.keys(h.expenses)).toHaveLength(1);
  expect(h.bills[id].expenseId).toBe(`bill_payment_${id}`);
});

it('marking a bill paid without an expense leaves the ledger unchanged', async () => {
  const { hid } = await setup();
  const id = await createBill(hid, { name: 'Internet', category: 'Internet', expectedPaise: 80000, dueDate: '2026-10-15', recurrence: 'one-time' });
  await markBillPaid(hid, { id }, { paidPaise: 80000 });
  expect(household(hid).expenses).toEqual({});
});

it('recurring chore completion rotates once even when retried', async () => {
  const { alice, bob, hid } = await setup();
  const id = await createChore(hid, { title: 'Kitchen', dueDate: '2026-10-15', recurrence: 'weekly', assignees: [], rotation: [alice.uid, bob.uid] });
  const next = await completeChore(hid, { id });
  await completeChore(hid, { id });
  const h = household(hid);
  expect(Object.keys(h.chores)).toHaveLength(2);
  expect(h.chores[next].assignees).toEqual([bob.uid]);
  expect(h.chores[next].dueDate).toBe('2026-10-22');
  expect(h.chores[next].occurrenceIndex).toBe(1);
});

it('grocery purchase retries cannot duplicate the linked expense', async () => {
  const { alice, bob, hid } = await setup();
  const id = await addItem(hid, { name: 'Milk' });
  const input = { pricePaise: 10000, paidBy: alice.uid, expenseInput: expenseInput(alice, bob, 10000) };
  await markPurchased(hid, { id }, input);
  await markPurchased(hid, { id }, input);
  expect(Object.keys(household(hid).expenses)).toHaveLength(1);
  await expect(unmarkPurchased(hid, id)).rejects.toThrow('linked expense');
});

it('notifications can be marked read only by the local recipient', async () => {
  const { alice, bob, hid } = await setup();
  await addExpense(hid, expenseInput(alice, bob));
  const id = Object.keys(household(hid).notifications)[0];
  await expect(markNotificationRead(hid, id)).rejects.toThrow();
  await logout(); await login({ email: bob.email, password: PASSWORD });
  await markNotificationRead(hid, id);
  expect(household(hid).notifications[id].read).toBe(true);
});

it('storage quota failures preserve the previous complete database', async () => {
  const { alice, bob, hid } = await setup();
  const before = localStorage.getItem(DATABASE_KEY);
  const originalSet = storage.setItem;
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  await expect(addExpense(hid, expenseInput(alice, bob))).rejects.toThrow('storage is full');
  expect(localStorage.getItem(DATABASE_KEY)).toBe(before);
  storage.setItem = originalSet;
});

it('deleting a household also removes its invites, then account deletion works', async () => {
  const { alice, hid } = await setup();
  await expect(deleteAccount(PASSWORD)).rejects.toThrow('households');
  await deleteHousehold(hid);
  expect(readDatabase().households[hid]).toBeUndefined();
  expect(Object.values(readDatabase().invites)).toHaveLength(0);
  await deleteAccount(PASSWORD);
  expect(readDatabase().users[alice.uid]).toBeUndefined();
  expect(localStorage.getItem(SESSION_KEY)).toBeNull();
});
