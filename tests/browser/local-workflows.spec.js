import { test, expect } from '@playwright/test';

const DB_KEY = 'roomsync.local.database.v1';
const PASSWORD = 'test-only-password';
// Several older forms do not connect label/for; use their visible field labels.
const field = (root, label) => root.locator('label').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).locator('..').locator('input, select, textarea').first();

async function registerAndCreate(page) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Alice');
  await page.getByLabel('Email', { exact: true }).fill('alice@example.test');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible();
  await page.getByLabel('Household name').fill('Local Test Flat');
  await page.locator('form').getByRole('button', { name: 'Create household', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Local Test Flat', exact: true })).toBeVisible();
}

async function db(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), DB_KEY);
}

async function expenseThroughUi(page, title = 'Weekly groceries', amount = '1200.01') {
  await page.goto('/expenses');
  await page.getByRole('button', { name: '+ Add expense', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await field(dialog, 'Title').fill(title);
  await field(dialog, 'Amount (₹)').fill(amount);
  await dialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

test('local registration, household, expense, refresh, sign out/in, edit and delete', async ({ page }) => {
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== 'localhost') externalRequests.push(request.url()); });
  await registerAndCreate(page);
  await expenseThroughUi(page);
  await page.reload();
  await expect(page.getByText('Weekly groceries', { exact: true })).toBeVisible();
  expect(Object.values((await db(page)).households)[0].expenses).toBeTruthy();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editDialog = page.getByRole('dialog');
  await field(editDialog, 'Amount (₹)').fill('650.55');
  await editDialog.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(editDialog).not.toBeVisible();
  await expect(page.getByRole('cell', { name: '₹650.55', exact: true })).toBeVisible();

  for (const route of ['/balances', '/bills', '/chores', '/groceries', '/activity', '/reports', '/members', '/settings', '/notifications']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.spinner')).toHaveCount(0);
  }
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('alice@example.test');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Local Test Flat', exact: true })).toBeVisible();
  await page.goto('/expenses');
  await expect(page.getByText('Weekly groceries', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No expenses yet' })).toBeVisible();
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('bill payment, next occurrence, chores and grocery expense links persist through UI', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await registerAndCreate(page);
  await page.goto('/bills');
  await page.getByRole('button', { name: '+ Add bill', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await field(dialog, 'Name').fill('Rent');
  await field(dialog, 'Expected amount (₹)').fill('1200');
  await field(dialog, 'Due date').fill('2026-10-31');
  await dialog.getByRole('button', { name: 'Save bill', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Mark paid', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let h = Object.values((await db(page)).households)[0];
  expect(Object.values(h.expenses)).toHaveLength(1);
  expect(Object.values(h.bills)).toHaveLength(2);
  expect(Object.values(h.bills).find((b) => !b.paidAt).dueDate).toBe('2026-11-30');

  await page.goto('/chores');
  await page.getByRole('button', { name: '+ Add chore', exact: true }).click();
  dialog = page.getByRole('dialog');
  await field(dialog, 'Title').fill('Clean kitchen');
  await field(dialog, 'Recurrence').selectOption('weekly');
  await dialog.locator('input[type="checkbox"]').last().check();
  await dialog.getByRole('button', { name: 'Save chore', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => Object.values(Object.values((await db(page)).households)[0].chores).length).toBe(2);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();

  await page.goto('/groceries');
  await page.getByRole('button', { name: '+ Add item', exact: true }).click();
  dialog = page.getByRole('dialog');
  await field(dialog, 'Item').fill('Milk');
  await dialog.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  // This control opens purchase confirmation; it is checked only after save.
  await page.locator('.list-row input[type="checkbox"]').click();
  dialog = page.getByRole('dialog');
  await field(dialog, 'Price (₹, optional)').fill('60.50');
  await dialog.locator('input[type="checkbox"]').first().check();
  await dialog.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Purchased', exact: true }).click();
  await expect(page.getByText('Milk', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Purchased', exact: true }).click();
  await expect(page.getByText('Milk', { exact: true })).toBeVisible();
  h = Object.values((await db(page)).households)[0];
  expect(Object.values(h.expenses)).toHaveLength(2);
  expect(Object.values(h.shoppingItems)[0].expenseId).toBeTruthy();
  expect(errors).toEqual([]);
});

test('same-origin tab updates, local invites, household isolation, mobile menu and password reset honesty', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await registerAndCreate(page);
  const secondPage = await context.newPage();
  await secondPage.goto('/expenses');
  await expect(secondPage.getByRole('heading', { name: 'No expenses yet' })).toBeVisible();
  await expenseThroughUi(page, 'Cross tab expense', '99.99');
  await expect(secondPage.getByText('Cross tab expense', { exact: true })).toBeVisible();

  const result = await page.evaluate(async (password) => {
    const auth = await import('/src/services/auth.js');
    const households = await import('/src/services/households.js');
    const store = await import('/src/services/localStore.js');
    const first = Object.values(store.readDatabase().households)[0];
    const token = await households.createInvite(first.id, first.name);
    await auth.logout();
    const bob = await auth.register({ email: 'bob@example.test', password, displayName: 'Bob' });
    await households.joinHousehold(token);
    const second = await households.createHousehold({ name: 'Second Household' });
    return { firstId: first.id, secondId: second, bobId: bob.uid };
  }, PASSWORD);
  await page.goto('/');
  await page.locator('.sidebar select').selectOption(result.secondId);
  await expect(page.getByRole('heading', { name: 'Second Household', exact: true })).toBeVisible();
  await page.goto('/expenses');
  await expect(page.getByRole('heading', { name: 'No expenses yet' })).toBeVisible();
  await page.locator('.sidebar select').selectOption(result.firstId);
  await expect(page.getByText('Cross tab expense', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.locator('main').getByRole('link', { name: 'Bills', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bills', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: 'Local account recovery' })).toBeVisible();
  await expect(page.getByText(/no password reset email can be sent/)).toBeVisible();
  await secondPage.close();
  expect(errors).toEqual([]);
});
