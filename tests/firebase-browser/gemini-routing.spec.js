import { test, expect } from '@playwright/test';
const input = (root, label) => root.locator('label').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).locator('..').locator('input,select,textarea').first();
const url = (path) => `http://127.0.0.1:8089/v1/projects/demo-roomsync/databases/(default)/documents/${path}`;
async function list(hid, kind) { const r = await fetch(url(`households/${hid}/${kind}`), { headers: { Authorization: 'Bearer owner' } }); expect(r.ok).toBe(true); return (await r.json()).documents || []; }
async function setup(page) {
  await page.goto('/register'); await page.getByLabel('Your name').fill('Alice');
  await page.getByLabel('Email', { exact: true }).fill(`gemini-route-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('gemini-test-only-123'); await page.getByLabel('Confirm', { exact: true }).fill('gemini-test-only-123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible();
  const uid = await page.evaluate(async () => (await import('/src/firebase.js')).auth.currentUser.uid);
  await page.getByLabel('Household name').fill('Gemini routing test'); await page.locator('form').getByRole('button', { name: 'Create household', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gemini routing test', exact: true })).toBeVisible();
  const hid = await page.evaluate(() => localStorage.getItem('roomsync.activeHousehold')); await page.goto('/expenses'); return { uid, hid };
}
async function mockAI(page, drafts, status = 200) {
  const posts = [];
  await page.route('**/api/quick-add', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, provider: 'gemini', model: 'gemini-test-model' }) });
    posts.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { provider: 'gemini', model: 'gemini-test-model', drafts: typeof drafts === 'function' ? drafts() : drafts } : { error: 'Gemini quota/rate limit reached. Nothing was saved.' }) });
  });
  return posts;
}
async function parse(page, text) {
  await page.getByRole('button', { name: 'AI Quick Add', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'AI Quick Add', exact: true });
  await expect(modal.getByText('Gemini is configured securely on the server.', { exact: true })).toBeVisible();
  await modal.getByLabel('Describe your expenses').fill(text);
  await modal.getByRole('checkbox', { name: /Send this request and current member display names/ }).check();
  await modal.getByRole('button', { name: 'Parse expenses', exact: true }).click();
}
const step = (page, i, n) => page.getByRole('dialog', { name: `Expense ${i} of ${n}`, exact: true });

test('Gemini mixed drafts save to Groceries, Bills and Expenses atomically only after final confirmation', async ({ page }) => {
  let uid;
  const posts = await mockAI(page, () => [
    { type: 'grocery', title: 'Rice', category: 'Grains', quantity: '2', unit: 'kg', participants: [], clarifications: [] },
    { type: 'bill', title: 'Electricity reminder', amountRupees: '300', date: '2026-10-16', category: 'Electricity', recurrence: 'monthly', participants: [uid], clarifications: [] },
    { type: 'expense', title: 'Dinner paid', amountRupees: '800.01', date: '2026-10-14', category: 'Food & dining', payerUid: uid, participants: [uid], splitMethod: 'equal', clarifications: [] },
  ]);
  const context = await setup(page); uid = context.uid; const { hid } = context;
  await parse(page, 'Add 2kg rice to shopping; electricity bill 300 tomorrow monthly; I paid dinner 800.01 yesterday.');
  const grocery = step(page, 1, 3); await expect(grocery.getByLabel('Save this record to')).toHaveValue('grocery'); await expect(input(grocery, 'Item')).toHaveValue('Rice');
  expect(await list(hid, 'shoppingItems')).toHaveLength(0); await grocery.getByRole('button', { name: 'Next expense', exact: true }).click();
  const bill = step(page, 2, 3); await expect(bill.getByLabel('Save this record to')).toHaveValue('bill'); await expect(input(bill, 'Expected amount (₹)')).toHaveValue('300.00');
  expect(await list(hid, 'bills')).toHaveLength(0); await bill.getByRole('button', { name: 'Next expense', exact: true }).click();
  const expense = step(page, 3, 3); await expect(expense.getByLabel('Save this record to')).toHaveValue('expense'); await expense.getByRole('button', { name: 'Review all expenses', exact: true }).click();
  const summary = page.getByRole('dialog', { name: 'Confirm expense batch', exact: true });
  await expect(summary).toContainText('Destination: Groceries'); await expect(summary).toContainText('Destination: Bills'); await expect(summary).toContainText('Destination: Expenses');
  expect(await list(hid, 'expenses')).toHaveLength(0); expect(await list(hid, 'activity')).toHaveLength(0);
  await summary.getByRole('button', { name: 'Add All Records', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Records added', exact: true })).toContainText('All 3 records were saved.');
  const items = await list(hid, 'shoppingItems'); const bills = await list(hid, 'bills'); const expenses = await list(hid, 'expenses');
  expect(items).toHaveLength(1); expect(items[0].fields.purchased.booleanValue).toBe(false); expect(items[0].fields.name.stringValue).toBe('Rice');
  expect(bills).toHaveLength(1); expect(bills[0].fields.paidAt.nullValue).toBeDefined(); expect(bills[0].fields.expenseId.nullValue).toBeDefined();
  expect(expenses).toHaveLength(1); expect(expenses[0].fields.totalPaise.integerValue).toBe('80001'); expect(await list(hid, 'activity')).toHaveLength(3);
  expect(posts).toHaveLength(1); expect(posts[0].headers.authorization).toMatch(/^Bearer /); expect(Object.keys(posts[0].body).sort()).toEqual(['householdId', 'text', 'today']);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.goto('/groceries'); await expect(page.locator('.list-row .title')).toContainText('Rice');
  await page.goto('/bills'); await expect(page.getByText('Electricity reminder', { exact: true })).toBeVisible();
  await page.goto('/expenses'); await expect(page.getByText('Dinner paid', { exact: true })).toBeVisible();
});

test('review can correct the Gemini destination; no inference or cancellation writes a record', async ({ page }) => {
  await mockAI(page, [{ type: 'expense', title: 'Milk', amountRupees: '50', category: 'Groceries', date: '2026-10-14', participants: [], clarifications: ['Confirm whether this is a purchase or shopping plan.'] }]);
  const { hid } = await setup(page); await parse(page, 'milk');
  const modal = step(page, 1, 1); await modal.getByLabel('Save this record to').selectOption('grocery');
  await expect(input(modal, 'Item')).toHaveValue('Milk'); await input(modal, 'Quantity').fill('2');
  await modal.getByRole('button', { name: 'Review all expenses', exact: true }).click();
  await page.getByRole('button', { name: 'Add All Records', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Records added', exact: true })).toBeVisible();
  expect(await list(hid, 'expenses')).toHaveLength(0); expect(await list(hid, 'shoppingItems')).toHaveLength(1);
});

test('provider quota errors stay explicit and require deliberate local fallback; prompt is not sent without consent', async ({ page }) => {
  const posts = await mockAI(page, [], 429); const { hid } = await setup(page);
  await page.getByRole('button', { name: 'AI Quick Add', exact: true }).click(); const modal = page.getByRole('dialog', { name: 'AI Quick Add', exact: true });
  await modal.getByLabel('Describe your expenses').fill('Add 2 kg rice to the grocery list');
  await expect(modal.getByLabel('Parsing method')).toHaveValue('gemini');
  await modal.getByRole('button', { name: 'Parse expenses', exact: true }).click(); await expect(modal.getByRole('alert')).toContainText('Confirm sending'); expect(posts).toHaveLength(0);
  await modal.getByRole('checkbox', { name: /Send this request and current member display names/ }).check();
  await modal.getByRole('button', { name: 'Parse expenses', exact: true }).click(); await expect(modal.getByRole('alert')).toContainText('quota/rate limit'); expect(posts).toHaveLength(1);
  await modal.getByLabel('Parsing method').selectOption('local'); await modal.getByRole('button', { name: 'Parse expenses', exact: true }).click();
  const grocery = step(page, 1, 1); await expect(input(grocery, 'Item')).toHaveValue('rice'); await expect(grocery).toContainText('Local parser (not AI)');
  await grocery.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Discard drafts', exact: true }).click();
  expect(await list(hid, 'shoppingItems')).toHaveLength(0); expect(await list(hid, 'expenses')).toHaveLength(0);
});

test('mixed batch survives lost acknowledgement and reload without duplicating any destination collection', async ({ page }) => {
  await mockAI(page, [{ type: 'grocery', title: 'Milk', category: 'Dairy', quantity: '1', unit: 'l', clarifications: [] }, { type: 'bill', title: 'Rent', amountRupees: '18000', date: '2026-10-16', recurrence: 'monthly', category: 'Rent', participants: [], clarifications: [] }]);
  await page.route('**/src/services/expenseBatches.js', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('export async function saveExpenseBatch(request)', 'async function internalSave(request)') + '\nexport async function saveExpenseBatch(request) { const result = await internalSave(request); if(!globalThis.__mixedAckLost){globalThis.__mixedAckLost=true;throw new Error("Test lost mixed acknowledgement");}return result;}\n' }); });
  const { hid } = await setup(page); await parse(page, 'Add milk and create monthly rent bill');
  await step(page, 1, 2).getByRole('button', { name: 'Next expense', exact: true }).click();
  const bill = step(page, 2, 2); await bill.getByRole('checkbox', { name: /Alice/ }).check(); await bill.getByRole('button', { name: 'Review all expenses', exact: true }).click();
  await page.getByRole('button', { name: 'Add All Records', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Test lost mixed acknowledgement');
  expect(await list(hid, 'shoppingItems')).toHaveLength(1); expect(await list(hid, 'bills')).toHaveLength(1); expect(await list(hid, 'expenses')).toHaveLength(0);
  await page.reload(); await page.getByRole('button', { name: 'AI Quick Add', exact: true }).click(); await page.getByRole('button', { name: 'Check saved status', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Records added', exact: true })).toContainText('All 2 records were saved');
  expect(await list(hid, 'shoppingItems')).toHaveLength(1); expect(await list(hid, 'bills')).toHaveLength(1); expect(await list(hid, 'activity')).toHaveLength(2);
});
