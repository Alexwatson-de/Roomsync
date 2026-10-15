// Isolated emulator verification, never the live bucket.
import { beforeAll, afterAll, beforeEach, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
let env;
const bytes = new Uint8Array([137, 80, 78, 71]);
const image = { contentType: 'image/png' };
const storage = (uid) => uid ? env.authenticatedContext(uid).storage() : env.unauthenticatedContext().storage();
const receipt = (uid, id = 'r1') => ref(storage(uid), `households/h1/receipts/alice/${id}`);
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-roomsync-storage-tests', firestore: { rules: readFileSync('firestore.rules', 'utf8') }, storage: { rules: readFileSync('storage.rules', 'utf8') } });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    // rules-unit-testing clearStorage() removes only root items, not nested
    // prefixes. Clear this isolated emulator bucket recursively between tests.
    const clear = async (directory) => {
      const { items, prefixes } = await directory.listAll();
      await Promise.all(items.map((item) => item.delete()));
      await Promise.all(prefixes.map(clear));
    };
    await clear(context.storage().ref());
    for (const uid of ['alice', 'bob']) await setDoc(doc(context.firestore(), 'households', 'h1', 'members', uid), { uid, householdId: 'h1', role: uid === 'alice' ? 'owner' : 'member' });
  });
});
it('allows a signed-in user to upload and update their own avatar', async () => {
  const target = ref(storage('alice'), 'users/alice/avatar');
  await assertSucceeds(uploadBytes(target, bytes, image));
  await assertSucceeds(uploadBytes(target, bytes, { contentType: 'image/webp' }));
});
it('rejects unauthenticated avatar uploads', async () => {
  await assertFails(uploadBytes(ref(storage(null), 'users/alice/avatar'), bytes, image));
});
it('rejects another user replacing an avatar', async () => {
  await assertFails(uploadBytes(ref(storage('bob'), 'users/alice/avatar'), bytes, image));
});
it('allows only household members to read a stored receipt', async () => {
  await assertSucceeds(uploadBytes(receipt('alice'), bytes, image));
  await assertSucceeds(getBytes(receipt('bob')));
  await assertFails(getBytes(receipt('eve')));
  await assertFails(getBytes(receipt(null)));
});
it('rejects a nonmember receipt upload', async () => {
  await assertFails(uploadBytes(ref(storage('eve'), 'households/h1/receipts/eve/r1'), bytes, image));
});
it('rejects uploading to another member\'s receipt directory', async () => {
  await assertFails(uploadBytes(receipt('bob'), bytes, image));
});
it('rejects unsafe MIME types, including SVG', async () => {
  await assertFails(uploadBytes(receipt('alice'), bytes, { contentType: 'image/svg+xml' }));
  await assertFails(uploadBytes(receipt('alice'), bytes, { contentType: 'application/javascript' }));
});
it('rejects images larger than 5 MB', async () => {
  await assertFails(uploadBytes(receipt('alice'), new Uint8Array(5 * 1024 * 1024 + 1), image));
});
it('prevents replacing a receipt once it is stored', async () => {
  await assertSucceeds(uploadBytes(receipt('alice'), bytes, image));
  await assertFails(uploadBytes(receipt('alice'), new Uint8Array([1, 2, 3, 4, 5]), image));
});
it('only the uploader can delete their own receipt', async () => {
  await assertSucceeds(uploadBytes(receipt('alice'), bytes, image));
  await assertFails(deleteObject(receipt('bob')));
  await assertSucceeds(deleteObject(receipt('alice')));
});
it('denies arbitrary Storage paths even for household members', async () => {
  await assertFails(uploadBytes(ref(storage('alice'), 'households/h1/random-file'), bytes, image));
  await assertFails(uploadBytes(ref(storage('alice'), 'public/random-file'), bytes, image));
});
