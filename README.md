# Eateryo

> Previously "Tablepass" and, in Phase 1, "AI Menu Digitizer" — renamed to
> Eateryo on 2026-10-22, since the product now covers more than digitizing
> alone. Some internal identifiers (the IndexedDB database name, the Git
> remote) still carry the old name so existing data and remotes keep
> working.

Upload a photo or scan of a menu, extract it into structured categories and
items with Gemini, review and correct the draft in an editable workspace,
preview it in themed menus, take table orders, and export JSON/CSV any time.
AI output is a draft — the app flags anything
uncertain for review and never invents missing prices, descriptions, or
dietary labels.

Menus are stored in your browser (IndexedDB) — no account required, and
nothing leaves your device except extraction. Signed in, the same menus live
on a Neon Postgres server and sync across devices.

**Current stage:** Phase 2 Steps 7–11 are built on the `staging` branch and
locally verified against Neon (magic-link sign-in, server menus, one-click
publishing, cross-device table ordering, and the free-launch packaging).
Production still runs the Phase 1 local-first prototype — nothing is deployed
yet, and the product is free end to end (no checkout, no card, no plans).
Before the free launch opens, what's left is the deploy, the open items in
`docs/launch-runbook.md` (verified Resend sending domain, contact address,
Sentry project, promotion dates), and onboarding one real café. The B2B
extraction API and usage billing are parked (Steps 12–13).

## Stack

- Next.js (App Router) + TypeScript strict + Tailwind CSS
- Zod for validating AI output, stored records, and imported files
- Gemini (default) and Groq for extraction, called only through the server
  route `POST /api/extract-menu`, with automatic failover between them
- Native IndexedDB for menus and image blobs (no wrapper library) — the
  signed-out store and the signed-in offline cache
- Neon Postgres + Drizzle for the server database; migrations are generated
  offline and applied explicitly, never at request time
- Better Auth magic-link sign-in (owners and staff) with Resend email
- Vitest for unit tests

## Local setup

Requirements: Node.js 22 (see `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # then add your Gemini API key
npm run dev                  # http://localhost:3200
```

Without an API key the app still starts and runs: extraction reports that no
key is configured and offers a clearly labelled **demo mode** built from
sample data, so the editor, persistence, and export can all be exercised.

### Environment variables

| Variable             | Where             | Purpose                                                           |
| -------------------- | ----------------- | ----------------------------------------------------------------- |
| `GEMINI_API_KEY`     | Server only       | Gemini API key. One of the two extraction vendors.                 |
| `GROQ_API_KEY`       | Server (optional) | Groq API key. Adds Groq (faster/cheaper) and failover.             |
| `GEMINI_MODEL`       | Server (optional) | Model override; defaults to `gemini-3.5-flash-lite`.              |
| `GROQ_MODEL`         | Server (optional) | Model override; defaults to `qwen/qwen3.8-27b`.                    |
| `AI_PROVIDER`        | Server (optional) | Vendor tried first: `gemini` (default) or `groq`.                 |
| `AI_FALLBACK_PROVIDER` | Server (optional) | Fallback vendor; unset = the other configured vendor, `none` = no failover. |
| `DATABASE_URL`       | Server (optional) | Neon Postgres URL. Absent = local-only mode.                      |
| `BETTER_AUTH_SECRET` | Server only       | Better Auth secret; generate with `openssl rand -base64 32`.      |
| `BETTER_AUTH_URL`    | Server            | App base URL (local `http://localhost:3200`; prod = site URL).    |
| `RESEND_API_KEY`     | Server only       | Resend key for sign-in and invitation emails (sandbox sender until a verified domain exists). |
| `EMAIL_FROM`         | Server only       | Verified sending address for sign-in mail.                        |
| `OPS_ALERT_EMAIL`    | Server only       | Inbox for failure and volume alerts (Step 11).                    |
| `CONTACT_EMAIL`      | Server            | Address shown on `/privacy` and `/terms`; unset renders an explicit notice. |
| `CRON_SECRET`        | Server only       | Bearer secret for the on-demand purge at `/api/cron/retention`. |
| `EXTRACTION_MONTHLY_CAP` | Server (optional) | Per-account monthly extraction cap (default 150).             |
| `GEMINI_INPUT_USD_PER_MTOK`, `GEMINI_OUTPUT_USD_PER_MTOK` | Server (optional) | Enables cost for Gemini calls in the spend panel; unset means those calls are unpriced. |
| `GROQ_INPUT_USD_PER_MTOK`, `GROQ_OUTPUT_USD_PER_MTOK` | Server (optional) | The same, for Groq calls. Each vendor is priced with its own rates. |
| `ORDER_RETENTION_DAYS` | Server (optional) | Order history window used by the purge when it is run (default 90). |

Rules enforced by the code:

- The key is read only in server-side code (`.env.local` locally, Vercel
  project environment variables in deployment).
- Never expose it via a `NEXT_PUBLIC_` variable, the client bundle, or logs.
- `.env.local` is gitignored — never commit real keys.
- Provider errors, credentials, and stack traces are never returned to the
  browser; the API responds with `{ error: { code, message } }` only.
- Uploaded images are processed in memory and never stored server-side.
- Magic links are never logged in production (dev prints them to the server
  console only when `RESEND_API_KEY` is absent, clearly labelled).
- Personalized API responses are sent with `Cache-Control: no-store`.

## Scripts

```bash
npm run dev          # dev server on port 3200
npm run build        # production build
npm run start        # serve the production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit (strict)
npm run test         # Vitest unit tests (single run)
npm run test:watch   # Vitest watch mode
npm run format       # Prettier write
npm run format:check # Prettier check (no writes)
npm run db:generate  # generate a SQL migration from the schema (offline)
npm run admin:restaurant -- list   # inspect/rename/delete a dev restaurant row
                                    # (scripts/restaurant-admin.mjs; needs DATABASE_URL)
npm run db:migrate   # apply migrations to DATABASE_URL (explicit, never at request time)
npm run secrets:check  # after build: fail if a server secret reached the client bundle
```

## Accounts, publishing, and ordering (Phase 2 — built on `staging`, locally verified)

Steps 7–11 are complete in code and proven against Neon locally: magic-link
sign-in → session → restaurant → server menus → published public page →
cross-device table ordering, plus the free-launch packaging. What's left
before a public launch is the deploy plus the open items in
`docs/launch-runbook.md` (Sentry project, verified sending domain, contact
address, promotion dates):

- **Sign-in** — `/sign-in` sends a one-time magic link (Better Auth, implicit
  sign-up) for owners and staff only; diners and public menu visitors stay
  anonymous. Sessions last 30 days, rolling. Requires `BETTER_AUTH_SECRET`.
- **Team** — the owner invites staff by email (one-time, hash-only tokens),
  and the settings page lists the team with an audit trail of member
  changes; staff can work the order board but not publish, delete, or bill.
- **Schema** — `src/lib/db/schema.ts` holds the Better Auth core tables plus
  `restaurant` / `restaurant_membership` (owner|staff, unique per pair),
  `menu` / `menu_revision` / `published_menu`, and `order` / `order_line`;
  migrations live in `drizzle/`, generated with `npm run db:generate`.
- **API** — restaurants, menus, publishing, and orders APIs behind a session
  guard; ownership is enforced in `src/features/tenancy/repo.ts` using only
  the session user id, and diners resolve prices server-side from the
  published snapshot (never a client-supplied total).
- **Ordering** — a diner orders from `/r/<restaurant>/m/<menu>/order?table=<n>`
  on any phone; the staff board (~5 s polling, visible reconnect state)
  receives it on every signed-in device. Opening hours are judged in the
  restaurant's own time zone, and the Tables tab prints one QR per table.
- **Launch packaging** — `/launch` runs the free onboarding checklist,
  privacy and terms pages say what is actually stored, structured logs +
  email ops alerts are in, and per-account extraction caps are the cost
  brake. Owners can export everything or delete their account.
- **Until `DATABASE_URL` exists** the app behaves exactly as before:
  local-only, sign-in reports that sync is unavailable, nothing breaks.
- Covered by the PGlite-backed suites in `tests/`, which run the real
  generated migrations on an in-process Postgres.

## How it works

1. **Upload** — drag-and-drop or file picker; JPEG/PNG/WebP validated on both
   client and server, with size limits and clear error messages.
2. **Extract** — the image is sent once to `POST /api/extract-menu`, which
   calls Gemini, validates the response with Zod (one controlled repair retry),
   and returns a structured draft. With no key configured, the UI offers
   clearly labelled demo data instead.
3. **Review** — the draft opens in the editor: fix names, prices,
   descriptions, categories, variants/options, dietary labels, and
   availability; add, duplicate, delete, reorder, and move items. Uncertain
   fields carry a visible "needs review" note.
4. **Save** — edits autosave to IndexedDB (debounced; "Saving… / Saved
   locally" status). Nothing is claimed saved before the transaction succeeds.
5. **Export** — download the menu as JSON (round-trips through Import JSON)
   or as CSV (one row per item, correctly escaped).

## IndexedDB behavior

- Database `ai-menu-digitizer` — the Phase 1 name, kept unchanged so
  browsers that already hold data keep it — with a versioned schema and
  object stores for `menus`, `images` (original image blobs, stored
  optionally), and `orders` (the signed-out local order queue).
- Native browser API only — no database server, and no sync of its own:
  when signed in, server menus sync through the account API, but the
  database itself stays on this device.
- Data lives in **this browser on this device**. It does not follow you to
  other devices or browsers, and clearing site data (or browser eviction)
  removes it. **Export JSON backups of anything important.**
- Schema upgrades, quota errors, unavailable IndexedDB, and malformed or
  outdated records are handled with visible messages rather than crashes.
- `localStorage` is not used for menu data.

## Tests

`npm run test` covers the schema, menu utilities, extraction conversion,
provider error mapping, API service/validation, image constraints, the
extraction client, IndexedDB storage (via `fake-indexeddb`), and JSON/CSV
import/export escaping, plus tenancy isolation, magic-link sign-in, server
menus, publishing, ordering, extraction usage, the launch checklist, and
retention/export/deletion — the server-side suites run against an in-process
Postgres (PGlite) using the real generated migrations.

Before finishing a change, run the full gate:

```bash
npm run lint && npm run typecheck && npm run test && npm run build
npm run secrets:check   # needs the build output above
```

## Launch operations

- [`docs/launch-runbook.md`](docs/launch-runbook.md) — configuration, the
  alert drill, onboarding one café, first-week watch list.
- [`docs/two-device-test.md`](docs/two-device-test.md) — the publishing and
  ordering acceptance script, on real devices and networks.
- [`docs/backup-restore.md`](docs/backup-restore.md) — what lives in Postgres,
  the quarterly restore drill, and the bad-migration runbook.

The launch promotion is free, with no payment step anywhere; the app enforces
per-account extraction caps instead, and shows them on `/launch`.

**Parked:** automatic order purging. Scheduling needs a paid Vercel cron plan,
so `/api/cron/retention` is a secret-gated maintenance endpoint that nothing
calls on a schedule; order history simply grows until a scheduler exists. The
privacy page makes no automatic-deletion promise.

## Deployment (Vercel)

1. The repository is on GitHub and production is deployed from `main` (the
   Phase 1 prototype). The `staging` branch — Phase 2 — is not deployed
   anywhere yet.
2. Import the project in Vercel — it is detected as Next.js automatically.
3. Set `GEMINI_API_KEY` (and optionally `GROQ_API_KEY`) under
   Project → Settings → Environment Variables. Without any key the build still
   succeeds and extraction fails gracefully (demo mode still works). Setting
   both keys enables automatic failover: a quota/outage/credential failure on
   the primary vendor is retried on the other one. `AI_PROVIDER` picks which
   goes first; `AI_FALLBACK_PROVIDER=none` turns failover off.
4. Deploy. The extraction endpoint runs as a serverless Next.js route; there
   is no separate server or long-running process.
5. Verify with a real image after deploying: upload → extract → edit → reload.

Extraction requires no services beyond a `GEMINI_API_KEY` (and optionally
`GROQ_API_KEY`). The Phase 2 account features (built on `staging`, not yet
deployed) additionally need `DATABASE_URL` (Neon),
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and Resend credentials
(`RESEND_API_KEY`, `EMAIL_FROM`) before sign-in works in production, plus
the launch variables (`OPS_ALERT_EMAIL`, `CONTACT_EMAIL`, optional token
rates) described above.

## Scope

Two modes exist side by side. **Signed out**, the local-first prototype still
works exactly as before: menus and table orders live in this browser's
IndexedDB, nothing leaves the device except extraction, and the QR page says
honestly that the menu lives on the owner's device. **Signed in**, menus sync
to Postgres, publishing gives a real public page at `/r/<restaurant>/m/<menu>`, and table
orders reach every staff device through the live board.

The free launch (Steps 7–11) is built and locally verified. The B2B extraction
API and usage billing are parked by decision (Steps 12–13): nothing in the
café product charges anyone, and no card is ever requested. Scope is in
`PHASE-2.md`, build order in `ROADMAP.md`. Still out of scope: POS
integrations, delivery/booking, inventory, and custom domains.
