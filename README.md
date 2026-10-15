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

The supplied web configuration has been copied from the example to the ignored
`.env.local` file. The example is sanitized for source control. Live read-only
preflight confirmed valid Auth configuration, localhost authorization and
Firestore denying an unauthenticated read. Firestore initially reported disabled;
a later check found it reachable. **This does not prove authenticated financial
workflows or that the repository rules are deployed.**

Firebase CLI currently has no authenticated administrator. No production
account/financial test records were created and no deployment was claimed.

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
```

## Finish Firebase setup

1. In Firebase Console, select project `roomsync-9dceb`.
2. Authentication → Sign-in method: enable **Email/Password**. Keep localhost
   in Authentication → Settings → Authorized domains.
3. Firestore Database: create the **(default)** database in production mode if
   it does not exist. Do not use public/test-mode security rules.
4. Storage: enable it for receipts/profile uploads; configure any billing
   required by Firebase for your project before relying on uploads.
5. Authenticate the CLI through the browser on this machine:

   ```bash
   npx --yes firebase-tools@13 login
   npx --yes firebase-tools@13 deploy --project roomsync-9dceb --only firestore
   # Once Storage is enabled:
   npx --yes firebase-tools@13 deploy --project roomsync-9dceb --only storage
   ```

6. Wait for indexes to finish building. Required indexes are defined in
   `firestore.indexes.json`: expense deleted/date, notification recipient/time,
   and collection-group membership uid. Index errors preserve the console link.
7. Test two real test accounts, invitation joining, a dummy expense and an
   upload before using real records. Delete or reverse test financial records.

No Cloud Functions are currently deployed or required by normal CRUD. Permanent
recursive household deletion and ownership transfer are deliberately unavailable
rather than risking orphaned ledgers. That remaining administrative workflow
needs trusted server-side implementation and testing before a production launch.
Account deletion is allowed only after household memberships are resolved.

## Verification

Latest result: **40 calculation tests, 30 Firestore security tests and 3 Firebase-emulator browser workflows passed; production build succeeded.** These results do not imply production rule deployment or live authenticated workflow verification.

```bash
npm test                         # 40 calculation tests
npm run test:rules               # Firestore security tests (isolated emulator)
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
- Live Auth/Firestore/Storage end-to-end verification still requires enabled
  services and deployment of the supplied rules/indexes by the project owner.
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

The destination repository URL is still required. No remote push has occurred.
After secure authentication and choosing a repository:

```bash
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

Choose the intended repository deliberately; no public repository is created
implicitly and no existing remote history should be overwritten.

## Optional Hosting deployment (not performed)

```bash
npm run build
npx --yes firebase-tools@13 deploy --project roomsync-9dceb --only hosting
```

Add the deployed/custom domain to Auth authorized domains when needed. Ensure
rules and indexes are deployed **before** exposing shared data. Hosting, database,
uploads and a GitHub source push are separate operations; none should be called
complete until its actual result has been verified.
