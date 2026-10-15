import { test, expect } from '@playwright/test';
const PASSWORD = 'test-accounts-only-123';
const input = (root, label) => root.locator('label').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).locator('..').locator('input,select,textarea').first();
const url = (path) => `http://127.0.0.1:8089/v1/projects/demo-roomsync/databases/(default)/documents/${path}`;
async function document(path) {
  const response = await fetch(url(path), { headers: { Authorization: 'Bearer owner' } });
  expect(response.ok).toBe(true);
  return response.json();
}
async function seedDocument(path, fields) {
  const response = await fetch(url(path), { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  expect(response.ok).toBe(true);
}
async function register(page, name) {
  const email = `avatar-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible();
  const uid = await page.evaluate(async () => (await import('/src/firebase.js')).auth.currentUser.uid);
  return { uid, email };
}
async function createHousehold(page, name = 'Avatar Household') {
  await page.getByLabel('Household name').fill(name);
  await page.locator('form').getByRole('button', { name: 'Create household', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return page.evaluate(() => localStorage.getItem('roomsync.activeHousehold'));
}
function observeRequests(page) {
  const storageRequests = [];
  const errors = [];
  page.on('request', (request) => { if (/firebasestorage|storage\.googleapis|storage\.firebase|127\.0\.0\.1:9199/.test(request.url())) storageRequests.push(request.url()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return { storageRequests, errors };
}
async function expectAvatar(page, selector, style, color, initials) {
  const avatar = page.locator(selector).first();
  await expect(avatar).toHaveAttribute('data-avatar-style', style);
  await expect(avatar).toHaveAttribute('data-avatar-color', color);
  await expect(avatar).toHaveText(initials);
}

test('register/login, profile preferences persist across existing and newly created households without Storage', async ({ page }) => {
  const { storageRequests, errors } = observeRequests(page);
  const account = await register(page, 'Alice Watson');
  const registered = await document(`users/${account.uid}`);
  expect(registered.fields.avatarStyle.stringValue).toBe('circle');
  expect(registered.fields.avatarColor.stringValue).toBeTruthy();
  const hid = await createHousehold(page);
  await page.goto('/settings');
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ring avatar style', exact: true }).click();
  await page.getByRole('button', { name: 'Violet avatar color', exact: true }).click();
  await input(page, 'Display name').fill('Alice Winters');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Profile updated');
  await expectAvatar(page, '.sidebar .avatar', 'ring', 'violet', 'AW');
  expect((await document(`users/${account.uid}`)).fields.avatarColor.stringValue).toBe('violet');
  const membership = await document(`households/${hid}/members/${account.uid}`);
  expect(membership.fields.avatarStyle.stringValue).toBe('ring');
  expect(membership.fields.role.stringValue).toBe('owner');
  for (const route of ['/members', '/balances']) {
    await page.goto(route);
    await expectAvatar(page, `main .avatar[data-avatar-uid="${account.uid}"]`, 'ring', 'violet', 'AW');
  }
  await page.goto('/expenses');
  await page.getByRole('button', { name: '+ Add expense', exact: true }).click();
  await expectAvatar(page, '.modal .avatar', 'ring', 'violet', 'AW');
  await expect(page.locator('.modal input[type="file"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto('/onboarding'); await createHousehold(page, 'Second Avatar Household');
  await page.goto('/members');
  await expectAvatar(page, 'main .avatar', 'ring', 'violet', 'AW');
  await page.reload(); await expectAvatar(page, '.sidebar .avatar', 'ring', 'violet', 'AW');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expectAvatar(page, '.sidebar .avatar', 'ring', 'violet', 'AW');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Rounded avatar style', exact: true }).click();
  await page.getByRole('button', { name: 'Teal avatar color', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Profile updated');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Rounded avatar style', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Teal avatar color', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/tests/avatar-settings-mobile.png', fullPage: true });
  expect(storageRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('legacy profiles get generated defaults without a migration; saving merges only selected fields', async ({ page }) => {
  const { storageRequests, errors } = observeRequests(page);
  const account = await register(page, 'Legacy User');
  const profile = await document(`users/${account.uid}`);
  delete profile.fields.avatarStyle; delete profile.fields.avatarColor;
  profile.fields.photoURL = { stringValue: 'https://firebasestorage.googleapis.com/legacy-never-requested' };
  profile.fields.existingPreference = { stringValue: 'preserve-me' };
  await seedDocument(`users/${account.uid}`, profile.fields);
  await page.goto('/account');
  await expect(page.locator('.avatar-lg')).toHaveText('LU');
  await expect(page.locator('.avatar-lg')).toHaveAttribute('data-avatar-style', 'circle');
  await expect(page.locator('img')).toHaveCount(0);
  expect((await document(`users/${account.uid}`)).fields).toEqual(profile.fields);
  await page.getByRole('button', { name: 'Rounded avatar style', exact: true }).click();
  await page.getByRole('button', { name: 'Rose avatar color', exact: true }).click();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Profile updated');
  const saved = await document(`users/${account.uid}`);
  for (const key of ['photoURL', 'existingPreference', 'createdAt']) expect(saved.fields[key]).toEqual(profile.fields[key]);
  expect(saved.fields.avatarStyle.stringValue).toBe('rounded');
  await page.goto('/onboarding');
  const hid = await createHousehold(page, 'Legacy Avatar Household');
  await page.goto('/members');
  await expectAvatar(page, 'main .avatar', 'rounded', 'rose', 'LU');
  expect((await document(`households/${hid}/members/${account.uid}`)).fields.role.stringValue).toBe('owner');
  // Also exercise an old account that has no Firestore profile document at all:
  const emptyAccount = await register(page, 'Missing Profile');
  const response = await fetch(url(`users/${emptyAccount.uid}`), { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  expect(response.ok).toBe(true);
  await page.goto('/account');
  await expect(page.locator('.avatar-lg')).toHaveText('MP');
  await expect(page.locator('.avatar-lg')).toHaveAttribute('data-avatar-style', 'circle');
  expect(storageRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('portal modal covers the viewport over the sidebar on desktop and mobile; focus, scroll and escape work', async ({ page }) => {
  await register(page, 'Modal User'); await createHousehold(page, 'Modal Household');
  await page.goto('/expenses');
  const trigger = page.getByRole('button', { name: '+ Add expense', exact: true });
  await trigger.click();
  const overlay = page.locator('body > .modal-overlay');
  const dialog = page.getByRole('dialog', { name: 'Add expense', exact: true });
  await expect(dialog).toBeVisible();
  const checkCoverage = async () => {
    const bounds = await overlay.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds.x).toBe(0); expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(viewport.width); expect(bounds.height).toBe(viewport.height);
    expect(await page.evaluate(() => document.elementFromPoint(5, 5).classList.contains('modal-overlay'))).toBe(true);
  };
  await checkCoverage();
  expect(await page.locator('body').evaluate((el) => el.style.overflow)).toBe('hidden');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Save expense', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.screenshot({ path: 'artifacts/tests/modal-full-viewport-desktop.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  expect(await page.locator('body').evaluate((el) => el.style.overflow)).not.toBe('hidden');
  await trigger.click(); await page.mouse.click(5, 5); await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 650 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await trigger.click(); await expect(dialog).toBeVisible(); await checkCoverage();
  const dialogBounds = await dialog.boundingBox();
  expect(dialogBounds.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(390);
  expect(dialogBounds.height).toBeLessThanOrEqual(650);
  await dialog.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(dialog.getByRole('heading', { name: 'Add expense', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Save expense', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'artifacts/tests/modal-full-viewport-mobile.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});
