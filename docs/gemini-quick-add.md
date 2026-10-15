# Gemini Quick Add — protected AI parsing and correct section routing

## Active provider

AI Quick Add now has a real **server-side Gemini REST integration**, using the
owner-supplied API key stored as **Vercel production Secret `GEMINI_API_KEY`**.
No Gemini credential was added to source, frontend environment, a remote URL,
Firestore, or the bundle. `GEMINI_MODEL` is set to `gemini-3.1-flash-lite` after
an actual structured-extraction test succeeded. Earlier 2.5 models were rejected
by the provider for this key; they are not the active configuration.

The supplied Gemini project number is `877366125052`. It is distinct from the
existing Firebase application project `roomsync-9dceb`. Firebase Auth/Firestore
are not moved to the Gemini project. No billing plan, Cloud Function, Firebase
Storage bucket or extra dependency was enabled. Gemini provider/model availability,
free quotas, submitted-data terms and Vercel function allowances apply separately;
this integration does not promise unlimited free use or change a billing account.

**The key was exposed in chat. Rotate it and restrict its Google API access to
Gemini/Generative Language API in the owner's Google project.** Replace only the
Vercel server secret and redeploy. Never put a replacement in chat, Git, a
`VITE_` variable, client JS or a command's visible arguments.

## What goes where

The AI assigns a proposed destination **per record**, not per request. Each
review modal has an editable **Save this record to** selector and explains
whether it changes balances:

- **Groceries** → `shoppingItems`: things you want to buy. Example: `Add 2 kg
  rice and milk to my grocery list.` They are unpurchased items, not expenses.
- **Bills** → `bills`: an upcoming bill/reminder/template. Example: `Create an
  electricity bill ₹300 due tomorrow monthly.` It is unpaid; no expense is
  created until a user later records payment through the existing bill flow.
- **Expenses** → `expenses`: payments already made. Example: `I paid ₹800 for
  dinner yesterday split equally between me and Rahul.` A **Groceries category**
  on a paid expense does not mean an extra shopping-list item should be invented.
- **Choose section**: unclear or unsupported intent must be resolved explicitly.

A mixed example:

> Add 2 kg rice to my shopping list; create an electricity bill ₹300 due tomorrow
> monthly; I paid ₹800 for dinner yesterday split equally with everyone.

Review each proposed form, adjust its section if needed, then review the final
summary. All-expense batches retain **Add All Expenses**; mixed batches use
**Add All Records**. No typing, parsing, destination change, Previous/Next, skip
or cancellation saves records. The summary names **Groceries/Bills/Expenses**,
separates bill expectations/shopping items from paid totals, and only final
confirmation writes the chosen records.

## Security and data path

1. The browser first loads public capability metadata from `GET /api/quick-add`.
   If production Gemini is configured it is offered; local parsing is explicitly
   selectable. A missing local/preview key does not claim AI availability.
2. Before an AI request, a visible consent control explains that the typed text
   and member display names will be sent to **Google Gemini**. Avoid sensitive
   information; the app does not establish provider retention/training policies.
   Local mode sends no AI request. Never include passwords, keys or private notes
   in the natural-language request.
3. `POST /api/quick-add` accepts only a bounded prompt (6,000 chars), active
   household ID and local date context. It rejects cross-origin browser requests
   outside the allowed deployed domains, unsupported methods/content types,
   oversized bodies and caller-supplied member/key overrides.
4. A Firebase ID bearer token is verified with Google's RSA signing certificates
   and exact audience/issuer/expiry/auth-time checks. It must belong to the
   existing Firebase application project, not the Gemini billing project.
5. Read-only Firestore REST requests use **that user's token**, preserving the
   existing security rules to establish their membership and load only that
   household's member display names. There is no Admin credential/bypass.
6. Gemini receives the prompt/date and short pseudonymous member refs plus names,
   **not UIDs, emails, ID tokens, API keys, ledger/history, other households or
   database write tools**. Structured JSON output is bounded and mapped back
   to server-known member refs; arbitrary/external refs are discarded.
7. Returned model content is untrusted. The client enforces fixed destination
   types/categories, parses exact paise, checks members, leaves unknown fields
   blank and requires existing form validation plus human review.
8. The server does **not write anything**. Confirmed writes still happen through
   the user's Firebase client under unchanged Firestore rules/indexes.

A per-warm-instance limiter allows one active parse and four attempts per minute
per verified UID. It is **not a durable, distributed quota guarantee**; use Google
API project quotas/restrictions to limit public exposure. Provider rate/quota,
configuration, timeout or malformed-response errors are visible and save nothing.
The app does not silently label a local fallback as Gemini.

## Save/retry behavior retained

The existing batch service now chooses fixed collections by reviewed type and
uses the ordinary expense/grocery/bill record writers. The whole mixed batch
(plus standard events/relevant notifications) commits in one Firestore transaction
or none does. `batchId` / `batchFingerprint`, scoped session recovery, stable IDs,
concurrent retry checks and conflict refusal are retained. Collection/type is part
of mixed-batch fingerprints, preventing a confirmed request from being retargeted.
Existing expense-only retry fingerprints remain compatible; no migration of
confirmed cache records, user data, bills or financial ledgers is run.

Local parsing remains optional and bounded; semicolon/newline requests like
`Add milk; create rent bill ₹18000 due tomorrow; I paid ₹100 for dinner yesterday`
can route those records too. It is labeled **Local parser (not AI)**. Gemini is
the preferred deployed method when configured, but the review is always required.

## Local/server setup

Production server variables are already set in Vercel (not public source).
For local Gemini development, put `GEMINI_API_KEY` and optional `GEMINI_MODEL`
into ignored `.env.local`. `npm run dev` mounts the same endpoint through a
server-only Vite middleware. A plain `vite preview` is static and has no server
API; use the deployed site, `npm run dev`, or Vercel development for inference.

No key is configured by CI/emulator tests. Unit server tests mock provider/IAM
calls; browser integration tests mock the AI response while using actual demo
Auth/Firestore persistence and rules. No production expenses are seeded by CI.

## Verification

- **117 unit/server tests** including ID-token signature/claims, member scoping,
  input/origin boundaries, no-key/provider errors, safe reference mapping,
  structured REST requests, category/type normalization and existing logic.
- **33 Firestore security tests** unchanged.
- **19 emulator browser workflows** including mixed Groceries/Bills/Expenses
  persistence, editable section correction, no-save-before-confirmation,
  explicit consent/no-call-before-consent, quota errors/local fallback, and
  mixed-collection lost-acknowledgement recovery; manual household/financial/
  avatar/modal regressions remain covered.
- A real Gemini provider extraction using synthetic data separated shopping,
  unpaid bills and paid expenses correctly. A separate **live Vercel check**
  signed in a disposable Firebase account, created a marked test household,
  called the protected Gemini endpoint and verified the three review forms
  routed as grocery/bill/expense with no browser page errors. It cancelled
  before final confirmation (no expense/bill/shopping records saved); the test
  account/profile/household were removed by the scoped administrator cleanup.
  Anonymous inference returned **401**. These live checks are distinct from
  the mocked emulator tests. Never assume all possible wording is understood;
  model output always needs review.

## Files changed

Added: [server Gemini client](../server/gemini.js),
[Firebase token/membership verifier](../server/firebaseIdentity.js),
[Vercel API handler](../api/quick-add.js),
[server tests](../server/__tests__/quick-add.test.js),
[client provider gateway](../src/services/aiDrafts.js),
[typed draft validation](../src/lib/householdDrafts.js),
[typed draft unit tests](../src/lib/__tests__/householdDrafts.test.js),
[mixed destination browser tests](../tests/firebase-browser/gemini-routing.spec.js),
and this guide.

Modified: [batch UI](../src/components/ExpenseBatchQuickAdd.jsx),
[batch service](../src/services/expenseBatches.js),
[fingerprint/duplicate helpers](../src/lib/expenseBatch.js),
[bill form](../src/pages/Bills.jsx), [grocery form](../src/pages/Groceries.jsx),
[bill writer](../src/services/bills.js), [grocery writer](../src/services/groceries.js),
[Vite server config](../vite.config.js), [Vercel config](../vercel.json),
[deployment exclusions](../.vercelignore), [env template](../.env.example),
[README](../README.md), [previous batch guide](expense-batches.md) and the
[workspace overview](../../README.md). Actual Gemini key values are not in any
of these files. Authentication credentials, security rules/indexes, existing data,
financial splitting logic and Storage-free avatar system are preserved.
