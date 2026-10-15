import { test, expect } from '@playwright/test';
const PASSWORD = 'quick-add-test-only-123';
const input = (root, text) => root.locator('label').filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).locator('..').locator('input,select,textarea').first();
const documentUrl = (path) => `http://127.0.0.1:8089/v1/projects/demo-roomsync/databases/(default)/documents/${path}`;
async function records(hid, kind) {
  const response = await fetch(documentUrl(`households/${hid}/${kind}`), { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok).toBe(true);
  return (await response.json()).documents || [];
}
async function setup(page, duplicateRahul = false) {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Alice Watson');
  await page.getByLabel('Email', { exact: true }).fill(`quick-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible();
  const uid = await page.evaluate(async () => (await import('/src/firebase.js')).auth.currentUser.uid);
  await page.getByLabel('Household name').fill('Quick Add Household');
  await page.locator('form').getByRole('button', { name: 'Create household', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Quick Add Household', exact: true })).toBeVisible();
  const hid = await page.evaluate(() => localStorage.getItem('roomsync.activeHousehold'));
  const others = [['rahul', 'Rahul Sharma'], ['priya', 'Priya Patel'], ...(duplicateRahul ? [['rahul-other', 'Rahul Verma']] : [])];
  for (const [id, name] of others) {
    // Fake members are created only inside the isolated demo emulator.
    const response = await fetch(documentUrl(`households/${hid}/members/${id}`), { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { uid: { stringValue: id }, householdId: { stringValue: hid }, displayName: { stringValue: name }, role: { stringValue: 'member' } } }) });
    expect(response.ok).toBe(true);
  }
  await page.goto('/members');
  await expect(page.getByText('Rahul Sharma', { exact: true })).toBeVisible();
  return { hid, uid, errors };
}
async function ask(page, prompt) {
  if (!(await page.getByRole('dialog', { name: 'Quick Add', exact: true }).count())) await page.getByRole('button', { name: 'Quick Add', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Quick Add', exact: true });
  await chat.getByLabel('What would you like to record?').fill(prompt);
  await chat.getByRole('button', { name: 'Review draft', exact: true }).click();
}
async function expectSaved(page, text) {
  await expect(page.getByRole('dialog', { name: 'Quick Add', exact: true }).getByRole('log')).toContainText(text);
}

test('grocery chat opens an editable modal and cancel makes no writes; only Save creates an item', async ({ page }) => {
  const { hid, errors } = await setup(page);
  await page.getByRole('button', { name: 'Quick Add', exact: true }).click();
  await page.screenshot({ path: 'artifacts/tests/quick-add-chat-desktop.png', fullPage: true, animations: 'disabled' });
  await ask(page, 'Add 2 kg rice to the grocery list');
  const draft = page.getByRole('dialog', { name: 'Add grocery item', exact: true });
  await expect(draft).toBeVisible();
  await expect(input(draft, 'Item')).toHaveValue('rice');
  await expect(input(draft, 'Quantity')).toHaveValue('2');
  await expect(input(draft, 'Unit')).toHaveValue('kg');
  await expect(draft.getByRole('note')).toContainText('Nothing has been saved');
  expect(await records(hid, 'shoppingItems')).toHaveLength(0);
  expect(await records(hid, 'activity')).toHaveLength(0);
  await draft.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await records(hid, 'shoppingItems')).toHaveLength(0);
  await ask(page, 'Add 2 kg rice to the grocery list');
  await input(draft, 'Item').fill('Brown rice');
  await draft.getByRole('button', { name: 'Save item', exact: true }).click();
  await expectSaved(page, 'Grocery item saved');
  const saved = await records(hid, 'shoppingItems'); expect(saved).toHaveLength(1);
  expect(saved[0].fields.name.stringValue).toBe('Brown rice');
  expect(saved[0].fields.quantity.stringValue).toBe('2');
  expect(await records(hid, 'expenses')).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('equal, custom, percentage and shares drafts are exact; invalid allocations cannot save', async ({ page }) => {
  const { hid, uid, errors } = await setup(page);
  await ask(page, 'I paid ₹1500.01 for groceries shared equally between me, Rahul and Priya');
  let draft = page.getByRole('dialog', { name: 'Review expense draft', exact: true });
  await expect(input(draft, 'Amount (₹)')).toHaveValue('1500.01');
  await expect(input(draft, 'Paid by')).toHaveValue(uid);
  expect(await records(hid, 'expenses')).toHaveLength(0);
  await draft.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expectSaved(page, 'Shared expense saved');
  let saved = await records(hid, 'expenses'); expect(saved).toHaveLength(1);
  const shares = Object.values(saved[0].fields.shares.mapValue.fields).map((v) => Number(v.integerValue));
  expect(shares.reduce((a, b) => a + b, 0)).toBe(150001);
  await ask(page, 'I paid 1500 for dinner split unequally: me 600, Rahul 800');
  draft = page.getByRole('dialog', { name: 'Review expense draft', exact: true });
  await expect(draft.getByRole('button', { name: 'Amounts', exact: true })).toHaveClass(/active/);
  await draft.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(draft.locator('.error-text')).toContainText('must add up');
  expect(await records(hid, 'expenses')).toHaveLength(1);
  // Exact member rows retain editable values; total input is first decimal field.
  await draft.locator('input[inputmode="decimal"]').nth(1).fill('700');
  await draft.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expectSaved(page, 'Shared expense saved');
  saved = await records(hid, 'expenses'); expect(saved).toHaveLength(2);
  const custom = saved.find((e) => e.fields.splitMethod.stringValue === 'custom');
  expect(Number(custom.fields.shares.mapValue.fields[uid].integerValue)).toBe(70000);
  await ask(page, 'I paid 1000 for lunch split percentages: me 60%, Rahul 40%');
  await page.getByRole('dialog', { name: 'Review expense draft', exact: true }).getByRole('button', { name: 'Save expense', exact: true }).click();
  await expectSaved(page, 'Shared expense saved');
  await ask(page, 'I paid 900 for dinner split 2:1 between me and Rahul');
  await page.getByRole('dialog', { name: 'Review expense draft', exact: true }).getByRole('button', { name: 'Save expense', exact: true }).click();
  await expectSaved(page, 'Shared expense saved');
  saved = await records(hid, 'expenses'); expect(saved).toHaveLength(4);
  const ratio = saved.find((e) => e.fields.splitMethod.stringValue === 'shares');
  expect(Number(ratio.fields.shares.mapValue.fields[uid].integerValue)).toBe(60000);
  expect(errors).toEqual([]);
});

test('ambiguous member names require selection, and unsupported/destructive prompts never mutate data', async ({ page }) => {
  const { hid } = await setup(page, true);
  await ask(page, 'I paid 1000 for groceries split equally between me and Rahul');
  const chat = page.getByRole('dialog', { name: 'Quick Add', exact: true });
  await expect(chat.getByText('Choose the correct household members', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Review expense draft', exact: true })).toHaveCount(0);
  expect(await records(hid, 'expenses')).toHaveLength(0);
  await chat.locator('select[id^="quick-member-"]').selectOption('rahul-other');
  await chat.getByRole('button', { name: 'Review draft', exact: true }).click();
  const draft = page.getByRole('dialog', { name: 'Review expense draft', exact: true });
  await expect(draft.getByRole('checkbox', { name: /Rahul Verma/ })).toBeChecked();
  await expect(draft.getByRole('checkbox', { name: /Rahul Sharma/ })).not.toBeChecked();
  await draft.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expectSaved(page, 'Shared expense saved');
  const saved = await records(hid, 'expenses'); expect(saved[0].fields.shares.mapValue.fields).toHaveProperty('rahul-other');
  expect(saved[0].fields.shares.mapValue.fields).not.toHaveProperty('rahul');
  await ask(page, 'Delete all expenses');
  await expect(chat.getByRole('alert')).toContainText('does not delete');
  await ask(page, 'I paid $5 for dinner');
  await expect(chat.getByRole('alert')).toContainText('uses INR');
  expect(await records(hid, 'expenses')).toHaveLength(1);
});

test('bills, chores, repayments and existing paid/purchased/completed actions all require final confirmation', async ({ page }) => {
  const { hid, errors } = await setup(page);
  await ask(page, 'Create a rent bill ₹18000 due tomorrow monthly');
  const bill = page.getByRole('dialog', { name: 'Add bill', exact: true });
  await expect(input(bill, 'Name')).toHaveValue('rent');
  await expect(input(bill, 'Recurrence')).toBeEnabled();
  expect(await records(hid, 'bills')).toHaveLength(0);
  await bill.getByRole('button', { name: 'Save bill', exact: true }).click(); await expectSaved(page, 'New bill saved');
  await ask(page, 'Mark rent bill as paid by Rahul for ₹18000');
  let choose = page.getByRole('dialog', { name: 'Choose existing record', exact: true });
  await expect(choose.locator('#quick-record')).not.toHaveValue('');
  await choose.locator('input[type="checkbox"]').uncheck();
  await choose.getByRole('button', { name: 'Review payment', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Mark "rent" as paid', exact: true });
  await expect(input(payment, 'Paid by')).toHaveValue('rahul');
  expect((await records(hid, 'bills'))[0].fields.paidAt.nullValue).toBeDefined();
  await payment.getByRole('button', { name: 'Mark paid', exact: true }).click(); await expectSaved(page, 'Bill marked paid');
  expect(await records(hid, 'expenses')).toHaveLength(0);
  expect(await records(hid, 'bills')).toHaveLength(2);
  expect((await records(hid, 'bills')).find((record) => record.fields.paidAt.timestampValue).fields.paidBy.stringValue).toBe('rahul');
  await ask(page, 'Add milk');
  await page.getByRole('dialog', { name: 'Add grocery item', exact: true }).getByRole('button', { name: 'Save item', exact: true }).click();
  await expectSaved(page, 'Grocery item saved');
  await ask(page, 'Mark milk as purchased for ₹60 split unequally: me 40, Rahul 20');
  choose = page.getByRole('dialog', { name: 'Choose existing record', exact: true });
  await choose.getByRole('button', { name: 'Review payment', exact: true }).click();
  const purchase = page.getByRole('dialog', { name: 'Review payment: milk', exact: true });
  expect(await records(hid, 'expenses')).toHaveLength(0);
  await purchase.getByRole('button', { name: 'Save expense', exact: true }).click(); await expectSaved(page, 'Payment recorded and linked');
  expect(await records(hid, 'expenses')).toHaveLength(1);
  const item = (await records(hid, 'shoppingItems'))[0];
  expect(item.fields.purchased.booleanValue).toBe(true); expect(item.fields.expenseId.stringValue).toBeTruthy();
  await ask(page, 'Assign chore clean the kitchen to Rahul tomorrow weekly');
  const chore = page.getByRole('dialog', { name: 'Add chore', exact: true });
  await chore.getByRole('button', { name: 'Save chore', exact: true }).click(); await expectSaved(page, 'New chore saved');
  await ask(page, 'Complete chore clean the kitchen');
  await page.getByRole('dialog', { name: 'Choose existing record', exact: true }).getByRole('button', { name: 'Review completion', exact: true }).click();
  const complete = page.getByRole('dialog', { name: 'Review chore completion', exact: true });
  expect((await records(hid, 'chores'))[0].fields.completedAt.nullValue).toBeDefined();
  await complete.getByRole('button', { name: 'Confirm completion', exact: true }).click(); await expectSaved(page, 'Chore completed');
  expect(await records(hid, 'chores')).toHaveLength(2);
  await ask(page, 'I repaid Rahul ₹100 yesterday');
  const settlement = page.getByRole('dialog', { name: 'Record settlement', exact: true });
  await expect(input(settlement, 'Receiver')).toHaveValue('rahul');
  expect(await records(hid, 'settlements')).toHaveLength(0);
  await settlement.getByRole('button', { name: 'Record settlement', exact: true }).click(); await expectSaved(page, 'no money transferred');
  expect(await records(hid, 'settlements')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Quick Add is mobile-friendly, cancels across household changes and makes no AI/external requests', async ({ page }) => {
  const { hid } = await setup(page);
  const external = [];
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && !['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)) external.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await ask(page, 'I paid ₹300 for dinner split equally with everyone');
  const draft = page.getByRole('dialog', { name: 'Review expense draft', exact: true });
  await expect(draft).toBeVisible();
  await expect(page.locator('body > .modal-overlay')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/tests/quick-add-review-mobile.png', fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape'); expect(await records(hid, 'expenses')).toHaveLength(0);
  await page.getByRole('dialog', { name: 'Quick Add', exact: true }).getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.goto('/onboarding');
  await page.getByLabel('Household name').fill('Second Quick Household');
  await page.locator('form').getByRole('button', { name: 'Create household', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Second Quick Household', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quick Add', exact: true }).click();
  await expect(page.getByLabel('What would you like to record?')).toHaveValue('');
  expect(await records(hid, 'expenses')).toHaveLength(0);
  expect(external).toEqual([]);
});
