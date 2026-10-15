# RoomSync — Firebase + themed interface

RoomSync is again backed by **Firebase Authentication, Cloud Firestore and
Firebase Storage**, not the previous localStorage database. React 18 + Vite,
JavaScript, Recharts and plain CSS are retained. Preview: <http://localhost:5173>.

## Interface update

- Frosted-glass panels and navigation, emerald accents and layered surfaces.
- Tactile/neumorphic secondary buttons, hover lift, press feedback and soft
  route/modal entrances. Financial actions still require explicit forms.
- Clickable dashboard summaries open Expenses, Balances, Chores and Groceries.
- Persistent **light/dark toggle** on authentication pages and the app toolbar,
  with appearance controls in Settings. Initial theme follows the OS; stored
  preference is applied before paint and synchronized between tabs.
- Reduced-motion preference disables decorative animations. Keyboard focus,
  responsive navigation and theme-aware form/chart styling are retained.

## Active data services

- Email/password Firebase Auth, password reset, reauthentication before password
  changes/account deletion, profile images and household member profiles.
- Cloud households, long random invitation codes with server-enforced expiry,
  owner/admin/member roles and membership-scoped real-time listeners.
- Expenses with four integer-paise split methods, receipts, edit/soft-delete
  audit history; balances recomputed from the expense/settlement ledger.
- Recorded/confirmed/reversed settlements (bookkeeping, not bank transfers).
- Bills and chores with deterministic recurring occurrence IDs and rotation.
- Shopping, purchased history, activity, relevant notifications and reports/CSV.
- Firestore transactions atomically link bill/grocery payments with expenses
  and events. Retry guards prevent duplicate ledger entries and recurrences.
- Real-time listeners are cleaned up, and errors display actionable messages
  instead of silently showing zero balances. Cloud Firestore uses a memory
  cache on shared devices; Firebase Auth still persists sign-in sessions.

**Old local data is preserved:** the previous database key is untouched and is
not uploaded automatically. Local accounts/password verifiers are not Firebase
accounts. Sign in with, or create, a Firebase account for cloud use. Only UI
preferences (theme and selected household) remain in application localStorage.

## Current live-project status

Verified on **2026-10-15**, project `roomsync-9dceb`:

- Firebase CLI access is working. Email/password sign-in is enabled and
  localhost plus the two Firebase Hosting domains are authorized.
- The existing **(default) Native Firestore database** is active in `nam5`.
  It was not recreated, moved, or emptied.
- **Firestore rules and indexes deployed successfully.** The active released
  rules' content hash matches this repository's rules file.
- Both composite indexes are **READY**: expenses `(deleted ASC, date DESC)`
  and notifications `(recipientId ASC, createdAt DESC)`. The collection-group
  `members.uid` index is also **READY**.
- A live browser workflow with two disposable test accounts passed: registration,
  household bootstrap, invitation claim, membership isolation, denied role
  escalation, real-time expenses, edit/soft-delete, exact paise totals,
  settlements/confirmation/reversal, bill and grocery ledger links without
  duplicate retries, chore rotation/recurrence, reports, notifications and
  refresh/sign-in persistence. **All generated test households, invites,
  profiles and accounts were removed by a scoped administrator cleanup.**
- **Storage is not ready:** its API was enabled, but there is no default bucket.
  Billing is disabled and the attempt to create a default bucket returned
  permission denied. Storage rules cannot deploy until a bucket is initialized.
  The app disables optional image uploads with a useful explanation instead of
  pretending they work. Financial and household features still work normally.
- No paid billing plan, Cloud Function or public Hosting release was enabled.

The ignored `.env.local` holds the supplied web identifiers; the example is a
sanitized template. A safe read-only administrator snapshot is saved under
`artifacts/firebase/status.json`. This is a dated verification report, not a
guarantee that future console changes cannot alter the configuration.

## Install and preview

```bash
npm ci
npm run dev
```

Node 18+ for Vite; Node 22 is recommended for the test toolchain. The local
server is restricted to loopback and port 5173. No host-check bypass is enabled.

For a fresh clone, copy `.env.example` to `.env.local` and fill in the Firebase
**web app** identifiers from Project settings → General → Your apps. Never put
an Admin key, service-account private key or access token in a `VITE_` variable.

```bash
npm run check:firebase    # read-only service/configuration preflight
npm run check:firebase:admin # read-only rules/index/Auth/billing/bucket check
```

## Remaining Firebase setup: optional image uploads

Auth, the Firestore database, its rules and required indexes are deployed and
verified. Collections/documents are created by normal app actions; no fake
dashboard data or manual collection seeding is needed.

The only remaining core-service setup is **Firebase Storage**:

1. A project/billing owner must explicitly enable the **Blaze** plan and required
   billing access. This agent did not change billing or attach a billing account.
2. Open <https://console.firebase.google.com/project/roomsync-9dceb/storage>
   and choose **Get started** to initialize the default bucket. The attempted
   API setup was denied, so use an account with Storage creation permission.
3. Use a region appropriate for the existing database/users. Confirm the
   actual bucket name in the console and match `VITE_FIREBASE_STORAGE_BUCKET`
   in `.env.local`; don't assume a bucket exists from the web config alone.
4. Deploy the prepared, emulator-tested Storage rules:

   ```bash
   npm run deploy:storage
   ```

5. Set `VITE_FIREBASE_UPLOADS_ENABLED=true` in `.env.local`, restart the dev
   server (or rebuild), and test a small receipt/photo upload with a test account.
   No billing or upload feature is enabled merely by setting this flag.

To redeploy Firestore configuration in future, use `npm run deploy:firestore`.
The checked-in `.firebaserc` binds ordinary CLI commands to `roomsync-9dceb`.
Do not disable security rules to make queries/uploads succeed. New default
Storage buckets require the Blaze plan; see the official Firebase Storage
billing-change FAQ: <https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024>.

No Cloud Functions are currently deployed or required by normal CRUD. Permanent
recursive household deletion and ownership transfer are deliberately unavailable
rather than risking orphaned ledgers. That remaining administrative workflow
needs trusted server-side implementation and testing before a production launch.
Account deletion is allowed only after household memberships are resolved.

## Verification

Latest result: **40 calculation tests, 30 Firestore security tests, 11 Storage
security tests, 3 Firebase-emulator browser workflows and 1 scoped live-Firebase
browser workflow passed; production build succeeded.** Firestore deployment and
live database workflows were separately verified; live uploads remain blocked
by the missing bucket/billing.

```bash
npm test                         # 40 calculation tests
npm run test:rules               # Firestore security tests (isolated emulator)
npm run test:storage             # Storage privacy/MIME/size/path emulator tests
npx playwright install chromium # first browser run only
npm run test:browser             # 3 Firebase emulator browser workflows
npm run build
```

The Firebase browser test configuration uses **demo-roomsync** on port 5174,
with local Auth/Firestore/Storage emulators. It never connects test accounts or
expenses to the supplied live project. Java is required for emulators; the CLI
is pinned to v13 for the machine's Java 11. CI uses Node 22 and Java 21.

Verified browser paths: Auth registration, batched household bootstrap, shared
ledger edit/delete, session/reload persistence, transaction-safe bill payment,
chore recurrence, grocery links, receipt upload, an invitation between two
independent browser contexts, real-time synchronization, both themes, clickable
summary cards, mobile navigation and reduced-motion behavior. Screenshots and
traces are local artifacts under `artifacts/tests/` and excluded from Git.

Live integration testing is separate, opt-in and **not part of CI**:

```bash
ROOMSYNC_LIVE_TESTS=1 npx playwright test --config playwright.live.config.js
# Then remove only those disposable records using the exact generated manifest:
node scripts/cleanup-live-tests.mjs artifacts/tests/live-firebase-ROOMSYNC-TEST-TIMESTAMP-ID.json
```

The live check records the exact generated account/household/invite IDs in
ignored manifests. Cleanup requires the existing Firebase CLI administrator
login and verifies the unique test marker before deleting anything. Never pass
real household records to this cleanup workflow. Credentials stay in CLI-managed
storage/in-process memory, not in frontend files or committed artifacts.

Calculation tests cover paise allocation, all split methods, multiple payers,
partial settlements and reversals. Security tests also reject mismatched totals,
negative allocations, author changes, expired invitations, privilege escalation,
cross-household access and private profile/notification access.

Legacy local-only tests/configuration and `localStore.js` remain historical and
are excluded from the current test commands. They do not represent the active
backend; use the commands above rather than the old local Playwright config.

## Explicit limits / remaining work

- Allocation rules verify totals and nonnegative integer values for at most
  **8 distinct people per expense** (payers and participants combined), with a ₹10 crore total cap. The bound keeps worst-case validation within Firestore's expression budget.
  Larger financial allocations require trusted server-side validation. Split
  intent is calculated in the app; rules enforce allocation consistency, not
  every split-method formula. A malicious household member can still enter
  dishonest financial input; this is not a bank or an externally certified audit.
- Recursive cloud household deletion and ownership transfer are not configured.
  The dangerous delete control is disabled, and the service refuses without
  deleting any records. Do not treat this as a complete production release yet.
- No scheduled email/push reminders or AI integration. Notifications are in-app;
  reset emails are handled by Firebase Authentication.
- Live Storage uploads remain unverified/unavailable until the owner completes
  bucket and billing setup. Storage rules are prepared and tested, not deployed.
- Firebase download URLs are bearer links. Share receipt links privately.

## GitHub publication

A repository is initialized locally for **this app only**, not the surrounding
Designer workspace. `.env.local`, dependencies, builds, screenshots, logs,
service-account key patterns and private keys are ignored. The web template has
no filled credentials. A GitHub Actions workflow runs build, rules and browser
checks without production secrets.

The access token pasted in chat is exposed. **Revoke it in GitHub → Settings →
Developer settings → Personal access tokens.** Do not place the replacement in
chat, source files, a remote URL, commit messages or command history. Authenticate
using GitHub CLI browser login or your system's secure Git credential flow.

Published to **<https://github.com/Alexwatson-de/Roomsync>**, branch `main`.
The initial application commit `7c33fdd` was pushed successfully and its full
commit ID matched the remote branch. Publication used the machine's configured
Git credential flow; no chat token was embedded in source or the remote URL.
The committed-file scan passed for access tokens, private keys and excluded
runtime/generated files. No remote history was overwritten.

For future updates from this app repository:

```bash
git push origin main
```

GitHub publication itself does not deploy Firebase: Firestore rules/indexes
were deployed separately as recorded above. Hosting remains optional and has
not been published. Check CI execution results on GitHub separately.

## Optional Hosting deployment (not performed)

```bash
npm run build
npx --yes firebase-tools@13 deploy --project roomsync-9dceb --only hosting
```

Add the deployed/custom domain to Auth authorized domains when needed. Ensure
rules and indexes are deployed **before** exposing shared data. Hosting, database,
uploads and a GitHub source push are separate operations; none should be called
complete until its actual result has been verified.
