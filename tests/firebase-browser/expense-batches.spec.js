import { test, expect } from '@playwright/test';
const PASSWORD = 'batch-test-password-123';
const input = (root, label) => root.locator('label').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).locator('..').locator('input,select,textarea').first();
const documentUrl = (path) => `http://127.0.0.1:8089/v1/projects/demo-roomsync/databases/(default)/documents/${path}`;
async function records(hid, kind) {
  let pageToken; const documents = [];
  do {
    const url = new URL(documentUrl(`households/${hid}/${kind}`)); url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { Authorization: 'Bearer owner' } });
    expect(response.ok).toBe(true); const result = await response.json();
    documents.push(...(result.documents || [])); pageToken = result.nextPageToken;
  } while (pageToken);
  return documents;
}
async function seed(path, fields) {
  const response = await fetch(documentUrl(path), { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) }); expect(response.ok).toBe(true);
}
async function setup(page, people = 3) {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Alice Watson');
  await page.getByLabel('Email', { exact: true }).fill(`batch-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD); await page.getByLabel('Confirm', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible();
  const uid = await page.evaluate(async () => (await import('/src/firebase.js')).auth.currentUser.uid);
  await page.getByLabel('Household name').fill('Batch Household'); await page.locator('form').getByRole('button', { name: 'Create household', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Batch Household', exact: true })).toBeVisible();
  const hid = await page.evaluate(() => localStorage.getItem('roomsync.activeHousehold'));
  const memberIds = [uid];
  for (let i = 1; i < people; i++) {
    const id = i === 1 ? 'rahul' : i === 2 ? 'priya' : `member-${i}`; memberIds.push(id);
    await seed(`households/${hid}/members/${id}`, { uid: { stringValue: id }, householdId: { stringValue: hid }, displayName: { stringValue: i === 1 ? 'Rahul Sharma' : i === 2 ? 'Priya Patel' : `Member ${i}` }, role: { stringValue: 'member' } });
  }
  await page.goto('/expenses');
  await expect(page.getByRole('button', { name: 'AI Quick Add', exact: true })).toBeEnabled();
  return { uid, hid, memberIds, errors };
}
async function start(page, text, defaults = true) {
  await page.getByRole('button', { name: 'AI Quick Add', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: 'AI Quick Add', exact: true });
  await expect(prompt.getByText('No AI provider is configured.', { exact: true })).toBeVisible();
  await prompt.getByLabel('Describe your expenses').fill(text);
  if (defaults) await prompt.getByRole('checkbox', { name: 'Use equal split across current members when no split is stated', exact: true }).check();
  await prompt.getByRole('button', { name: 'Parse expenses', exact: true }).click();
}
const step = (page, i, total) => page.getByRole('dialog', { name: `Expense ${i} of ${total}`, exact: true });
async function reviewAll(page, total) {
  for (let i = 1; i <= total; i++) await step(page, i, total).getByRole('button', { name: i === total ? 'Review all expenses' : 'Next expense', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm expense batch', exact: true })).toBeVisible();
}
const example = 'I paid 2500 for groceries, 300 for electricity, and 800 for dinner yesterday.';

test('three expenses are isolated step drafts; final Add All atomically persists normal schema/events/notifications', async ({ page }) => {
  const { hid, uid, errors } = await setup(page);
  const external = []; page.on('request', (request) => { if (/^https?:/.test(request.url()) && !['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)) external.push(request.url()); });
  await start(page, example);
  await expect(step(page, 1, 3)).toBeVisible();
  await page.screenshot({ path: 'artifacts/tests/batch-step-desktop.png', fullPage: true, animations: 'disabled' });
  for (const [i, amount, title] of [[1, '2500.00', 'groceries'], [2, '300.00', 'electricity'], [3, '800.00', 'dinner']]) {
    const modal = step(page, i, 3); await expect(input(modal, 'Amount (₹)')).toHaveValue(amount); await expect(input(modal, 'Title')).toHaveValue(title);
    await expect(input(modal, 'Paid by')).toHaveValue(uid);
    expect(await records(hid, 'expenses')).toHaveLength(0); expect(await records(hid, 'activity')).toHaveLength(0);
    await modal.getByRole('button', { name: i === 3 ? 'Review all expenses' : 'Next expense', exact: true }).click();
  }
  const summary = page.getByRole('dialog', { name: 'Confirm expense batch', exact: true });
  await page.screenshot({ path: 'artifacts/tests/batch-summary-desktop.png', fullPage: true, animations: 'disabled' });
  await expect(summary).toContainText('₹3,600.00'); await expect(summary).toContainText('Food & dining');
  expect(await records(hid, 'expenses')).toHaveLength(0);
  await summary.getByRole('button', { name: 'Add All Expenses', exact: true }).click({ clickCount: 2 });
  await expect(page.getByRole('dialog', { name: 'Expenses added', exact: true })).toContainText('All 3 expenses were saved.', { timeout: 15000 });
  const all = await records(hid, 'expenses'); expect(all).toHaveLength(3);
  for (const document of all) {
    const fields = document.fields;
    expect(fields.createdBy.stringValue).toBe(uid); expect(fields.batchId.stringValue).toBeTruthy();
    expect(fields.batchFingerprint.stringValue).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(fields.shares.mapValue.fields).reduce((sum, amount) => sum + Number(amount.integerValue), 0)).toBe(Number(fields.totalPaise.integerValue));
  }
  expect(await records(hid, 'activity')).toHaveLength(3); expect(await records(hid, 'notifications')).toHaveLength(6);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload(); await expect(page.getByText('groceries', { exact: true })).toBeVisible();
  await page.goto('/reports'); await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('previous edits, skipping, restoring/removing and final cancellation preserve drafts but never save', async ({ page }) => {
  const { hid } = await setup(page); await start(page, example);
  await input(step(page, 1, 3), 'Title').fill('Fresh groceries');
  await step(page, 1, 3).getByRole('button', { name: 'Next expense', exact: true }).click();
  await step(page, 2, 3).getByRole('button', { name: 'Previous expense', exact: true }).click();
  await expect(input(step(page, 1, 3), 'Title')).toHaveValue('Fresh groceries');
  await input(step(page, 1, 3), 'Amount (₹)').fill('2600');
  await step(page, 1, 3).getByRole('button', { name: 'Next expense', exact: true }).click();
  await step(page, 2, 3).getByRole('button', { name: 'Next expense', exact: true }).click();
  await step(page, 3, 3).getByRole('button', { name: 'Skip expense', exact: true }).click();
  let summary = page.getByRole('dialog', { name: 'Confirm expense batch', exact: true });
  await expect(summary).toContainText('2 included / 1 skipped'); await expect(summary).toContainText('₹2,900.00');
  await summary.getByRole('button', { name: 'Restore / edit', exact: true }).click();
  await step(page, 3, 3).getByRole('button', { name: 'Remove expense', exact: true }).click();
  summary = page.getByRole('dialog', { name: 'Confirm expense batch', exact: true });
  await expect(summary).toContainText('2 included / 0 skipped');
  expect(await records(hid, 'expenses')).toHaveLength(0);
  await summary.getByRole('button', { name: 'Cancel batch', exact: true }).click();
  await page.getByRole('dialog', { name: 'Discard unsaved expense drafts?', exact: true }).getByRole('button', { name: 'Keep reviewing', exact: true }).click();
  await expect(summary).toBeVisible();
  await summary.getByRole('button', { name: 'Cancel batch', exact: true }).click();
  await page.getByRole('button', { name: 'Discard drafts', exact: true }).click();
  expect(await records(hid, 'expenses')).toHaveLength(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('roomsync.confirmed-expense-batch:')).length)).toBe(0);
});

test('missing details, ambiguous people and custom shares must be corrected in each form', async ({ page }) => {
  const { hid, uid } = await setup(page);
  await start(page, 'Groceries ₹2500; Sam paid for electricity next Monday.', false);
  const first = step(page, 1, 2);
  await expect(input(first, 'Paid by')).toHaveValue(''); await expect(input(first, 'Date')).toHaveValue('');
  await expect(first.locator('.segmented button.active')).toHaveCount(0);
  await first.getByRole('button', { name: 'Next expense', exact: true }).click(); await expect(first).toBeVisible();
  await input(first, 'Date').fill('2026-10-14'); await input(first, 'Paid by').selectOption(uid);
  await first.getByRole('checkbox', { name: /Alice Watson/ }).check(); await first.getByRole('button', { name: 'Equal', exact: true }).click();
  await first.getByRole('button', { name: 'Next expense', exact: true }).click();
  const second = step(page, 2, 2);
  await expect(input(second, 'Amount (₹)')).toHaveValue(''); await expect(input(second, 'Paid by')).toHaveValue(''); await expect(input(second, 'Date')).toHaveValue('');
  await input(second, 'Amount (₹)').fill('300.01'); await input(second, 'Paid by').selectOption('rahul'); await input(second, 'Date').fill('2026-10-15');
  await second.getByRole('checkbox', { name: /Alice Watson/ }).check(); await second.getByRole('checkbox', { name: /Rahul Sharma/ }).check();
  await second.getByRole('button', { name: 'Amounts', exact: true }).click();
  await second.locator('input[inputmode="decimal"]').nth(1).fill('100'); await second.locator('input[inputmode="decimal"]').nth(2).fill('100');
  await second.getByRole('button', { name: 'Review all expenses', exact: true }).click();
  await expect(second.locator('.error-text')).toContainText('add up'); expect(await records(hid, 'expenses')).toHaveLength(0);
  await second.locator('input[inputmode="decimal"]').nth(2).fill('200.01');
  await second.getByRole('button', { name: 'Review all expenses', exact: true }).click();
  await page.getByRole('button', { name: 'Add All Expenses', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Expenses added', exact: true })).toBeVisible();
  const saved = await records(hid, 'expenses'); expect(saved).toHaveLength(2);
  expect(saved.find((e) => e.fields.category.stringValue === 'Electricity').fields.shares.mapValue.fields.rahul.integerValue).toBe('20001');
});

test('lost acknowledgement keeps immutable retry identity; reload and retry do not duplicate records or activity', async ({ page }) => {
  // Test-only module wrapper models a server commit whose success response is
  // lost after application. Production source has no fake failure branch.
  await page.route('**/src/services/expenseBatches.js', async (route) => {
    const response = await route.fetch(); const source = await response.text();
    await route.fulfill({ response, body: source.replace('export async function saveExpenseBatch(request)', 'async function internalSaveExpenseBatch(request)') + '\nexport async function saveExpenseBatch(request) { const result = await internalSaveExpenseBatch(request); if (!globalThis.__batchAckLost) { globalThis.__batchAckLost = true; throw new Error("Simulated lost acknowledgement"); } return result; }\n' });
  });
  const { hid } = await setup(page); await start(page, example); await reviewAll(page, 3);
  await page.getByRole('button', { name: 'Add All Expenses', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmed batch status', exact: true })).toContainText('Simulated lost acknowledgement');
  expect(await records(hid, 'expenses')).toHaveLength(3); expect(await records(hid, 'activity')).toHaveLength(3);
  const before = (await records(hid, 'expenses')).map((d) => d.name).sort();
  await page.reload(); await page.getByRole('button', { name: 'AI Quick Add', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmed batch status', exact: true })).toBeVisible();
  // Retry sends precisely the confirmed IDs. The new wrapper again loses its
  // response, then Check reads existing docs and acknowledges the full commit.
  await page.getByRole('button', { name: 'Retry Add All Expenses', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Simulated lost acknowledgement');
  await page.getByRole('button', { name: 'Check saved status', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Expenses added', exact: true })).toContainText('All 3 expenses were saved');
  expect((await records(hid, 'expenses')).map((d) => d.name).sort()).toEqual(before);
  expect(await records(hid, 'activity')).toHaveLength(3); expect(await records(hid, 'notifications')).toHaveLength(6);
});

test('a removed member rejects the entire batch; restored membership permits safe same-ID retry', async ({ page }) => {
  const { hid } = await setup(page); await start(page, example); await reviewAll(page, 3);
  const deleted = await fetch(documentUrl(`households/${hid}/members/rahul`), { method: 'DELETE', headers: { Authorization: 'Bearer owner' } }); expect(deleted.ok).toBe(true);
  // Invoke the service with the SAME reviewed inputs when membership changed,
  // also testing that the final client cannot bypass server membership checks.
  const outcome = await page.evaluate(async (hid) => {
    const { prepareExpenseBatch, saveExpenseBatch } = await import('/src/services/expenseBatches.js');
    const { auth } = await import('/src/firebase.js');
    const items = [10000, 20000, 30000].map((totalPaise) => ({ id: crypto.randomUUID(), input: { title: 'Atomic membership test', date: '2026-10-15', category: 'Other', totalPaise, payers: { [auth.currentUser.uid]: totalPaise }, participants: [auth.currentUser.uid, 'rahul'], splitMethod: 'equal' } }));
    const request = await prepareExpenseBatch(hid, crypto.randomUUID(), items);
    globalThis.__confirmedMemberTest = request;
    try { await saveExpenseBatch(request); return 'unexpected-success'; } catch (error) { return error.code; }
  }, hid);
  expect(outcome).toBe('membership-changed');
  expect(await records(hid, 'expenses')).toHaveLength(0); expect(await records(hid, 'activity')).toHaveLength(0);
  await seed(`households/${hid}/members/rahul`, { uid: { stringValue: 'rahul' }, householdId: { stringValue: hid }, displayName: { stringValue: 'Rahul Sharma' }, role: { stringValue: 'member' } });
  await page.evaluate(async () => { const { saveExpenseBatch } = await import('/src/services/expenseBatches.js'); await saveExpenseBatch(globalThis.__confirmedMemberTest); });
  expect(await records(hid, 'expenses')).toHaveLength(3);
});

test('concurrent retries at 8 expenses/8 members and partial conflicts are safe under existing rules', async ({ page }) => {
  const { hid, uid, memberIds } = await setup(page, 8);
  const results = await page.evaluate(async ({ hid, uid, memberIds }) => {
    const { prepareExpenseBatch, saveExpenseBatch } = await import('/src/services/expenseBatches.js');
    const entries = Array.from({ length: 8 }, (_, index) => ({ id: crypto.randomUUID(), input: { title: `Max-items ${index}`, date: '2026-10-15', category: 'Other', totalPaise: 80000, payers: { [uid]: 80000 }, participants: memberIds, splitMethod: 'equal' } }));
    const request = await prepareExpenseBatch(hid, crypto.randomUUID(), entries); globalThis.__worstRequest = request;
    const [first, second] = await Promise.all([saveExpenseBatch(request), saveExpenseBatch(request)]);
    return { first, second };
  }, { hid, uid, memberIds });
  expect(results.first.ids.sort()).toEqual(results.second.ids.sort());
  expect(await records(hid, 'expenses')).toHaveLength(8); expect(await records(hid, 'activity')).toHaveLength(8); expect(await records(hid, 'notifications')).toHaveLength(56);
  const badPayload = await page.evaluate(async () => {
    const { saveExpenseBatch } = await import('/src/services/expenseBatches.js');
    const copy = structuredClone(globalThis.__worstRequest); copy.items[0].input.title = 'Mutated after confirmation';
    try { await saveExpenseBatch(copy); return 'unexpected'; } catch (error) { return error.message; }
  });
  expect(badPayload).toContain('payload changed');
  // Delete one generated demo record with emulator admin only to simulate an
  // externally damaged batch. The service must NOT fill in a partial batch.
  const one = (await records(hid, 'expenses'))[0].name.split('/documents/')[1];
  await fetch(documentUrl(one), { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  const conflict = await page.evaluate(async () => {
    const { saveExpenseBatch, checkExpenseBatch } = await import('/src/services/expenseBatches.js');
    let code; try { await saveExpenseBatch(globalThis.__worstRequest); } catch (error) { code = error.code; }
    return { code, status: await checkExpenseBatch(globalThis.__worstRequest) };
  });
  expect(conflict.code).toBe('batch-conflict'); expect(conflict.status.state).toBe('conflict'); expect(conflict.status.ids).toHaveLength(7);
  expect(await records(hid, 'expenses')).toHaveLength(7); expect(await records(hid, 'activity')).toHaveLength(8);
});

test('duplicate-looking expenses require acknowledgement, mobile review is usable and normal manual add remains', async ({ page }) => {
  const { hid } = await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  await start(page, 'I paid 100 for groceries yesterday; I paid 100 for groceries yesterday'); await reviewAll(page, 2);
  const summary = page.getByRole('dialog', { name: 'Confirm expense batch', exact: true });
  await expect(summary.getByRole('button', { name: 'Add All Expenses', exact: true })).toBeDisabled();
  await summary.getByRole('checkbox', { name: /Some included expenses look identical/ }).check();
  await expect(summary.getByRole('button', { name: 'Add All Expenses', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'artifacts/tests/batch-final-mobile.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await summary.getByRole('button', { name: 'Cancel batch', exact: true }).click(); await page.getByRole('button', { name: 'Discard drafts', exact: true }).click();
  await page.getByRole('button', { name: '+ Add expense', exact: true }).click();
  const manual = page.getByRole('dialog', { name: 'Add expense', exact: true });
  await input(manual, 'Title').fill('Manual still works'); await input(manual, 'Amount (₹)').fill('55');
  await manual.getByRole('button', { name: 'Save expense', exact: true }).click(); await expect(manual).toHaveCount(0);
  expect(await records(hid, 'expenses')).toHaveLength(1);
});

test('batch identities are household-scoped and cross-household participants cannot submit', async ({ page }) => {
  const { hid, uid } = await setup(page);
  await start(page, example); await step(page, 1, 3).getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Discard drafts', exact: true }).click();
  const result = await page.evaluate(async ({ hid, uid }) => {
    const { createHousehold } = await import('/src/services/households.js');
    const { prepareExpenseBatch, saveExpenseBatch } = await import('/src/services/expenseBatches.js');
    const second = await createHousehold({ name: 'Isolated batch household' });
    const entries = [{ id: crypto.randomUUID(), input: { title: 'Scoped expense', date: '2026-10-15', category: 'Other', totalPaise: 10000, payers: { [uid]: 10000 }, participants: [uid, 'rahul'], splitMethod: 'equal' } }];
    const first = await prepareExpenseBatch(hid, crypto.randomUUID(), entries);
    let tamper, nonmember;
    try { await saveExpenseBatch({ ...first, householdId: second }); } catch (error) { tamper = error.message; }
    const wrongMembers = await prepareExpenseBatch(second, crypto.randomUUID(), entries);
    try { await saveExpenseBatch(wrongMembers); } catch (error) { nonmember = error.code; }
    return { second, tamper, nonmember };
  }, { hid, uid });
  expect(result.tamper).toContain('payload changed'); expect(result.nonmember).toBe('membership-changed');
  expect(await records(hid, 'expenses')).toHaveLength(0); expect(await records(result.second, 'expenses')).toHaveLength(0);
});

test('distinct explicit payers, calendar dates, percentage and share splits persist in the same atomic batch', async ({ page }) => {
  const { hid, uid } = await setup(page);
  await start(page, 'I paid 1000 for food on 2026-10-14 split percentages: me 60%, Rahul 40%; Rahul paid 900 for taxi on 2026-10-15 split 2:1 between Rahul and me.', false);
  const first = step(page, 1, 2);
  await expect(input(first, 'Paid by')).toHaveValue(uid); await expect(input(first, 'Date')).toHaveValue('2026-10-14');
  await expect(first.getByRole('button', { name: 'Percent', exact: true })).toHaveClass(/active/);
  await first.getByRole('button', { name: 'Next expense', exact: true }).click();
  const second = step(page, 2, 2);
  await expect(input(second, 'Paid by')).toHaveValue('rahul'); await expect(input(second, 'Date')).toHaveValue('2026-10-15');
  await expect(second.getByRole('button', { name: 'Shares', exact: true })).toHaveClass(/active/);
  await second.getByRole('button', { name: 'Review all expenses', exact: true }).click();
  expect(await records(hid, 'expenses')).toHaveLength(0);
  await page.getByRole('button', { name: 'Add All Expenses', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Expenses added', exact: true })).toBeVisible();
  const saved = await records(hid, 'expenses'); expect(saved).toHaveLength(2);
  const food = saved.find((doc) => doc.fields.title.stringValue === 'food').fields;
  const taxi = saved.find((doc) => doc.fields.title.stringValue === 'taxi').fields;
  expect(food.payers.mapValue.fields[uid].integerValue).toBe('100000'); expect(food.shares.mapValue.fields.rahul.integerValue).toBe('40000');
  expect(taxi.payers.mapValue.fields.rahul.integerValue).toBe('90000'); expect(taxi.shares.mapValue.fields[uid].integerValue).toBe('30000');
});
