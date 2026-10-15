# AI Quick Add — multiple expense drafts, individual review, atomic save

## What is and isn't configured

The Expenses page has an **AI Quick Add** button, replacing the old toolbar
chat action. Inspection found **no AI model, provider key or backend** in this
project: the previous Quick Add was a local parser. Accordingly the new modal
explicitly says **No AI provider is configured; free local parsing is active**.
No AI integration, general language understanding, paid/free API quota or LLM
response is falsely claimed. No external request is sent to infer expenses.

The complete multi-step review and atomic-save workflow works without additional
configuration. Actual model-backed parsing would require an approved provider/
model and a tested, authenticated server endpoint. A provider secret must never
be placed in `VITE_` variables or the browser. No such dependency, paid service,
Firebase Storage or billing change was introduced.

## Use

1. Open **Expenses → AI Quick Add** and describe up to **8 expenses** in one
   request (up to 6,000 characters). Use one sentence with linked clauses,
   paragraphs, new lines or semicolons. Supported examples:

   - `I paid 2500 for groceries, 300 for electricity, and 800 for dinner yesterday.`
   - `I paid Rs. 2,500.50 for groceries yesterday split equally between me and Rahul; Rahul paid ₹300 for electricity today split 2:1 between Rahul and me.`
   - `I paid 1500 for dinner yesterday split unequally: me 700, Rahul 800.`
   - `I paid 1000 for food today split percentages: me 60%, Rahul 40%.`
   - `Groceries ₹2500 yesterday, electricity ₹300 today.`

2. Optional missing-date/equal-household-split defaults are **unchecked**. Only
   enable them if you want those explicit defaults. Otherwise absent dates,
   payers, split methods and participant lists remain blank for clarification.
   “I paid” uses the signed-in user; named payers resolve only against the active
   household. Unknown/ambiguous people are never substituted with someone else.

3. Each draft opens in its own existing expense modal: **Expense 1 of 3**, etc.
   Review title, amount, category, date, payer, participants and all four split
   methods. Fix missing/invalid details before Next. The exact source and
   extraction warnings are available in the review note.

4. **Previous expense** preserves edits, including incomplete input. **Skip**
   excludes an expense but allows Restore/edit in the summary. **Remove** drops
   an unsaved draft. Cancel asks before discarding. None of these actions writes
   expenses, activity, notifications or raw requests to Firestore.

5. The final confirmation lists every included expense's amount, category,
   payer, date, method, participants and exact calculated minor-unit shares.
   Skipped items are labeled separately. Only validated, explicitly reviewed
   items can be confirmed. Identical-looking included drafts require a further
   acknowledgement or correction.

6. Only **Add All Expenses** creates permanent records. Success reports all
   included records saved. The normal ledger drives balances/reports/listeners;
   existing expense activity and recipient notifications are committed too.
   The manual Add expense button and other household forms remain available.

## Parsing scope and safety

This local parser is conservative, not unrestricted natural-language AI. Common
rupee spellings (`₹`, `INR`, `Rs.`), Indian grouping and up to two decimals are
supported. Unsupported wording becomes an editable clarification, not an
invented financial fact. Review every extracted value.

- A single explicit trailing “yesterday” or split instruction can apply to a
  linked list; inherited context is flagged. Distinct explicit dates/payers/
  splits override their own clauses. Context doesn't leak across new sentences,
  paragraphs or semicolons. The current local date anchors relative dates.
- ISO dates, today/yesterday/tomorrow are supported. Ambiguous weekdays/next-week
  wording and invalid dates stay blank. No missing amount is inferred from
  participant allocations, and invalid precision/negative amounts aren't rounded.
- Category keywords map to the **existing** schema. Utilities/water/gas map to
  **Other** with an explicit note, because this app has no Utilities enum.
- The clause becomes an editable title. Description stays optional/blank unless
  explicitly labeled `note:` / `description:`. The complete raw request is not
  silently added to the shared description.
- Equal, custom amounts, percentages and integer shares use the existing paise
  logic. Unspecified participants/methods require completion unless the user
  opted in to a visible default. Named allocations use commas/and between people.
- The batch supports up to 8 expenses and 8 distinct payers/participants combined,
  bounded for the existing security/transaction surface. Split larger requests
  into separately reviewed batches. It does not secretly perform partial commits.

## Atomicity, stable identities and failure recovery

`prepareExpenseBatch` uses the existing financial validator for every item and
captures the current authenticated user, household, stable batch/item UUIDs,
exact normalized payload and SHA-256 fingerprint. It does not write to Firestore.

After explicit confirmation, the precise submission is retained in tab-scoped
**sessionStorage**, keyed by household and user. No unconfirmed draft/raw request
is persisted. If tab storage is unavailable, no financial submission starts.
This tiny confirmed-request cache survives refresh so a lost acknowledgement
cannot turn into a second batch. It is removed when success is acknowledged via
**Done**. Treat a confirmed request as financial information on a shared device;
close the tab after resolving it. It is never an API credential or AI prompt log.

`saveExpenseBatch` runs **one Firestore transaction**:

1. Check active Firebase identity and household membership.
2. Read all deterministic expense IDs before any writes.
3. If every record already exists with this author/batch/fingerprint, return the
   already-saved IDs without changing any expense/event/read notification state.
4. If an incomplete/conflicting inventory exists, refuse additional writes and
   show existing IDs; never “fill in” an externally damaged batch automatically.
5. Recheck all referenced members in the same household. A stale participant or
   cross-household payload rejects the entire operation.
6. Create expenses in the existing schema, adding only `batchId` and
   `batchFingerprint` metadata, and call the normal expense event/notification
   helper with deterministic IDs. All expense/event/notification writes commit
   together or none do; no weakening/new security rules or marker collection.

A synchronous UI lock prevents repeated-click submits. The IDs/fingerprint and
read-before-write transaction protect against concurrent retries and lost server
acknowledgements. Concurrent identical commits can reach immutable activity rules
before a conflict is reported, so after any write error the service verifies the
entire exact inventory before declaring success. It never assumes an unknown
network outcome is either saved or unsaved.

The failure screen locks the confirmed payload and offers **Check saved status**
and **Retry Add All Expenses** using the same IDs. It reports all saved, currently
zero target records, unknown status, or a conflicting inventory and existing IDs.
No edit/reparse into a fresh batch ID is offered for an ambiguous in-flight
submission. Reload and reopen the same Expenses-page button to recover the
confirmed request. Don't manually recreate an unknown submission.

Household switching/unmounting does not retarget an in-flight transaction: the
request remains bound to its captured household/user. Normal unconfirmed drafts
are cleared on route/household changes. Existing persisted expenses and user data
are not migrated or deleted.

## Verification

Latest checks: **100 unit tests, 33 Firestore security tests, 15 emulator browser
workflows**, plus a production build. Nine of the browser workflows are batch
specific; the existing six avatar/modal/financial regression workflows still pass.

Batch checks include: the exact three-expense example, no writes before final
confirmation, earlier edits preserved, skip/restore/remove, summary cancellation,
missing/unknown facts, unequal allocation errors, date/category validation,
duplicate-looking drafts, mobile/keyboard portal behavior, manual entry,
concurrent retries at **8 expenses × 8 members**, 56 per-expense notifications,
payload mutation rejection, lost acknowledgement/reload recovery, removed-member
rollback/retry, partial-ID conflicts, household tampering and cross-household
member rejection. Tests use only demo Firebase emulators and create no live
financial data. Source security rules/indexes remain unchanged.

## Files changed

Added:
- [expenseBatch.js](../src/lib/expenseBatch.js): pure clause parsing, defaults,
  duplicate signatures, identity/fingerprint helpers.
- [expenseData.js](../src/lib/expenseData.js): extracted common pure financial
  validator; adds strict calendar/category checks for review and manual entry.
- [expenseBatches.js](../src/services/expenseBatches.js): atomic prepare/save/check.
- [ExpenseBatchQuickAdd.jsx](../src/components/ExpenseBatchQuickAdd.jsx): input,
  sequential editable modals, summary, scoped retry cache and outcome handling.
- [expense-batch.css](../src/styles/expense-batch.css): responsive themed wizard.
- [expenseBatch.test.js](../src/lib/__tests__/expenseBatch.test.js): 22 unit tests.
- [expense-batches.spec.js](../tests/firebase-browser/expense-batches.spec.js):
  8 emulator browser transaction/review/recovery workflows.
- [this document](expense-batches.md).

Modified:
- [Expenses.jsx](../src/pages/Expenses.jsx): Expenses-page AI Quick Add button.
- [ExpenseForm.jsx](../src/components/ExpenseForm.jsx): reuses manual fields with
  optional review navigation, raw edit preservation and validate-without-save mode.
- [expenses.js](../src/services/expenses.js): shared validator import/re-export;
  optional batch metadata on the normal expense writer. Manual CRUD retained.
- [Layout.jsx](../src/components/Layout.jsx): removes the old global single-action
  chat launcher; all other navigation remains.
- [ui.jsx](../src/components/ui.jsx): a short ID hint disambiguates identically
  named members in existing participant selectors; no avatar/modal logic changes.
- [README](../README.md), [old Quick Add documentation](quick-add.md) and
  [workspace overview](../../README.md): current behavior and setup caveats.

Removed obsolete single-action UI/test files (not user data):
- `src/components/QuickAdd.jsx`
- `src/styles/quick-add.css`
- `tests/firebase-browser/quick-add.spec.js`

The old pure [single-clause parser](../src/lib/quickAdd.js) and its tests remain
because the new batch parser reuses its member/split extraction. Existing manual
bill/chore/grocery/settlement forms/services, authentication, schema field names,
financial sign conventions, rules/indexes and Storage-free architecture remain.
