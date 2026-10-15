# Quick Add — type → review → confirm

> **Historical feature documentation.** The single-action toolbar chat described
> below has been replaced by **Expenses → AI Quick Add**, a sequential batch
> expense review wizard. Its former UI/test files were removed. The pure
> single-clause parser remains reused internally. See the current
> [batch expense implementation and setup caveats](expense-batches.md).

Open **Quick Add** in the application toolbar after signing in and selecting a
household. It is a chat-style **local text parser**, not a configured AI/LLM.
There is no AI API call, model download, key, paid provider or billing dependency.
This preserves the project's free-tier requirement. It understands common
English household commands, not arbitrary conversation or every phrasing.

## Examples

Use real member names from your active household in place of Rahul/Priya:

- `Add 2 kg rice to the grocery list`
- `Add milk assigned to Rahul`
- `I paid ₹1500 for groceries shared equally between me, Rahul and Priya`
- `I paid 1500 for dinner split unequally: me 700, Rahul 800`
- `I paid 1000 for lunch split percentages: me 60%, Rahul 40%`
- `I paid 900 for dinner split shares: me 2 shares, Rahul 1 share`
- `I paid 900 for dinner split 2:1 between me and Rahul`
- `Create a rent bill ₹18000 due tomorrow monthly`
- `Assign chore clean the kitchen to Rahul tomorrow weekly`
- `I repaid Rahul ₹500 yesterday`
- `Rahul paid me back ₹500`
- `Mark rent bill as paid by Rahul for ₹18000`
- `Mark milk as purchased for ₹60 split unequally: me 40, Rahul 20`
- `Complete chore clean the kitchen`

**Me/I/myself** refer to the signed-in user. **Everyone** selects all current
members, with a reviewable participant list. Unique full or first names resolve
only against the active household; duplicate/unknown names require an explicit
selection. The selection includes member-name/ID hints so same-name people are
not silently merged. Another household's UID is not accepted as a resolution.

## Review behavior

1. Type one request (up to 2,000 characters) and choose **Review draft**.
2. The parser identifies a supported action. If it cannot, pick the intended
   Draft type or use a normal form. Unsupported destructive/permission-changing
   commands are refused even if a type override is selected.
3. If names are ambiguous, select the intended members before opening the draft.
4. The appropriate existing modal opens with editable fields and a visible
   **Nothing has been saved** notice. Assumptions/missing facts are listed;
   the original request can be expanded. It is not automatically placed in a
   shared description or written to a chat history collection.
5. Check titles, amount, date, category, payer, participants and split details.
   Nothing is persisted on typing, parsing, record selection, opening, Escape or
   cancellation. Only the existing form's **Save/Record/Confirm** submits data.
6. On success a chat response reports what was saved **after confirmation**.
   Errors stay in the review form; invalid amounts/splits cannot save.

The normal household forms remain available. Quick Add reuses their validators,
existing services, integer-paise math, transactions, activity and notification
rules. No Firestore rule/index change, data migration or background scheduling
was needed. Chat state is in tab memory and resets when the active household or
signed-in user changes. It is not sent to an external assistant service.

## Existing bill, shopping and chore records

Existing-record actions first open a selector for **open records in the current
household only**. Only a unique exact name match is preselected; partial names,
several due-date occurrences or missing matches require explicit record choice.
No record is mutated by choosing it.

For payments/purchases, a visible **Also create a linked shared expense** checkbox
controls whether balances change. The subsequent review is explicit:

- Checked: opens the expense form with all four split methods. The linked expense
  and bill/item status commit in one existing transaction with deterministic IDs
  and retry guards. The banner states both changes before saving.
- Unchecked: opens the paid/purchased bookkeeping form only. No expense is added
  and balances are unchanged. The bill payer remains editable and must be a
  current member, including when it differs from the recording user.
- Chore completion opens a separate confirmation showing the exact chore and
  due date; completion may generate the next occurrence via the existing service.

A settlement is a **repayment record**, never a UPI/bank transfer. No message can
move money. Multiple-payer expenses, deletions, reversals, refunds, permission
changes and bulk automatic actions are not performed by this assistant.

## Supported syntax / limitations

- Amounts are INR, at most 2 decimals, converted through the existing integer-
  paise parser. No foreign-currency conversion, automatic rounding or invented
  total from member allocations. Missing totals remain blank in the modal.
- Named unequal amounts/percentages/shares should use commas or `and` between
  member allocations. Ratios require one positive integer weight per named
  participant, in written order. Invalid/missing allocations stay editable;
  no equal split is substituted for an unequal instruction.
- Exact dates use `YYYY-MM-DD`; `today`, `tomorrow` and `yesterday` are supported.
  Ambiguous weekday/next-week wording asks for calendar review instead of
  assigning an invented date. An absent date defaults to today with a warning.
- Absent payer/participants are disclosed defaults (you/all current members).
  The review form always allows correction. Never treat a parsed draft as a
  trusted financial fact.
- One grocery item and one action per request. Multiple items should be entered
  separately; a multi-item name is flagged for review, not split into hidden writes.
- New bill templates currently support equal splits; the warning directs unequal
  payments to an expense draft. Existing bill payments can use the full expense
  form and all splits when the linked-expense option is checked.
- Bill/chore recurrence options are the existing form's supported schedules;
  unsupported recurrence wording is visibly flagged for correction.
- This is not general-purpose reasoning or a multilingual LLM. No actual AI
  integration is claimed. A future model would need a genuinely configured,
  server-secured endpoint and its own tests; it must retain the same review gate.

## Verification and source

- **31 parser tests** cover equal/custom/percentage/shares, paise, missing/invalid
  values, relative/ISO dates, default disclosure, names, nonmember resolutions,
  repayment direction, destructive-command refusal and data immutability.
- **5 added emulator browser workflows** verify no writes before confirmation or
  after cancel, corrections, invalid split rejection, member ambiguity, all draft
  types, existing-record reviews, no AI/external requests, mobile display and
  household isolation. Existing 6 avatar/modal/cloud workflows still pass.
- Totals: **78 unit tests, 33 security-rule tests and 11 browser workflows** pass.
  Tests use only demo Auth/Firestore emulators; no real records are seeded.

Files added:
- [quickAdd.js](../src/lib/quickAdd.js): pure parser and supported action list.
- [QuickAdd.jsx](../src/components/QuickAdd.jsx): conversation, resolutions,
  explicit review routing, existing record selection and save responses.
- [quick-add.css](../src/styles/quick-add.css): responsive/theme-aware chat styles.
- [quickAdd.test.js](../src/lib/__tests__/quickAdd.test.js): parser unit coverage.
- [quick-add.spec.js](../tests/firebase-browser/quick-add.spec.js): emulator workflows.

Existing forms in [ExpenseForm](../src/components/ExpenseForm.jsx),
[Bills](../src/pages/Bills.jsx), [Chores](../src/pages/Chores.jsx),
[Groceries](../src/pages/Groceries.jsx) and [Balances](../src/pages/Balances.jsx)
now accept optional draft/review props while retaining their normal flows.
[Layout](../src/components/Layout.jsx) mounts the toolbar action keyed to the
household/user. [The bill service](../src/services/bills.js) preserves the
reviewed payer for status-only payments and validates current membership.
