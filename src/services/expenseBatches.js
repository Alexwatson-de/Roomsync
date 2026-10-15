// All confirmed expenses + activity + notifications commit atomically. Stable
// deterministic expense IDs and a payload fingerprint make concurrent/delayed
// retries safe even when an acknowledgement is lost. No new collection/rules.
import { runTransaction } from 'firebase/firestore';
import { db, currentUser, memberAccess, recordRef } from './cloudStore.js';
import { writeExpense } from './expenses.js';
import { buildExpenseData } from '../lib/expenseData.js';
import { batchDocumentId, batchFingerprint, MAX_BATCH_EXPENSES } from '../lib/expenseBatch.js';

export async function prepareExpenseBatch(hid, batchId, entries) {
  const user = currentUser();
  if (!hid || !Array.isArray(entries) || !entries.length || entries.length > MAX_BATCH_EXPENSES) throw new Error('Confirm between 1 and 8 valid expenses.');
  if (new Set(entries.map((item) => item.id)).size !== entries.length) throw new Error('Batch contains duplicate item IDs.');
  const items = entries.map(({ id, input }) => ({ id, documentId: batchDocumentId(batchId, id), input: buildExpenseData(input) }));
  const people = [...new Set(items.flatMap(({ input }) => [...input.participants, ...input.payerIds]))];
  // Keep the whole atomic request within the existing Rules access-call budget.
  if (people.length > 8) throw new Error('An atomic batch supports up to 8 distinct members. Split it into smaller batches.');
  const fingerprint = await batchFingerprint({ householdId: hid, uid: user.uid, items });
  return { householdId: hid, uid: user.uid, batchId, fingerprint, items, people };
}

async function verifiedRequest(request) {
  if (!request || currentUser().uid !== request.uid) throw new Error('Account changed. Return to Expenses and review a new batch.');
  const clean = await prepareExpenseBatch(request.householdId, request.batchId, request.items);
  if (clean.fingerprint !== request.fingerprint) throw new Error('The confirmed payload changed. Do not reuse this submission.');
  return clean;
}
function inventory(snapshots, request) {
  const existing = snapshots.filter((snapshot) => snapshot.exists());
  const matching = existing.every((snapshot) => snapshot.data().createdBy === request.uid && snapshot.data().batchId === request.batchId && snapshot.data().batchFingerprint === request.fingerprint);
  return { existing, matching, all: existing.length === request.items.length, none: existing.length === 0 };
}
export async function saveExpenseBatch(request) {
  const safe = await verifiedRequest(request);
  try {
    return await runTransaction(db, async (tx) => {
      const { user } = await memberAccess(safe.householdId, tx);
      if (user.uid !== safe.uid) throw Object.assign(new Error('Account changed. This batch was not submitted.'), { code: 'unauthenticated' });
      const snapshots = [];
      for (const item of safe.items) snapshots.push(await tx.get(recordRef(safe.householdId, 'expenses', item.documentId)));
      const status = inventory(snapshots, safe);
      if (status.all && status.matching) return { state: 'saved', alreadySaved: true, ids: snapshots.map((snapshot) => snapshot.id) };
      if (!status.none) throw Object.assign(new Error('Some target records already exist or differ. No new records were written. Check the saved-item status before proceeding; this batch will not be partially recreated.'), { code: 'batch-conflict' });
      // All required reads happen before writes. Revalidate every referenced
      // member in THIS household; stale/cross-household drafts cannot submit.
      for (const uid of safe.people) {
        if (uid === user.uid) continue;
        if (!(await tx.get(recordRef(safe.householdId, 'members', uid))).exists()) throw Object.assign(new Error('A payer or participant left this household. No expenses were written; membership must be resolved before retrying this confirmed batch.'), { code: 'membership-changed' });
      }
      for (const item of safe.items) writeExpense(tx, safe.householdId, user, item.documentId, item.input, { batchId: safe.batchId, batchFingerprint: safe.fingerprint });
      return { state: 'saved', alreadySaved: false, ids: safe.items.map((item) => item.documentId) };
    }, { maxAttempts: 5 });
  } catch (error) {
    // Concurrent identical commits can hit immutable activity rules before
    // Firestore reports a transaction conflict. Verify the ENTIRE exact batch
    // after any failure: another caller may already have committed it safely.
    try {
      const status = await checkExpenseBatch(safe);
      if (status.state === 'saved') return { ...status, alreadySaved: true };
    } catch { /* No verified result: retain the original error, never assume. */ }
    // Atomic transactions cannot write a subset. A network/timeout error can
    // still hide a successful commit; retain the exact request and verify or
    // retry its IDs, never generate replacements or claim an unknown success.
    error.batchOutcome = ['permission-denied', 'unauthenticated', 'membership-changed', 'batch-conflict', 'invalid-argument', 'failed-precondition'].includes(error.code) ? 'not-written-by-this-attempt' : 'unknown';
    throw error;
  }
}
export async function checkExpenseBatch(request) {
  const safe = await verifiedRequest(request);
  return runTransaction(db, async (tx) => {
    await memberAccess(safe.householdId, tx);
    const snapshots = [];
    for (const item of safe.items) snapshots.push(await tx.get(recordRef(safe.householdId, 'expenses', item.documentId)));
    const status = inventory(snapshots, safe);
    return { state: status.none ? 'none' : status.all && status.matching ? 'saved' : 'conflict', ids: status.existing.map((snapshot) => snapshot.id), matching: status.matching };
  });
}
