# Avatar + modal revision — files changed

## Result and scope

- Modals are portalled to the document body; the backdrop covers the viewport,
  including the sidebar. Focus/scroll handling and responsive scrolling are
  shared across all existing dialogs. Glass styling and themes remain.
- Built-in initials avatars replace all profile photos: 3 styles, 6 colors,
  deterministic defaults, live preview and Firestore persistence.
- All active Storage upload/download/delete SDK paths and upload controls are
  removed, including receipt attachments, Storage deployment targets and tests.
- Auth/Firestore remain on Spark-compatible services. No paid service, external
  avatar API, new dependency, billing attachment or Cloud Function was introduced.
- Existing Auth users, user/profile fields, legacy photo/receipt URLs, memberships,
  expenses, settlements and notifications are not deleted or migrated. Profile
  saves merge only name/style/color and mirror those to the user's memberships.
- Rules received only a validated self-avatar metadata extension. Other access
  gates and indexes are preserved; the extension was deployed and hash-verified.
- Verified: 47 unit tests, 33 Firestore rule tests, 6 Auth/Firestore-only browser
  workflows and a production build. Browser tests include registration, login,
  existing/missing profiles, household creation, avatar persistence/sync, no
  Storage requests and full-viewport modal behavior at desktop/mobile sizes.
  A production-bundle scan found no Storage endpoints or operations.

## Shared UI and all avatar surfaces

- [ui.jsx](../src/components/ui.jsx) — body portal, focus/scroll handling and the shared generated Avatar; participant selector updated.
- [experience.css](../src/styles/experience.css) — responsive dialog bounds/sticky header and avatar/picker styles.
- [Settings.jsx](../src/pages/Settings.jsx) — replaces photo upload with styles, colors and live preview; saves to existing profile.
- [Layout.jsx](../src/components/Layout.jsx) — current user's profile-backed avatar and display name.
- [Members.jsx](../src/pages/Members.jsx) — generated member avatars.
- [Activity.jsx](../src/pages/Activity.jsx) — member avatar preferences for activity actors.
- [Balances.jsx](../src/pages/Balances.jsx) — generated member avatars; balance logic unchanged.
- [Chores.jsx](../src/pages/Chores.jsx) — generated workload avatars; chore logic unchanged.
- [Dashboard.jsx](../src/pages/Dashboard.jsx) — generated payer avatars; removes obsolete receipt argument only.
- [ExpenseForm.jsx](../src/components/ExpenseForm.jsx) — removes file-upload state/control; existing split form retained.
- [Expenses.jsx](../src/pages/Expenses.jsx) — removes file arguments and remote receipt download links; old database fields remain intact.
- [SetupRequired.jsx](../src/pages/SetupRequired.jsx) — Spark/Auth/Firestore-only instructions.

## Avatar model and Firestore integration

- [avatars.js](../src/lib/avatars.js) — initials, enum palette/styles, deterministic defaults, validation.
- [AuthContext.jsx](../src/context/AuthContext.jsx) — subscribes to the signed-in user's existing private profile; cleans up listeners.
- [auth.js](../src/services/auth.js) — registration defaults, merged preference saves and member-snapshot updates; no photo or Storage operations.
- [households.js](../src/services/households.js) — includes current generated-avatar preferences on new/joined memberships.
- [expenses.js](../src/services/expenses.js) — removes receipt upload operations; existing ledger calculation and transaction behavior retained.
- [cloudStore.js](../src/services/cloudStore.js) — removes the Storage upload helper/imports; shared Firestore utilities retained.
- [firebase.js](../src/firebase.js) — Auth/Firestore only; no Storage initialization/emulator/settings.
- [firestore.rules](../firestore.rules) — enum validation and self-only editable avatar fields, without relaxing role/household/ledger gates.

## Configuration, checks and documentation

- [firebase.json](../firebase.json) — removes Storage deployment/emulator targets; Firestore/Hosting retained.
- [vite.config.js](../vite.config.js) — removes Firebase Storage from manual vendor chunks.
- [package.json](../package.json) — removes Storage scripts; browser tests now start Auth/Firestore only. No new packages.
- [.env.example](../.env.example) — removes obsolete bucket/upload flags; retains user-supplied web identifiers.
- [.env.local](../.env.local) — removes obsolete Storage settings locally; ignored runtime file, not published.
- [playwright.firebase.config.js](../playwright.firebase.config.js) — isolated Auth/Firestore tests with no Storage environment.
- [ci.yml](../.github/workflows/ci.yml) — removes obsolete Storage test step.
- [firebase-admin-status.mjs](../scripts/firebase-admin-status.mjs) — removes Storage API health checks; reports no Storage dependency and billing status.
- [status.json](../artifacts/firebase/status.json) — refreshed non-secret live verification: rule hash match, indexes READY, billing disabled.
- [avatars.test.js](../src/lib/__tests__/avatars.test.js) — 7 avatar/default/preservation/contrast unit tests.
- [firestore.rules.test.js](../tests/rules/firestore.rules.test.js) — 3 avatar permission/validation/preservation tests added.
- [cloud-workflows.spec.js](../tests/firebase-browser/cloud-workflows.spec.js) — removes receipt upload test; verifies shared avatar updates alongside existing cloud workflows.
- [avatars-and-modals.spec.js](../tests/firebase-browser/avatars-and-modals.spec.js) — registration/login/profile/legacy/no-Storage and desktop/mobile portal regressions.
- [README.md](../README.md) — current free-tier setup, verification, preserved-data behavior and limits.
- [workspace README](../../README.md) — updates only the RoomSync project summary.
- [this change list](avatar-modal-changes.md) — complete file-by-file scope.

### Removed obsolete test files (not application/user data)

- [former Storage SDK tests](https://github.com/Alexwatson-de/Roomsync/blob/a65a28d/tests/storage/storage.rules.test.js) — removed upload/download/delete emulator operations that no longer exist in the app.
- [former Storage test configuration](https://github.com/Alexwatson-de/Roomsync/blob/a65a28d/vitest.storage.config.js) — no Storage emulator/test suite is needed.

## Intentionally unchanged

Core money/splitting/balance/recurrence logic, settlements, notifications,
activity services, bills, chores and groceries services, Firebase Authentication
credentials/accounts, existing live records and indexes were not redesigned.
The [former Storage rules](../storage.rules) remain unchanged as an inactive
historical file, not referenced by the app's Firebase configuration. Optional
Storage packages in the official Firebase SDK lockfile are not imported or
bundled. Legacy local-only files are untouched and inactive, as before.

Free-tier use remains subject to Firebase's no-cost quotas. Existing unavailable
administrative features (recursive household deletion/ownership transfer) stay
unavailable; this revision does not introduce a paid backend to implement them.
No new public Hosting deployment was made.
