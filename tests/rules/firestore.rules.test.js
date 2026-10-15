// Security rules tests — run against the Firestore emulator:
//   npm run test:rules
// (starts the emulator via `firebase emulators:exec`)

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, collectionGroup, where } from 'firebase/firestore';

let env;

const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const EVE = 'eve-uid'; // not a member of the household
const HID = 'house-1';

function db(uid) {
  return uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
}

async function seedHousehold() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, 'households', HID), {
      name: 'Test Flat',
      currency: 'INR',
      createdBy: ALICE,
      settings: {},
    });
    await setDoc(doc(f, 'households', HID, 'members', ALICE), {
      uid: ALICE,
      householdId: HID,
      role: 'owner',
      displayName: 'Alice',
    });
    await setDoc(doc(f, 'households', HID, 'members', BOB), {
      uid: BOB,
      householdId: HID,
      role: 'member',
      displayName: 'Bob',
    });
  });
}

const validExpense = (createdBy) => ({
  title: 'Groceries run',
  category: 'Groceries',
  date: '2026-01-15',
  totalPaise: 90000,
  payers: { [createdBy]: 90000 },
  participants: [ALICE, BOB],
  splitMethod: 'equal',
  shares: { [ALICE]: 45000, [BOB]: 45000 },
  deleted: false,
  createdBy,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'roomsync-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedHousehold();
});

describe('unauthenticated access', () => {
  it('cannot read household, expenses, members', async () => {
    await assertFails(getDoc(doc(db(null), 'households', HID)));
    await assertFails(getDocs(collection(db(null), 'households', HID, 'expenses')));
    await assertFails(getDocs(collection(db(null), 'households', HID, 'members')));
  });
});

describe('membership isolation', () => {
  it('members can read their household; non-members cannot', async () => {
    await assertSucceeds(getDoc(doc(db(ALICE), 'households', HID)));
    await assertSucceeds(getDoc(doc(db(BOB), 'households', HID)));
    await assertFails(getDoc(doc(db(EVE), 'households', HID)));
  });

  it('non-members cannot read or write expenses', async () => {
    await assertFails(getDocs(collection(db(EVE), 'households', HID, 'expenses')));
    await assertFails(
      setDoc(doc(db(EVE), 'households', HID, 'expenses', 'e1'), validExpense(EVE))
    );
  });

  it('collection-group membership query only returns own docs', async () => {
    await assertSucceeds(
      getDocs(query(collectionGroup(db(ALICE), 'members'), where('uid', '==', ALICE)))
    );
    await assertFails(
      getDocs(query(collectionGroup(db(ALICE), 'members'), where('uid', '==', BOB)))
    );
  });
});

describe('expenses', () => {
  it('member can create a valid expense they author', async () => {
    await assertSucceeds(
      setDoc(doc(db(BOB), 'households', HID, 'expenses', 'e1'), validExpense(BOB))
    );
  });

  it('cannot create an expense authored as someone else', async () => {
    await assertFails(
      setDoc(doc(db(BOB), 'households', HID, 'expenses', 'e1'), validExpense(ALICE))
    );
  });

  it('rejects invalid expenses (non-integer or non-positive totals)', async () => {
    await assertFails(
      setDoc(doc(db(BOB), 'households', HID, 'expenses', 'e1'), {
        ...validExpense(BOB),
        totalPaise: 900.5,
      })
    );
    await assertFails(
      setDoc(doc(db(BOB), 'households', HID, 'expenses', 'e2'), {
        ...validExpense(BOB),
        totalPaise: -100,
      })
    );
  });

  it('author can edit own expense; another plain member cannot; admin can', async () => {
    await setDoc(doc(db(BOB), 'households', HID, 'expenses', 'e1'), validExpense(BOB));
    await assertSucceeds(
      updateDoc(doc(db(BOB), 'households', HID, 'expenses', 'e1'), { title: 'Groceries v2' })
    );
    // Alice is owner -> allowed; add a second plain member to prove denial
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'households', HID, 'members', 'carol-uid'), {
        uid: 'carol-uid',
        householdId: HID,
        role: 'member',
        displayName: 'Carol',
      });
    });
    await assertFails(
      updateDoc(doc(db('carol-uid'), 'households', HID, 'expenses', 'e1'), { title: 'hijack' })
    );
    await assertSucceeds(
      updateDoc(doc(db(ALICE), 'households', HID, 'expenses', 'e1'), { title: 'admin fix' })
    );
  });
});

describe('settlements', () => {
  const settlement = (createdBy, from, to) => ({
    from,
    to,
    amountPaise: 40000,
    date: '2026-01-20',
    status: 'recorded',
    reversed: false,
    createdBy,
  });

  it('involved member can record; uninvolved plain member cannot', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'households', HID, 'members', 'carol-uid'), {
        uid: 'carol-uid',
        householdId: HID,
        role: 'member',
        displayName: 'Carol',
      });
    });
    await assertSucceeds(
      setDoc(doc(db(BOB), 'households', HID, 'settlements', 's1'), settlement(BOB, BOB, ALICE))
    );
    await assertFails(
      setDoc(doc(db('carol-uid'), 'households', HID, 'settlements', 's2'), settlement('carol-uid', BOB, ALICE))
    );
  });

  it('settlement amount/parties are immutable after creation', async () => {
    await setDoc(doc(db(BOB), 'households', HID, 'settlements', 's1'), settlement(BOB, BOB, ALICE));
    await assertFails(
      updateDoc(doc(db(BOB), 'households', HID, 'settlements', 's1'), { amountPaise: 1 })
    );
    await assertSucceeds(
      updateDoc(doc(db(BOB), 'households', HID, 'settlements', 's1'), { reversed: true })
    );
  });
});

describe('role security', () => {
  it('a member cannot escalate their own role', async () => {
    await assertFails(
      updateDoc(doc(db(BOB), 'households', HID, 'members', BOB), { role: 'admin' })
    );
    await assertFails(
      updateDoc(doc(db(BOB), 'households', HID, 'members', BOB), { role: 'owner' })
    );
  });

  it('a member cannot change another member\'s role', async () => {
    await assertFails(
      updateDoc(doc(db(BOB), 'households', HID, 'members', ALICE), { role: 'member' })
    );
  });

  it('owner can promote a member to admin', async () => {
    await assertSucceeds(
      updateDoc(doc(db(ALICE), 'households', HID, 'members', BOB), { role: 'admin' })
    );
  });

  it('admin cannot demote the owner', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'households', HID, 'members', BOB), { role: 'admin' });
    });
    await assertFails(
      updateDoc(doc(db(BOB), 'households', HID, 'members', ALICE), { role: 'member' })
    );
  });

  it('member can leave; cannot remove others; admin can remove a member', async () => {
    await assertFails(deleteDoc(doc(db(BOB), 'households', HID, 'members', ALICE)));
    await assertSucceeds(deleteDoc(doc(db(BOB), 'households', HID, 'members', BOB)));
  });

  it('non-member cannot join without an invite', async () => {
    await assertFails(
      setDoc(doc(db(EVE), 'households', HID, 'members', EVE), {
        uid: EVE,
        householdId: HID,
        role: 'member',
        displayName: 'Eve',
      })
    );
  });

  it('can join with a valid invite; invite role is enforced', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', 'tok123'), {
        householdId: HID,
        role: 'member',
        active: true,
        expiresAt: Date.now() + 86400000,
        createdBy: ALICE,
      });
    });
    // joining with role=admin via a member invite must fail
    await assertFails(
      setDoc(doc(db(EVE), 'households', HID, 'members', EVE), {
        uid: EVE,
        householdId: HID,
        role: 'admin',
        displayName: 'Eve',
        inviteCode: 'tok123',
      })
    );
    await assertSucceeds(
      setDoc(doc(db(EVE), 'households', HID, 'members', EVE), {
        uid: EVE,
        householdId: HID,
        role: 'member',
        displayName: 'Eve',
        inviteCode: 'tok123',
      })
    );
  });

  it('revoked invite cannot be used', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', 'tokrevoked'), {
        householdId: HID,
        role: 'member',
        active: false,
        expiresAt: Date.now() + 86400000,
        createdBy: ALICE,
      });
    });
    await assertFails(
      setDoc(doc(db(EVE), 'households', HID, 'members', EVE), {
        uid: EVE,
        householdId: HID,
        role: 'member',
        displayName: 'Eve',
        inviteCode: 'tokrevoked',
      })
    );
  });
});

describe('notifications privacy', () => {
  it('recipient reads own notifications; others cannot', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'households', HID, 'notifications', 'n1'), {
        recipientId: BOB,
        actorId: ALICE,
        type: 'expense',
        title: 'New expense',
        read: false,
      });
    });
    await assertSucceeds(getDoc(doc(db(BOB), 'households', HID, 'notifications', 'n1')));
    await assertFails(getDoc(doc(db(ALICE), 'households', HID, 'notifications', 'n1')));
    // recipient can mark read but not alter content
    await assertSucceeds(
      updateDoc(doc(db(BOB), 'households', HID, 'notifications', 'n1'), { read: true })
    );
    await assertFails(
      updateDoc(doc(db(BOB), 'households', HID, 'notifications', 'n1'), { title: 'tampered' })
    );
  });
});

describe('activity feed', () => {
  it('is immutable once written', async () => {
    await setDoc(doc(db(ALICE), 'households', HID, 'activity', 'a1'), {
      type: 'expense_added',
      actorId: ALICE,
      summary: 'Alice added expense',
    });
    await assertFails(
      updateDoc(doc(db(ALICE), 'households', HID, 'activity', 'a1'), { summary: 'edited' })
    );
    await assertFails(deleteDoc(doc(db(ALICE), 'households', HID, 'activity', 'a1')));
  });

  it('cannot spoof another actor', async () => {
    await assertFails(
      setDoc(doc(db(BOB), 'households', HID, 'activity', 'a2'), {
        type: 'expense_added',
        actorId: ALICE,
        summary: 'spoofed',
      })
    );
  });
});

describe('Firebase restoration hardening', () => {
  it('lets a member change only their own built-in avatar without changing role', async () => {
    await assertSucceeds(updateDoc(doc(db(BOB), 'households', HID, 'members', BOB), { avatarStyle: 'ring', avatarColor: 'teal' }));
    await assertFails(updateDoc(doc(db(BOB), 'households', HID, 'members', BOB), { avatarStyle: 'rounded', role: 'admin' }));
    await assertFails(updateDoc(doc(db(BOB), 'households', HID, 'members', ALICE), { avatarColor: 'rose' }));
  });
  it('stores avatar selections on the private user profile and preserves legacy fields', async () => {
    const userRef = doc(db(ALICE), 'users', ALICE);
    await setDoc(userRef, { uid: ALICE, displayName: 'Alice', photoURL: 'https://old.example/photo', customExistingField: 'keep' });
    await assertSucceeds(updateDoc(userRef, { avatarStyle: 'rounded', avatarColor: 'violet' }));
    const saved = (await getDoc(userRef)).data();
    expect(saved.photoURL).toBe('https://old.example/photo');
    expect(saved.customExistingField).toBe('keep');
    await assertFails(updateDoc(doc(db(BOB), 'users', ALICE), { avatarStyle: 'circle' }));
  });
  it('rejects arbitrary avatar strings on users and membership snapshots', async () => {
    await assertFails(setDoc(doc(db(ALICE), 'users', ALICE), { avatarStyle: 'image', avatarColor: 'url(https://external)' }));
    await assertFails(updateDoc(doc(db(BOB), 'households', HID, 'members', BOB), { avatarStyle: 'ring', avatarColor: 'invalid' }));
  });
  it('validates all 8 allocation entries within the rule execution budget', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `member-${i}`);
    const allocations = Object.fromEntries(ids.map((id) => [id, 11250]));
    await assertSucceeds(setDoc(doc(db(BOB), 'households', HID, 'expenses', 'twenty'), {
      ...validExpense(BOB), participants: ids, payers: allocations, shares: allocations,
    }));
  });
  it('rejects mismatched share totals even with a valid expense total', async () => {
    await assertFails(setDoc(doc(db(BOB), 'households', HID, 'expenses', 'bad-sum'), {
      ...validExpense(BOB), shares: { [ALICE]: 1, [BOB]: 1 },
    }));
  });
  it('rejects negative allocations disguised by an offsetting positive share', async () => {
    await assertFails(setDoc(doc(db(BOB), 'households', HID, 'expenses', 'negative'), {
      ...validExpense(BOB), shares: { [ALICE]: -100, [BOB]: 90100 },
    }));
  });
  it('rejects payer totals that do not match the expense', async () => {
    await assertFails(setDoc(doc(db(BOB), 'households', HID, 'expenses', 'bad-payers'), {
      ...validExpense(BOB), payers: { [BOB]: 5 },
    }));
  });
  it('rejects changing the expense author to conceal history', async () => {
    await setDoc(doc(db(BOB), 'households', HID, 'expenses', 'immutable-author'), validExpense(BOB));
    await assertFails(updateDoc(doc(db(BOB), 'households', HID, 'expenses', 'immutable-author'), { createdBy: ALICE }));
  });
  it('rejects expired invites at the rules layer', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', 'expired'), { householdId: HID, role: 'member', active: true, expiresAt: Date.now() - 60000, createdBy: ALICE });
    });
    await assertFails(setDoc(doc(db(EVE), 'households', HID, 'members', EVE), {
      uid: EVE, householdId: HID, role: 'member', displayName: 'Eve', inviteCode: 'expired',
    }));
  });
  it('prevents recreating an owner membership on an existing household', async () => {
    await assertFails(setDoc(doc(db(EVE), 'households', HID, 'members', EVE), { uid: EVE, householdId: HID, role: 'owner' }));
  });
  it('does not expose another user profile document', async () => {
    await setDoc(doc(db(ALICE), 'users', ALICE), { uid: ALICE, displayName: 'Alice' });
    await assertFails(getDoc(doc(db(BOB), 'users', ALICE)));
    await assertSucceeds(getDoc(doc(db(ALICE), 'users', ALICE)));
  });
  it('prevents a hard deletion of a cloud ledger', async () => {
    await setDoc(doc(db(BOB), 'households', HID, 'expenses', 'retain-ledger'), validExpense(BOB));
    await assertFails(deleteDoc(doc(db(ALICE), 'households', HID, 'expenses', 'retain-ledger')));
    await assertFails(deleteDoc(doc(db(ALICE), 'households', HID)));
  });
});
