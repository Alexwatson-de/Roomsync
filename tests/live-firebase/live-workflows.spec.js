import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Opt-in only: these checks intentionally write disposable test records to the
// configured LIVE project. No actual household records are read or changed.
const marker = `ROOMSYNC-TEST-${Date.now()}-${randomBytes(4).toString('hex')}`;
const manifestPath = `artifacts/tests/live-firebase-${marker}.json`;
const manifest = { projectId: 'roomsync-9dceb', marker, accountIds: [], accountEmails: [], householdIds: [], inviteIds: [] };
const password = randomBytes(20).toString('base64url');
function saveManifest() { mkdirSync('artifacts/tests', { recursive: true }); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); }
const input = (root, label) => root.locator('label').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).locator('..').locator('input,select,textarea').first();
async function localModules(page, action, data) {
  return page.evaluate(async ({ action, data }) => {
    const store = await import('/src/services/cloudStore.js');
    if (store.db.app.options.projectId !== 'roomsync-9dceb') throw new Error('Wrong Firebase project for live verification.');
    if (action === 'identity') return store.auth.currentUser?.uid || null;
    if (action === 'records') return new Promise((resolve, reject) => {
      const stop = store.listenRecords(data.hid, data.kind, (records, metadata) => {
        // A cached initial snapshot is not evidence of a completed server
        // read; wait for the live backend confirmation before asserting.
        if (!metadata.fromCache && !metadata.hasPendingWrites) { stop(); resolve(records); }
      }, reject);
    });
    if (action === 'nonmember-read') {
      try { await new Promise((resolve, reject) => {
        const stop = store.listenRecords(data.hid, 'expenses', (records) => { stop(); resolve(records); }, reject);
      }); return 'unexpected-success'; } catch (error) { return error.code; }
    }
    if (action === 'self-escalation') {
      const households = await import('/src/services/households.js');
      try { await households.setMemberRole(data.hid, store.currentUser().uid, 'admin'); return 'unexpected-success'; }
      catch (error) { return error.code; }
    }
    if (action === 'expense-update') {
      const expenses = await import('/src/services/expenses.js');
      await expenses.updateExpense(data.hid, data.id, data.input);
    }
    if (action === 'settlement') {
      const settlements = await import('/src/services/settlements.js');
      return settlements.recordSettlement(data.hid, data.input);
    }
    if (action === 'confirm-settlement') { const s = await import('/src/services/settlements.js'); await s.confirmSettlement(data.hid, data.id); }
    if (action === 'reverse-settlement') { const s = await import('/src/services/settlements.js'); await s.reverseSettlement(data.hid, data.id); }
    if (action === 'recurrence-and-shopping') {
      const bills = await import('/src/services/bills.js');
      const groceries = await import('/src/services/groceries.js');
      const chores = await import('/src/services/chores.js');
      const billId = await bills.createBill(data.hid, { name: data.marker + ' bill', category: 'Internet', expectedPaise: 20000, dueDate: '2026-10-31', recurrence: 'monthly', assignedTo: data.otherUid, participants: data.input.participants });
      const payment = { paidPaise: 20000, expenseInput: { ...data.input, title: data.marker + ' bill payment', totalPaise: 20000, payers: { [store.currentUser().uid]: 20000 } } };
      const nextBill = await bills.markBillPaid(data.hid, { id: billId }, payment);
      await bills.markBillPaid(data.hid, { id: billId }, payment);
      const itemId = await groceries.addItem(data.hid, { name: data.marker + ' grocery', quantity: '1', unit: 'item' });
      const purchase = { pricePaise: 10000, paidBy: store.currentUser().uid, expenseInput: { ...data.input, title: data.marker + ' grocery payment', totalPaise: 10000, payers: { [store.currentUser().uid]: 10000 } } };
      await groceries.markPurchased(data.hid, { id: itemId }, purchase);
      await groceries.markPurchased(data.hid, { id: itemId }, purchase);
      const choreId = await chores.createChore(data.hid, { title: data.marker + ' chore', instructions: 'Disposable verification', dueDate: '2026-10-15', recurrence: 'weekly', priority: 'low', assignees: [], rotation: [store.currentUser().uid, data.otherUid] });
      const nextChore = await chores.completeChore(data.hid, { id: choreId });
      await chores.completeChore(data.hid, { id: choreId });
      return { billId, nextBill, itemId, choreId, nextChore };
    }
    if (action === 'delete-expense') { const e = await import('/src/services/expenses.js'); await e.deleteExpense(data.hid, data.id); }
    if (action === 'mark-notifications') {
      const notifications = await import('/src/services/activity.js');
      await new Promise((resolve, reject) => {
        const stop = notifications.listenNotifications(data.hid, store.currentUser().uid, async (records) => {
          stop(); try { await notifications.markAllNotificationsRead(data.hid, records); resolve(); } catch (error) { reject(error); }
        }, reject);
      });
    }
    return null;
  }, { action, data });
}
async function register(page, role) {
  const email = `${marker.toLowerCase()}-${role}@example.test`;
  manifest.accountEmails.push(email); saveManifest();
  await page.goto('/register');
  await page.getByLabel('Your name').fill(`${marker} ${role}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  // Capture the account immediately even if profile save/onboarding fails.
  await expect.poll(() => localModules(page, 'identity'), { timeout: 30000 }).toBeTruthy();
  const uid = await localModules(page, 'identity'); manifest.accountIds.push(uid); saveManifest();
  await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible({ timeout: 30000 });
  return { uid, email };
}

test('LIVE Firebase: Auth, indexes, household sharing, ledger, settlements, recurrence and permission checks', async ({ page, browser }) => {
  test.skip(process.env.ROOMSYNC_LIVE_TESTS !== '1', 'Live database writes require explicit opt-in.');
  saveManifest();
  const browserErrors = []; page.on('pageerror', (error) => browserErrors.push(error.message));
  const owner = await register(page, 'owner');
  await page.getByLabel('Household name').fill(marker);
  await page.locator('form').getByRole('button', { name: 'Create household', exact: true }).click();
  await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible({ timeout: 30000 });
  const hid = await page.evaluate(() => localStorage.getItem('roomsync.activeHousehold'));
  manifest.householdIds.push(hid); saveManifest();
  await page.goto('/members');
  await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Generate invite code', exact: true }).click();
  await expect(dialog.locator('code').first()).toHaveText(/^[a-f0-9]{64}$/, { timeout: 30000 });
  const token = await dialog.locator('code').first().textContent(); manifest.inviteIds.push(token); saveManifest();
  const other = await browser.newContext(); const memberPage = await other.newPage();
  try {
    const member = await register(memberPage, 'member');
    expect(await localModules(memberPage, 'nonmember-read', { hid })).toBe('permission-denied');
    await memberPage.getByRole('button', { name: 'Join with invite', exact: true }).click();
    await memberPage.getByLabel('Invite code').fill(token);
    await memberPage.locator('form').getByRole('button', { name: 'Join household', exact: true }).click();
    await expect(memberPage.getByRole('heading', { name: marker, exact: true })).toBeVisible({ timeout: 30000 });
    expect(await localModules(memberPage, 'self-escalation', { hid })).toBe('permission-denied');
    await memberPage.goto('/expenses');
    await page.goto('/expenses');
    await page.getByRole('button', { name: '+ Add expense', exact: true }).click();
    const expenseForm = page.getByRole('dialog');
    await input(expenseForm, 'Title').fill(marker + ' expense');
    await input(expenseForm, 'Amount (₹)').fill('1200');
    await expenseForm.getByRole('button', { name: 'Save expense', exact: true }).click();
    await expect(expenseForm).toHaveCount(0, { timeout: 30000 });
    await expect(memberPage.getByText(marker + ' expense', { exact: true })).toBeVisible({ timeout: 30000 });
    const expenses = await localModules(page, 'records', { hid, kind: 'expenses' }); expect(expenses).toHaveLength(1);
    const sharedInput = { title: marker + ' expense', date: '2026-10-15', category: 'Groceries', totalPaise: 120000, payers: { [owner.uid]: 120000 }, participants: [owner.uid, member.uid], splitMethod: 'equal', splitDetail: null, description: 'Disposable live verification only' };
    const sid = await localModules(memberPage, 'settlement', { hid, input: { from: member.uid, to: owner.uid, amountPaise: 25000, date: '2026-10-15', note: 'Disposable test; no money moved' } });
    await localModules(page, 'confirm-settlement', { hid, id: sid });
    await memberPage.goto('/balances');
    await expect(memberPage.getByText('-₹350.00', { exact: true }).first()).toBeVisible({ timeout: 30000 });
    await localModules(page, 'reverse-settlement', { hid, id: sid });
    await expect(memberPage.getByText('-₹600.00', { exact: true }).first()).toBeVisible({ timeout: 30000 });
    const results = await localModules(page, 'recurrence-and-shopping', { hid, marker, otherUid: member.uid, input: sharedInput });
    expect(await localModules(page, 'records', { hid, kind: 'expenses' })).toHaveLength(3);
    expect(await localModules(page, 'records', { hid, kind: 'bills' })).toHaveLength(2);
    const chores = await localModules(page, 'records', { hid, kind: 'chores' }); expect(chores).toHaveLength(2);
    expect(chores.find((c) => c.id === results.nextChore).assignees).toEqual([member.uid]);
    await localModules(page, 'expense-update', { hid, id: expenses[0].id, input: { ...sharedInput, totalPaise: 10001, payers: { [owner.uid]: 10001 } } });
    const updated = (await localModules(page, 'records', { hid, kind: 'expenses' })).find((e) => e.id === expenses[0].id);
    expect(Object.values(updated.shares).reduce((a, b) => a + b, 0)).toBe(10001);
    await localModules(page, 'delete-expense', { hid, id: expenses[0].id });
    await localModules(memberPage, 'mark-notifications', { hid });
    await page.reload(); await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible({ timeout: 30000 });
    for (const route of ['/bills', '/chores', '/groceries', '/activity', '/reports', '/members', '/settings', '/notifications']) {
      await page.goto(route); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30000 });
      await expect(page.getByText("Shared data couldn't be loaded")).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: marker, exact: true })).toBeVisible({ timeout: 30000 });
    expect(browserErrors).toEqual([]);
    console.log('LIVE verification passed. Disposable resource IDs are recorded for administrator cleanup.');
  } finally { await other.close(); saveManifest(); }
});
