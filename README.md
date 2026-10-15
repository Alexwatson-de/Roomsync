# RoomSync — free-tier household management

React 18 + Vite + JavaScript, Firebase **Email/Password Authentication and Cloud
Firestore**, Recharts and plain CSS.

**Live website: <https://roomsync-beta.vercel.app>**

Local preview: <http://localhost:5173>.

**No application feature uses Firebase Storage. No billing account is required
for the active feature set on Firebase Spark, within its no-cost quotas.** No
Cloud Functions, phone/SMS auth, external avatar API or other paid service is
used. Free does not mean unlimited: monitor Auth/Firestore/Hosting quotas.
Official plan details: <https://firebase.google.com/docs/projects/billing/firebase-pricing-plans>.

## Generated avatars and full-viewport modals

Profile photos have been replaced with locally rendered initials avatars:

- Three built-in styles: **Circle, Rounded, Ring**.
- Six fixed background colors with readable white initials. Unsaved/legacy
  profiles derive a deterministic color from user ID and default to Circle.
- Customize the preview in Settings and click **Save profile**. Only small
  `avatarStyle` / `avatarColor` strings and the display name are merged into the
  existing `users/{uid}` document, then mirrored to the user's existing household
  member records for consistent, real-time member avatars.
- Every avatar surface uses the shared Avatar component: sidebar, Settings,
  Members, activity, balances, chores, expense participant selectors and dashboard.
- No remote images, file inputs, upload/delete/download SDK calls, bucket
  initialization, Storage emulator, Storage CI step or Storage deployment target.
  Receipt attachments were removed from new forms too, so no feature depends on
  a bucket. Historical image/receipt URL fields remain **untouched**, but are not
  rendered or fetched by the application.
- Defaults are computed on reads, not written as a bulk migration. Users with
  missing profiles or no photo get initials immediately. Saving uses merge/update
  operations; unrelated custom fields and existing timestamps are preserved.

The shared Modal now uses a **React portal into document.body**, outside the
animated/transformed page and glass panels that previously confined its fixed
backdrop. It covers the entire viewport, including the sidebar. The document
scroll is locked, keyboard focus is trapped and restored on close, Escape and
outside-click work, and a scrollable mobile dialog retains its header/close
control. Current glass surfaces, button feedback, light/dark themes and
reduced-motion support are preserved.

## Existing features preserved

- Firebase registration, login/logout, session persistence, reset email,
  password changes and protected routes.
- Cloud households, owner/admin/member roles, invitations and switching.
- Equal/custom/percentage/share expenses in integer paise, edit/soft-delete
  history and full-ledger balances; settlements with confirm/reverse history.
- Bills, recurring chores/rotation, grocery list, atomic purchase/expense links,
  household activity, notifications, reports, CSV exports and real-time updates.
- Existing financial records, user profiles, Authentication accounts, household
  memberships, historical URLs, local-only legacy data and indexes are not
  deleted, migrated or automatically uploaded by this change.

The only Firestore rules change for avatars adds validated enum metadata to an
existing **self-profile** update permission and validates avatar enums on the
private user profile. It does not permit editing another user, role escalation,
or cross-household reads/writes. All prior financial/membership permissions remain.
The old Storage rules file is retained unchanged as an inactive historical
artifact; it is not referenced by Firebase configuration or deployed.

## Install, configure and preview

```bash
npm ci
npm run dev
```

Use Node 22 for the complete toolchain (Vite also supports Node 18+). Put Firebase
web app identifiers in ignored `.env.local`, using `.env.example` as a guide.
Only the API key, Auth domain, project ID, app ID and optional messaging sender
ID are documented; no bucket or upload-enable flag is used. Web identifiers are
not privileged credentials. Never put Admin SDK keys/access tokens in frontend
files, `VITE_` values, the repository, remote URLs or chat.

For a new Spark project, enable Email/Password Authentication, create a default
Firestore database, authorize localhost and deploy rules/indexes:

```bash
npx --yes firebase-tools@13 login
npm run deploy:firestore
npm run check:firebase
npm run check:firebase:admin
```

This project's default CLI target is `roomsync-9dceb` in `.firebaserc`. Inspect
that target before deploying from a clone intended for a different project.
No Storage setup, Blaze upgrade or billing attachment is part of setup.

## Verification

Latest checks for this change:

- **47 unit tests**: existing 40 calculation tests plus 7 avatar tests covering
  initials/Unicode, deterministic defaults, supported styles/colors, legacy
  profile preservation, invalid enum handling and text contrast.
- **33 Firestore rule tests**: existing financial/privacy checks plus avatar
  self-edit, legacy-field preservation and invalid/cross-user edit denials.
- **6 browser workflows** using only local Auth + Firestore emulators:
  registration/login, profile styling and persistence across reload/sign-in,
  existing/new households, real-time shared avatar changes, missing-profile
  defaults without migration, legacy image/custom-field preservation, no Storage
  requests, desktop/mobile avatar rendering and modal viewport/focus/scroll tests.
  Existing expense, settlement, bill/grocery transaction, recurrence, notification,
  theme and household sharing regression paths remain covered.

```bash
npm test
npm run test:rules
npx playwright install chromium # first browser run only
npm run test:browser
npm run build
```

Emulator tests use `demo-roomsync` / `roomsync-rules-test`, isolated temporary
browser profiles and ignored `artifacts/tests/`; they do not modify live user
records. Java is required for the emulators. Firebase CLI v13 is pinned for this
machine's Java 11; CI uses Node 22 and Java 21.

The production build no longer imports Firebase Storage. The official `firebase`
package can retain optional Storage subpackages in its lockfile; they are not
imported or bundled by RoomSync.

## Live configuration status

The avatar-only Firestore rule extension was deployed and its live source hash
verified against this repository. Both expense/notification composite indexes
and the collection-group membership `uid` index remain **READY**. Email/password
Auth is enabled, localhost and **roomsync-beta.vercel.app** are authorized, and billing remains **disabled**.
Safe read-only status is recorded in `artifacts/firebase/status.json`.

An earlier scoped live test verified shared financial workflows; its disposable
accounts, households and invites were cleaned up. This avatar/modal revision was
tested in emulators and did **not** delete/migrate existing live user data or
create a billing account. Existing service status can be rechecked with the
read-only admin command above; it no longer queries any Storage API.

## Vercel deployment

The production site is published at **<https://roomsync-beta.vercel.app>**.
The Vercel project is `dhruv-820e/roomsync`, linked to the existing GitHub
repository. Vite builds through `npm ci` / `npm run build`, with `dist` as the
output. `vercel.json` configures React Router deep-link rewrites and basic
response headers. The website is publicly reachable; Firebase Authentication
and membership rules still protect the application data.

Firebase **web** configuration is set as Vercel Config environment variables
for production and preview: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, and
`VITE_FIREBASE_MESSAGING_SENDER_ID`. These identifiers are client-public by
design; Firestore rules enforce access control. `VITE_USE_FIREBASE_EMULATORS`
is explicitly `false` in deployed environments. No Admin SDK, service-account
key, GitHub token, or Vercel credential is placed in the frontend configuration.

`.vercelignore` excludes runtime environment files, local credentials,
dependencies, build output, logs and test artifacts from deployment uploads.
`.vercel/` and runtime environment files remain excluded from Git. Vercel login
uses its browser approval flow, not a token pasted into the repository.

After authenticating to Vercel, future manual deployments use:

```bash
npx --yes vercel@latest deploy --prod --yes
```

Live verification confirmed HTTP 200 on the root and direct routes, protected
routes redirecting to Firebase sign-in, Firebase config loading, desktop/mobile
registration and reset forms, dark/light preference persistence, no horizontal
mobile overflow, zero page exceptions and no Firebase Storage requests. This
deployment check did not create new live accounts or financial records.

If adding a custom domain, add it in both Vercel and Firebase Authentication's
authorized domains. Do not replace existing Firebase authorized domains or
weaken Firestore rules. Vercel and Firebase no-cost usage limits still apply.

### Optional alternative: Firebase Hosting

```bash
npm run build
npx --yes firebase-tools@13 deploy --project roomsync-9dceb --only hosting
```

Firebase Hosting was not deployed; the active public website is on Vercel.
Firestore rules must remain deployed before shared data is used.

## Remaining limits

As before, trusted recursive household deletion and ownership transfer are not
implemented; their unavailable controls do not silently delete ledgers. No paid
backend was added to provide them. Per-expense allocation validation supports
8 distinct payers/participants and a ₹10 crore total cap. No scheduled email/
push reminders or AI services are required. Firebase Spark quotas apply.

Source repository: <https://github.com/Alexwatson-de/Roomsync>. CI checks use
emulated Auth/Firestore without production credentials. For the exact scope of
this revision, see [files changed and data-preservation notes](docs/avatar-modal-changes.md).
