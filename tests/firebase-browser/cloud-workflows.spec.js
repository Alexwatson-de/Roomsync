import { test, expect } from '@playwright/test';
const PASSWORD = 'test-accounts-only-123';
const field = (root, text) => root.locator('.field').filter({ has: root.page().locator('label', { hasText: text }) }).locator('input, select, textarea').first();
// Match labels exactly, including older forms without htmlFor.
const input = (root, text) => root.locator('label').filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).locator('..').locator('input,select,textarea').first();
async function register(page, name) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email', { exact: true }).fill(`${name.toLowerCase()}-${Date.now()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible();
}
async function createHousehold(page) {
  await page.getByLabel('Household name').fill('Cloud Test Flat');
  await page.locator('form').getByRole('button', { name: 'Create household', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cloud Test Flat', exact: true })).toBeVisible();
}
async function addExpense(page, title = 'Weekly groceries', amount = '1200.01') {
  await page.goto('/expenses');
  await page.getByRole('button', { name: '+ Add expense', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await input(dialog, 'Title').fill(title);
  await input(dialog, 'Amount (₹)').fill(amount);
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}
async function records(page, kind) {
  return page.evaluate(async (kind) => {
    const { listenRecords } = await import('/src/services/cloudStore.js');
    const hid = localStorage.getItem('roomsync.activeHousehold');
    return new Promise((resolve, reject) => {
      const unsubscribe = listenRecords(hid, kind, (records) => { unsubscribe(); resolve(records); }, reject);
    });
  }, kind);
}

test('Firebase Auth, household bootstrap, cloud ledger, reload, themes and dashboard interactions', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await register(page, 'Alice'); await createHousehold(page);
  await expect(page.getByRole('button', { name: 'View your balances' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(16, 29, 27)');
  await page.screenshot({ path: 'artifacts/tests/dashboard-dark.png', fullPage: true });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'View your balances' })).toBeVisible();
  await expect.poll(() => page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(237, 243, 241)');
  await page.screenshot({ path: 'artifacts/tests/dashboard-light.png', fullPage: true });
  await page.getByRole('button', { name: 'View your balances' }).click();
  await expect(page.getByRole('heading', { name: 'Balances', exact: true })).toBeVisible();
  await addExpense(page);
  await page.reload();
  await expect(page.getByText('Weekly groceries', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog');
  await input(edit, 'Amount (₹)').fill('650.55');
  await edit.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '₹650.55', exact: true })).toBeVisible();
  for (const route of ['/bills', '/chores', '/groceries', '/activity', '/reports', '/members', '/settings', '/notifications']) {
    await page.goto(route); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.spinner')).toHaveCount(0);
  }
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No expenses yet' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('atomic bill/grocery expense links, idempotent recurrence and receipts in Firebase emulators', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await register(page, 'Charlie'); await createHousehold(page);
  await page.goto('/bills'); await page.getByRole('button', { name: '+ Add bill', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await input(dialog, 'Name').fill('Rent'); await input(dialog, 'Expected amount (₹)').fill('1200');
  await input(dialog, 'Due date').fill('2026-10-31');
  await dialog.getByRole('button', { name: 'Save bill', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark paid', exact: true }).click();
  dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await records(page, 'expenses')).toHaveLength(1);
  expect(await records(page, 'bills')).toHaveLength(2);
  const paidBill = (await records(page, 'bills')).find((b) => b.paidAt);
  await page.evaluate(async (id) => {
    const bills = await import('/src/services/bills.js');
    const hid = localStorage.getItem('roomsync.activeHousehold');
    await bills.markBillPaid(hid, { id }, { paidPaise: 120000 });
  }, paidBill.id);
  expect(await records(page, 'expenses')).toHaveLength(1);
  await page.goto('/chores'); await page.getByRole('button', { name: '+ Add chore', exact: true }).click();
  dialog = page.getByRole('dialog'); await input(dialog, 'Title').fill('Kitchen');
  await input(dialog, 'Recurrence').selectOption('weekly'); await dialog.locator('input[type="checkbox"]').last().check();
  await dialog.getByRole('button', { name: 'Save chore', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await records(page, 'chores')).length).toBe(2);
  await page.goto('/groceries'); await page.getByRole('button', { name: '+ Add item', exact: true }).click();
  dialog = page.getByRole('dialog'); await input(dialog, 'Item').fill('Milk');
  await dialog.getByRole('button', { name: 'Save item', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.locator('.list-row input[type="checkbox"]').click(); dialog = page.getByRole('dialog');
  await input(dialog, 'Price (₹, optional)').fill('60.50'); await dialog.locator('input[type="checkbox"]').first().check();
  await dialog.getByRole('button', { name: 'Confirm purchase', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(await records(page, 'expenses')).toHaveLength(2);
  await page.goto('/expenses'); await page.getByRole('button', { name: '+ Add expense', exact: true }).click();
  dialog = page.getByRole('dialog'); await input(dialog, 'Title').fill('Receipt test'); await input(dialog, 'Amount (₹)').fill('10');
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmQAAAABJRU5ErkJggg==', 'base64') });
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect((await records(page, 'expenses')).find((e) => e.title === 'Receipt test').receiptUrl).toContain('127.0.0.1:9199');
  expect(errors).toEqual([]);
});

test('independent-device invitation, shared real-time expense, mobile theme and reduced motion', async ({ page, browser }) => {
  await register(page, 'Owner'); await createHousehold(page);
  await page.goto('/members'); await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Generate invite code', exact: true }).click();
  await expect(dialog.locator('code').first()).toHaveText(/^[a-f0-9]{64}$/);
  const token = await dialog.locator('code').first().textContent();
  const other = await browser.newContext(); const bob = await other.newPage();
  await register(bob, 'Housemate');
  await bob.getByRole('button', { name: 'Join with invite', exact: true }).click();
  await bob.getByLabel('Invite code').fill(token);
  await bob.locator('form').getByRole('button', { name: 'Join household', exact: true }).click();
  await expect(bob.getByRole('heading', { name: 'Cloud Test Flat', exact: true })).toBeVisible();
  await bob.goto('/expenses');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await addExpense(page, 'Shared electricity', '1200');
  await expect(bob.getByText('Shared electricity', { exact: true })).toBeVisible();
  await bob.goto('/balances'); await expect(bob.getByText('-₹600.00', { exact: true }).first()).toBeVisible();
  await bob.setViewportSize({ width: 390, height: 844 });
  await bob.goto('/'); await bob.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await bob.getByRole('button', { name: 'More', exact: true }).click();
  await bob.locator('main').getByRole('link', { name: 'Bills', exact: true }).click();
  await expect(bob.getByRole('heading', { name: 'Bills', exact: true })).toBeVisible();
  expect(await bob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await bob.emulateMedia({ reducedMotion: 'reduce' });
  expect(await bob.locator('.page-content').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await bob.screenshot({ path: 'artifacts/tests/mobile-dark.png', fullPage: true });
  await other.close();
});
