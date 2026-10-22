# ROADMAP — AI Menu Digitizer (sequential build order)

No parallel agents. Small atomic commits, one step at a time. P0 first;
do not start P1 until all P0 acceptance criteria pass (see PLAN.md §11).

## Step 0 — Infrastructure ✅ done

Git on `main`, Next.js App Router + TS strict + Tailwind, Prettier, ESLint,
Vitest, Zod, VSCode setup, `.gitattributes`/`.editorconfig` (LF everywhere),
`AGENTS.md`, `local/` sandbox (gitignored, see below).

## Step 1 — Schema + data utilities + tests ✅ done

Canonical Zod schema and types first — everything else consumes them.
Owns: `src/features/menu/schema.ts`, `types.ts`, `menu-utils.ts`,
`sample-menu.ts`, `tests/menu-schema.test.ts`, `tests/menu-utils.test.ts`.

## Step 2 — AI provider + API route ✅ done (live-tested with real key + sample images)

Server-only Gemini wrapper, prompt, `POST /api/extract-menu`, env config,
response validation with one controlled repair/retry, error mapping
(no leaked provider errors/keys/stack traces), clearly-labelled demo
fallback when `GEMINI_API_KEY` is missing. Route tests where feasible.

## Step 3 — Upload shell + page flow ✅ done (verified in browser + live extraction)

Dropzone + file picker, image preview with replace/remove, client+server
file validation (JPEG/PNG/WebP, size limits), loading/error states,
extraction trigger. Typed extraction callback; consume Step 1 schema.

## Step 4 — Editor + IndexedDB + import/export ✅ done (browser-verified incl. persistence + data-loss fix)

Editable workspace (categories/items CRUD, reorder, move, availability),
native IndexedDB persistence (menus + optional image blobs, schema
versioning, upgrade/error handling), JSON export/import with validation,
CSV export with correct escaping.

## Step 5 — Integrate + demo mode + README ✅ done (gates green + browser-verified)

Wire upload → extract → edit → save. Demo mode without API key.
README: setup, env vars, IndexedDB behavior, tests, Vercel deploy.
Collect sample images in `local/samples/menus/` (one clean, one difficult).

Verified: demo → edit → autosave → reload persistence in browser; live
extraction via `POST /api/extract-menu` with `cafe-board-clean-01.jpg`;
lint/typecheck/53 tests/production build all pass; README rewritten
(create-next-app boilerplate replaced).

## Step 6 — Verify + polish ✅ done (full local checklist + deployed)

Full PLAN.md §11 acceptance checklist: both sample images, all error paths
(missing key, quota, bad AI JSON, bad file, oversized, empty menu, malformed
import), persistence after refresh, JSON round-trip, CSV escaping, desktop +
mobile, no key leakage, production build, Vercel config.

Verified 2026-10-16: clean image via UI (drop → extract → editor → image blob
retrieved after refresh) and difficult image via API (31 items, honest nulls);
missing-key server run (503 `missing_api_key`, demo CTA, no key in logs);
quota error shown in UI without data loss; validation errors (400/413) live;
key absent from client bundles, no server-side file writes; desktop + mobile
screenshots. Fixed: dark-OS contrast break (light theme pinned), ESLint now
ignores `local/`. Gates: lint/typecheck/53 tests/build all green.

Deployed: pushed to GitHub (`origin/main`), imported into Vercel, and the
production URL verified end-to-end by the user on 2026-10-16 with
`GEMINI_API_KEY` set in Vercel project env vars (real extraction confirmed in
production). Vercel Hobby's 300s default function timeout covers the Gemini
call — no `maxDuration` config needed. **P0 is complete; P1 is unblocked.**

## Phase 2 — going live (scoped, not started)

Scope, sequencing rationale, acceptance criteria, and researched service
choices live in [`PHASE-2.md`](PHASE-2.md). Same working rules as Phase 1:
sequential steps, small atomic commits, quality gates green before a step
counts as done. Each step may expand into its own sub-commits; do not start a
step before the previous step's acceptance list passes.

### Step 7 — Foundation: server DB, tenancy, accounts ✅ done

Decided stack (user sign-off 2026-10-18, PHASE-2.md §9): **Neon Postgres +
Drizzle**, migrations run explicitly (never at request time), **Better Auth
magic link via Resend** — the only human sign-in, extent documented in
PHASE-2.md §3.6 — restaurants + owner/staff memberships, staging DB branch.
Anonymous local-only mode untouched.
**Done when:** a signed-in owner has a restaurant, tenancy isolation tests
pass, and the anonymous prototype still works end to end.

**Scaffolded 2026-10-18** (atomic commits on `phase-2`, renamed from
`docs/phase-2-scope` since it carries all Phase 2 work, not just docs):
Drizzle
schema (Better Auth core + `restaurant`/`restaurant_membership`) with an
offline-generated migration and a lazy Neon client (safe to import without
`DATABASE_URL`); Better Auth magic-link config + Resend sender
(dev prints links to the console, prod fails honestly),
`/api/auth/[...all]`, `/sign-in` page linked from the header, server
session guard, ownership-scoped tenancy repo, `GET|POST /api/restaurants`
(401/400/503, `no-store`); six new tests — tenancy isolation incl. staff
read-only and cascade deletes, plus magic-link E2E (one link → implicit
sign-up → session → single-use token consumed) — running against the real
generated DDL on PGlite; all gates green (128 tests). Locally: `/sign-in`
renders and fails gracefully without a DB; anonymous flow untouched.
**Verified 2026-10-18 (all done-when criteria met):** credentials landed —
migration applied to the real Neon DB (6 tables), endpoints verified live
(anonymous 401, signed-out mode untouched). Magic-link sign-in ran end to
end: link delivered by Resend through the **sandbox sender
`onboarding@resend.dev`** (clearly marked in `.env.local`; swaps to a
verified domain later — `.env.example` documents both), clicked → session
→ `POST /api/restaurants` 201 → owner-role restaurant listed scoped to
that session, against Neon through the real API. Tenancy isolation tests
pass (PGlite, real generated DDL); gates green (lint, typecheck, 128
tests, build). Outside this step's done-when and tracked below: Vercel
deploy (env vars + prod `db:migrate`) and a verified Resend sending
domain.

### Step 8 — Server-backed menus + "Move my menus to my account" ✅ done (browser-verified against Neon)

Editor reads/writes the server when signed in (IndexedDB stays the local
store and offline cache), `updatedAt` conflict check that surfaces
"changed elsewhere" instead of silently overwriting, one-way import of local
menus/orders through the same validated API. Storage strategy (user
decision 2026-10-18): **the session is the switch** — signed in = server
authoritative, signed out = local — with no env-var backend swap (see
Decisions).
**Done when:** the same menu edits from two browsers converge predictably,
and a local import preserves ids, order, variants, and review notes.

**Verified 2026-10-18 (all done-when criteria met):** the `menu` table
migration was generated offline and applied explicitly to Neon
(`npm run db:migrate`, applied twice explicitly — tip: drizzle-kit does not
load `.env.local` itself, so run it through a loader when the URL lives
there). `GET|POST /api/menus` + `GET|PUT|DELETE /api/menus/[menuId]` are
tenancy-scoped (owner writes, staff reads, cross-tenant ids 404), Zod-
validate documents in both directions, and detect conflicts with a
conditional `UPDATE … WHERE updated_at = expected` — one statement, safe on
the Neon HTTP driver without transactions (409 `stale_menu` carries the
current server `updatedAt`). The typed client (`src/features/menus/sync.ts`)
and `moveLocalMenusToAccount` (one-way, import-by-id, skip-existing) sit on
top; the editor, when signed in, adopts a newer account revision on open,
saves locally first and pushes with the last-seen `updatedAt`, and surfaces
a "changed elsewhere" banner offering an explicit load/keep choice instead
of silently overwriting. **Live acceptance:** 7 local menus moved intact
into "My Café" through the real API (ids/order/variants/review notes
preserved), a re-run reported 0 moved / 7 already-there, and two browser
tabs converged through *both* conflict resolutions — "Load the server
version" adopted the other tab's revision, "Keep my version" overwrote the
account copy (confirmed in the DB). Source images stay browser-local for
now — documents (ids, order, variants, prices, review notes) are what
sync. Signed-out local mode unchanged; 159 tests green (new: menus-repo,
menus-api, menus-sync, move-to-account); lint, typecheck, build green.

**Library/account coherence (follow-up, verified 2026-10-18):** the library
now merges in account menus it has not cached yet — discovered on load,
cached with the server's own `updatedAt` (not restamped), marked with an
"On your account" chip, and openable like any other menu, so a device that
has never seen them still lists and opens them. Library rename and delete
also act on the account copy: rename fetches the current revision first and
pushes with it (reporting a conflict instead of overwriting), delete removes
the server row before the local one and reports when the account copy could
not be removed. Verified live by staging an account-only row (appeared in
the library after reload and opened; the move panel hid), renaming it in the
library (server title changed), and deleting it (row gone from Neon, account
back to its 7 menus). 161 tests green.

### Step 9 — One-click publish to a real public URL (I3 core — first user-facing feature) ✅ done (browser-verified against Neon)

This is the flagship feature of the phase (user decision 2026-10-18), built
right after the foundation and always free — no checkout anywhere.
Publish button with slug rules and `menu_revision` snapshots, public
`/r/<restaurant>/m/<menu>` page built on the existing preview components and themes, og/Twitter
meta, QR code for the page (dependency already present), unpublish,
"unpublished changes" indicator, cookie-free view count.
**Done when:** the I3 acceptance list in PHASE-2.md passes on a phone that has
never opened the app.

**Built:** migration 0002 adds `menu_revision` (immutable, Zod-validated
snapshots that record the theme/layout and the menu `updated_at` they came
from) and `published_menu` (one reserved slug per menu, a live revision
pointer, a view count). `/api/menus/[menuId]/publication` reads status for any
member and publishes, renames the address, or unpublishes for the owner only;
`/api/r/[restaurantSlug]/m/[menuSlug]/view` counts a visit server-side with no cookie or identifier.
The editor's preview screen carries the publish panel (link, copy/open/QR,
views, editable slug, unpublish); the public page is a Cache-Components route
(shell + streamed menu) with og/Twitter meta, `noindex,nofollow` by default,
and a plain not-found page for unknown or unpublished slugs.

**Verified 2026-10-18:** migration applied explicitly to Neon; published
"Bistro Four" through the API and loaded `/r/<restaurant>/m/bistro-four` in a second browser
tab (bistro theme, 2 categories/2 items, em dashes for unset prices, og title +
description, `noindex`, view count 0 → 1). Editing the currency then reopening
the preview showed *Draft changes are not on the public page yet* and the
`Draft preview · public page is older` eyebrow while the public page still
served the old revision; **Publish changes** created revision 2 and the page
showed the new content with the warning cleared. Renaming the address moved
the page and 404'd the old slug (later restored). **Unpublish** rendered the
not-live page and stopped counting views; republishing reused the slug and
kept the view count. QR renders the public URL. 190 tests green (new:
publishing-slug, publishing-repo, publishing-api); lint, typecheck, build
green.

**Not yet verifiable here:** the “phone that never opened the app” half of the
done-when criterion — same-origin tabs exercise the public path, but a real
cold device needs the deployed URL. The I3 ordering and real-café onboarding
items belong to Steps 10–11.

### Step 10 — Table ordering across two devices (I1) ✅ done (browser-verified against Neon)

Orders API (public POST, board query, status PATCH with server timestamps and
server-computed totals), rate limits + honeypot on the public endpoint,
polling/SSE staff board with visible reconnect states, table links that point
at server data instead of a local IndexedDB id.
**Done when:** the I1 acceptance list passes: a cold phone order appears on
the owner's device within ~10 s without a refresh, and survives a deploy.

**Built:** migration 0003 adds `order` + `order_line` (snapshots of name,
variant, and unit price in integer cents, a server-computed `total_cents`
that is null when any line is unpriced, and a nullable menu link so history
outlives a deleted menu) and `order_rate_limit` (fixed-window counters keyed
by a hash of caller + window minute — no raw IP stored). `POST /api/orders`
is anonymous and resolves every line against the *published snapshot*;
`GET /api/orders` serves the membership-scoped board and returns everything
changed after `since`; `PATCH /api/orders/[orderId]` moves status forward
(new → preparing → served, cancel while working) and is conditional on the
`updatedAt` the caller saw. The diner page
`/r/<restaurant>/m/<menu>/order?table=<n>` is server-rendered from the snapshot; the Orders
tab picks the server board when signed in and the Phase 1 IndexedDB queue
when signed out; table QR cards encode the public link once the menu is live.

**Verified 2026-10-18 (live, two browser tabs against Neon):** an order
placed on the diner page (`/r/<restaurant>/m/bistro-four/order?table=3`, receipt #41F563)
appeared on the signed-in board **3.8 s after the POST committed**, with no
manual refresh; a status change made in a second board tab reached the first
tab **1.8 s after the PATCH** through the incremental cursor. Killing the dev
server mid-session switched the board to “Reconnecting… last update 07:46 PM”
with an explanation while keeping all four orders on screen, and a restart
brought it back to Live with the same data. Unpublished and unknown slugs
render the not-live page; a table link without a table number says what it
needs. Incognito (signed-out) still shows the local queue with no server
call. `menu_revision`-backed ordering, rate limiting, the honeypot, and
payload caps are covered by 22 new tests (212 total); lint, typecheck, build
green. Four demo orders remain in the account from this run.

**Not yet verifiable here:** the “cold phone on cellular, different network”
half of the done-when (same-origin tabs were used), and a real deploy/restart
— the dev-server restart exercised persistence, not Vercel. Signed-out local
ordering was not exercised end to end (signing out would cost the magic-link
session), but that code is unchanged and its tests pass.

### Step 11 — Free launch packaging + hardening (nothing is charged) ◐ built; needs a deploy + a real café

"Free while it lasts" promotion for the café track: onboarding checklist
(extract → review → theme → print table cards → publish → first order) and a
one-page "what you get"; privacy policy + terms; error tracking + structured
logs with request ids; security headers/CORS; rate-limit and volume alerts;
backup/restore check; re-verify no secret reaches a client bundle now that
auth and DB code exist; per-restaurant Gemini spend visibility plus
**per-account extraction caps** (the cost brake while everything is free);
order retention window (default 90 days) + owner data export/delete;
documented two-device test script. No checkout, no payment link, nothing to
buy — Stripe stays the eventual provider but is parked with Steps 12–13.
**Done when:** one real café goes image → live URL → first order using only
the packaged checklist with no payment step anywhere, a second café could be
onboarded the same way, and the PHASE-2.md §7 hardening checklist is verified
end to end (a production failure is visible to us without a user report).

**Built (2026-10-18):** `/launch` states the free offer and runs the six-step
checklist, deriving five steps from the account (menu exists, nothing left to
review, published, orders received) and marking printing as a manual tick
because the server cannot see a printer. Privacy and terms pages say what the
code actually stores — no menu photos, no diner identity, no payment data —
and link from a shared footer. Every request gets an `x-request-id` from the
proxy; server logs are single-line JSON with credential redaction and no
stack traces; unexpected failures and provider auth/quota failures email
`OPS_ALERT_EMAIL` through the existing Resend account, throttled per event.
Security headers are set app-wide (HSTS production-only) and every mutation
refuses a foreign `Origin` before touching the DB. Extraction usage is
recorded per attempt (pages, tokens, cost only from configured rates), the
per-account monthly cap is the cost brake, and anonymous extraction is capped
per caller per hour by a hashed address; `/launch` shows the allowance.
A purge exists for orders past `ORDER_RETENTION_DAYS` (90) and stale
rate-limit windows, behind a `CRON_SECRET`-gated route; **scheduling it is
parked** (see below), so today nothing deletes orders on its own. Owners can
export everything as JSON and delete their account (typed confirmation).
`npm run secrets:check` scans the built client bundle for configured secret
values and fails on a hit. `docs/` carries the launch runbook, the two-device
script, and the backup/restore drill.

**Verified 2026-10-18 (local, PGlite + browser):** 52 new tests (264 total) cover log
redaction and alert throttling, the same-origin guard, pricing/caps/usage
summaries, checklist derivation and the launch endpoint, the maintenance
purge, export scoping, deletion cascades, and its secret gate. Lint, typecheck,
build green; the secret scan reports no leak and was proved to fail on a
planted value. The checklist, legal pages, and usage panel were checked in the
browser (checklist read real account state — 7 menus, 4 orders, live slug —
with the manual tick undone again); the alert path and the cron route were
exercised locally, migration 0004 was applied explicitly to the dev Neon
database, and the payment-free claim was checked by searching the UI for any
payment surface (only the sentences saying there is none), and the privacy
page was corrected once automatic purging was parked. The cost brake was
proved live, not just in tests: with the account filled to its cap, a real
`POST /api/extract-menu` from the browser returned 429
`extraction_cap_reached` naming the reset date, the log line carried the same
request id as the response, the alert path fired (email unconfigured locally),
and the probe rows were removed afterwards — the panel went back to 0 of 150.

**Still needed from the user before this is fully done:** deploy, set
`CRON_SECRET` / `OPS_ALERT_EMAIL` / `CONTACT_EMAIL` / token rates in Vercel,
onboard one real café with the checklist, run the alert drill against the
deployed app, and create the Sentry project (logs + email alerts work without
it; a third-party error dashboard does not exist yet).

**Parked inside Step 11 (2026-10-18):** automatic order retention. Vercel cron
requires a paid plan, so `vercel.json`'s schedule was removed and nothing
calls the purge daily. The endpoint, its secret gate, its window config, and
its tests all stay in place so a free scheduler (an external cron, a GitHub
Action, or a Vercel plan upgrade) can switch it on without code changes, and
the privacy page no longer claims orders are deleted automatically. Until
that happens, the DB grows by whatever ordering activity a café has — worth
re-checking before the retention is needed for real.

### Step 12 — 🔒 parked: B2B extraction API surface (I2)

Parked by user decision 2026-10-18: the scope stays (PHASE-2.md §5) but this
step does not start until the Step 11 free launch is running.
`POST /v1/extract` + `GET /v1/usage`, Bearer API keys (hashed, shown once,
rotate/revoke), idempotency keys, per-key rate limits and spend caps, sandbox
key returning clearly-labelled sample output, `/developers` docs page with
curl + error table.
**Done when:** an external developer gets schema-valid JSON using only the
docs, with no repo access and no manual step from us.

### Step 13 — 🔒 parked (built last): metering + usage billing

Deliberately the final thing in the phase (user decision): **nothing in Steps
7–11 charges anyone**, and billing rides with the B2B API only. Ledger
`usage_event` written idempotently per request, usage dashboard, measured
real cost per page-image (this feeds the price), Stripe prepaid credits via
Payment Link first; Stripe Billing Meters only when a customer wants
recurring usage billing. Early free-promotion users are grandfathered when
pricing eventually lands.
**Done when:** dashboard totals equal the sum of request ids in tests, credits
draw down exactly once per request, and a Stripe test invoice matches our
own ledger.

**Priority note:** the two remaining Phase 1 P1 items (description cleanup,
translation) sit _below_ this Phase 2 work unless explicitly pulled up — they
are enhancements to a prototype we already shipped, not steps toward making
it live.

## Decisions

- **No shadcn/ui** (user decision). Tailwind primitives + small local
  components only.
- **No P1 features** until P0 acceptance passes.
- **Storage strategy** (user decision 2026-10-18): no env-var storage
  switch — the session decides (signed in = server, signed out = local),
  and Step 8 demotes IndexedDB to cache/offline layer. **Follow-up decision
  point after Step 10:** once menus, orders, and publishing all have server
  paths, reassess whether anonymous IndexedDB persistence still earns its
  keep — removing it then is a clean deletion, not a hole.

## Things needed from the user (later, not now)

- [x] `GEMINI_API_KEY` — in `.env.local` (live extraction tested at Step 5)
      and in Vercel project env vars (production extraction verified at deploy).
- [x] GitHub remote URL — `https://github.com/salman0719/ai-menu-digitizer.git`.
- [x] Vercel project setup — imported from GitHub, production verified 2026-10-16.
- [x] Sample menu images — collected in `local/samples/menus/`
      (clean: `cafe-board-clean-01.jpg`; difficult: `vintage-menu-01.png`).

## Things needed from the user — Phase 2 (decided 2026-10-18; details in PHASE-2.md §9)

- [x] **Server DB** — Neon Postgres + Drizzle (decided).
- [x] **Auth** — Better Auth with Resend; magic link is the only human
      sign-in, and its extent is documented in PHASE-2.md §3.6.
- [x] **Dependency exception sign-off** — granted for the DB driver/ORM and
      the auth library.
- [x] **Public URL shape** — `/r/<restaurant>/m/<menu>` on the current domain; custom
      domains deferred.
- [x] **Local vs server mode** — keep both (signed-out = local,
      signed-in = server).
- [x] **Error tracking** — Sentry (free tier) + cookie-free view counts.
- [x] **Charging** — nothing charges during this phase: advertise it free
      while it lasts; Stripe remains the eventual provider but is **parked**,
      and billing is built last.
- [x] **Pilot price** — deferred until after real measurement; the free
      promotion runs first, and early users are kept in mind when pricing
      arrives.
- [x] **Neon project** — created; migration applied and sign-in verified
      against it locally (2026-10-18). Env vars land in Vercel at deploy.
- [ ] **Resend sending domain** — account + API key are live and sending
      (sandbox `onboarding@resend.dev`, marked in `.env.local`); add a
      verified domain before anything beyond throwaway testing.
- [ ] **Sentry project** — Step 11 ships structured logs + email alerts;
      the Sentry DSN is still needed for a third-party error dashboard.
- [ ] **Contact address** — `CONTACT_EMAIL` for `/privacy` and `/terms`.
- [x] **`OPS_ALERT_EMAIL`** — `codemen.salman@gmail.com` in `.env.local`
      (2026-10-18); add the same variable in Vercel before relying on alerts in
      production.
- [ ] **`CRON_SECRET`** — only needed to run the maintenance purge by hand
      (scheduling is parked).
- [ ] **Promotion start date + endgame** — when "free while it lasts" opens
      and what happens when it ends (decide before advertising widely).

## P1 backlog — all remaining work (P0 complete)

Ordered by value to a café owner. Each should be its own small commit(s)
with tests where practical. Seven P1 items are already delivered and need no
work:

- **Sample menu/demo mode** — done ("Preview with demo data" CTA +
  `sample-menu.ts`, labelled demo; also the no-API-key fallback).
- **Extraction summary** — done (category/item counts and needs-review count
  in `extraction-result.tsx` and the editor header).
- **One-level undo for delete** — done (`src/features/menu/undo.ts`, wired
  into the editor; restores a deleted item/category, invalidated by any
  unrelated edit; `tests/menu-undo.test.ts`).
- **Category/item search box** — done (`src/features/menu/search.ts`, search
  bar in `menu-editor.tsx`; filters items by name/description and shows
  matching categories with counts; `tests/menu-search.test.ts`).
- **Multiple menu images/pages** — done (up to 4 pages per request, sent
  together and merged server-side: `image-constraints.ts`, AI prompt
  `src/lib/ai/prompts.ts`, `extract-client.ts`; page thumbnails/reorder/remove
  in the upload UI; `tests/image-constraints.test.ts`,
  `tests/extract-menu-service.test.ts`).
- **Duplicate item detection with a review action** — done
  (`src/features/menu/duplicates.ts`; review panel in `menu-editor.tsx` with
  per-copy confirmed delete + undo or "Keep all" dismissal remembered per
  document in localStorage; row badges; `tests/duplicates.test.ts`).
- **Bulk category reassignment** — done (`moveItemsToCategory` in
  `menu-utils.ts`; item checkboxes + bulk bar in `menu-editor.tsx`,
  document order preserved; tests in `tests/menu-utils.test.ts`).

Remaining, in priority order:

1. **Optional description cleanup** — separate, explicitly-invoked rewrite of
   descriptions; must stay clearly distinct from faithful extraction and
   preserve the original text.
2. **Optional language selection/translation** — always preserve original
   text alongside any translation.

Nothing here blocks shipping P0. The newly delivered P1 items are verified
in the local dev app (browser-tested plus unit tests); re-verify them in the
deployed app after the next deploy.

## Post-P1 UI polish

- **Category carousel** — the editor's categories now default to a
  one-at-a-time view behind a horizontally scrolling chip carousel (name +
  item count, arrow-key navigation, chips filtered by search), with a
  toggle back to the legacy all-categories stack remembered in
  localStorage. The chip row sticks to the top of the viewport while
  editing long categories (`src/components/menu-editor/menu-editor.tsx`).

## Customer preview — parked ideas

Delivered first: a **Preview menu** toggle in the editor renders the live
document as a clean customer-facing view — availability, variants, options
and dietary labels, no review chrome, unset prices shown as an em dash, and
a "not published" label so it never reads as a hosted page
(`src/components/menu-editor/menu-preview.tsx`,
`src/features/menu/preview-utils.ts`, `tests/menu-preview.test.ts`).
Ideas to revisit after that foundation:

- **Menu themes** — a few branded styles (café, bistro, takeaway) so owners
  see the menu matching their look.
- **Phone/QR mockup framing** — render the preview inside a phone frame to
  show the customer's mobile view (QR code generation stays out of scope).
- **Print stylesheet / PDF export** — print the preview for the counter,
  alongside the existing JSON/CSV exports.
- **Side-by-side editing** — form + live preview in parallel now that the
  editor canvas is wide (`max-w-6xl`).

## local/ sandbox convention (untracked)

- `local/samples/menus/` — test images (`cafe-clean-01.jpg`-style names).
- `local/scratch/` — throwaway experiments and repro files.
- `local/notes/` — personal working notes (project docs live in the repo).
- Keep the root clean; if a fresh clone would need it, it belongs in the repo.
