# AGENTS.md — Instructions for coding agents

This file is the single source of truth for automated contributors.
Read it before making any change.

## Project

AI Menu Digitizer — see `PLAN.md` for mission, stack, and the Phase 1
acceptance criteria, and `PHASE-2.md` (scope) + `ROADMAP.md` (build order)
for the current phase.

Product name: **Tablepass** (temporary, decided 2026-10-18). "AI Menu
Digitizer" was the Phase 1 name — keep it only where historical context
demands it; all user-facing copy uses Tablepass.

Phase 1 (the local-first P0/P1 prototype) is complete and deployed.
Phase 2 — accounts, a server DB, cross-device table ordering, one-click
public menu publishing, and a usage-billed B2B extraction API — is scoped
in `PHASE-2.md`. Work follows `ROADMAP.md` step by step: auth, billing, a
remote DB, and public publishing are allowed **only when a roadmap step
schedules them**, and nothing outside `PHASE-2.md`'s scope.

## Critical commit rules

- NEVER add "Co-authored-by", "Co-Authored-By", "Generated with", "Generated-by",
  or any AI attribution trailer or line to any commit message, PR description,
  or code comment. This is a hard rule with no exceptions.
- Keep commits small, focused, and easy to review.
- Do not commit secrets. Never commit `.env.local` or any real API key.

## Workflow

- Inspect the repo before overwriting working code.
- Keep one canonical menu schema (`src/features/menu/schema.ts`). Do not invent
  competing types. Agents B/C/D consume Agent A's schema.
- Prefer editing existing files over creating new ones.
- Match existing conventions (App Router, TypeScript strict, Tailwind).
- Do NOT add shadcn/ui (user decision). Use Tailwind + small local primitives.
- Do not add dependencies unless they materially reduce effort or improve reliability.

## Quality gates (run before finishing)

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run secrets:check` (after the build: fails if a server secret reached
  the client bundle; prints env names, never values)

If a gate fails, fix the cause. Do not skip tests, weaken assertions, swallow
errors, or add lint/type suppressions just to make checks pass.

## Stack rules

- Next.js App Router + TypeScript strict + Tailwind CSS.
- Zod for AI output, stored records, and imported files.
- Image extraction vendors (Gemini, Groq) only via the server-side route
  (`src/app/api/extract-menu/route.ts`). Keys live in `GEMINI_API_KEY` /
  `GROQ_API_KEY` (server only). Never use `NEXT_PUBLIC_` for secrets, never
  ship a key in client bundles or logs.
- Native IndexedDB for menus + image blobs. localStorage only for tiny prefs.
- Vitest for unit tests.
- Phase 2 rules (when a roadmap step schedules them): server DB and auth per
  `PHASE-2.md` §3.3; Zod-validate every server boundary; never trust
  client-supplied totals or ownership ids; API keys hashed, shown once,
  revocable; usage recorded in our own ledger; secrets server-side only.
  Migrations are generated offline (`npm run db:generate`) and applied only
  explicitly (`npm run db:migrate`) — never at request time; `drizzle/` is
  generated output, never hand-edited. Sign-in is Better Auth magic link
  only (`PHASE-2.md` §3.6); server files never ship to client bundles.

## AI extraction honesty

- Never invent prices, descriptions, dietary labels, or ingredients. Use `null`/empty.
- Uncertainty goes in `reviewNotes`. Demo/mock data must be clearly labelled as demo.
- Server must not leak provider errors, credentials, or stack traces to the browser.

## File map

- `src/features/menu/schema.ts` — canonical Zod schema + types (Agent A owns)
- `src/features/menu/menu-utils.ts`, `types.ts` — IDs, ordering, edit helpers
- `src/lib/ai/` — provider wrapper, prompt (Agent C owns, server-only)
- `src/app/api/extract-menu/` — API route (Agent C owns)
- `src/components/menu-editor/`, `src/features/menu/indexeddb.ts`,
  `storage.ts`, `import-export.ts` — editor + persistence (Agent D owns)
- `src/components/tables/restaurant-tables.tsx` — the signed-in Tables tab:
  restaurant picker for owners and staff; one QR per table, scoped to the
  restaurant (`/r/<slug>/t/<label>`), never to one menu.
  `table-qr-panel.tsx` is shared with the menu editor, where it survives only
  as the browser-only menu fallback.
- `src/components/upload/`, layout — shell + upload (Agent B owns)
- `tests/` — schema, utils, import-export, route tests
- `src/lib/db/`, `drizzle/` — Drizzle schema + lazy Neon client; generated
  migrations (do not hand-edit `drizzle/`)
- `src/lib/auth/`, `src/lib/auth-client.ts`, `src/app/api/auth/`,
  `src/app/sign-in/` — Better Auth magic-link config, email sender, route,
  session guard, sign-in page
- `src/features/tenancy/repo.ts`, `src/app/api/restaurants/` —
  ownership-scoped restaurant repository + API (session id only);
  `src/features/tenancy/client.ts` — typed browser client for it
- `src/features/tenancy/invitations.ts`, `invite-mailer.ts`,
  `src/app/api/invitations/`, `src/app/invitations/[token]/` — one-time
  email invitations: hash-only tokens, email-match accept, 7-day expiry,
  and the owner's pending list with resend/revoke
- `src/features/tenancy/audit.ts`, `audit-format.ts`,
  `src/app/api/restaurants/[restaurantId]/audit/` — team audit trail:
  snapshot actor/target names, member-scoped reads (404 across tenants),
  best-effort writes; UI in `src/components/settings/team-activity.tsx`
- `src/features/menus/` — Step 8 server menus: `repo.ts` (tenancy-scoped,
  conditional-UPDATE `updatedAt` conflict detection), `sync.ts` (typed
  browser client with `SyncError` codes), `move-to-account.ts` (one-way
  local import, one menu or the whole library); routes in
  `src/app/api/menus/`; editor UI in
  `src/components/menu-editor/conflict-banner.tsx` + `move-to-account-panel.tsx`
- `tests/helpers/pg-test-db.ts`, `tests/tenancy.test.ts`,
  `tests/auth-magic-link.test.ts` — Step 7 isolation/auth tests (PGlite);
  `tests/menus-repo.test.ts`, `tests/menus-api.test.ts`,
  `tests/menus-sync.test.ts`, `tests/move-to-account.test.ts` — Step 8
  (PGlite + stubbed fetch; conflict, tenancy, import fidelity)
- `src/features/publishing/` — Step 9 publish: `schema.ts` (slug rules +
  publication status + `publicationPath`), `slug.ts` (deterministic slug
  generation and collision candidates), `repo.ts` (snapshot revisions,
  publish/unpublish, slug changes, scoped public read path, view counter),
  `client.ts` (typed browser client). Menu slugs are scoped per restaurant:
  the canonical address is `/r/<restaurant>/m/<menu>`, and the old global
  `/m/<slug>` links 308-redirect from `src/proxy.ts`. Routes:
  `src/app/api/menus/[menuId]/publication/`,
  `src/app/api/r/[restaurantSlug]/m/[menuSlug]/view/`, public page
  `src/app/r/[restaurantSlug]/m/[menuSlug]/page.tsx` (partial prerender;
  snapshot only); `src/app/m/[slug]/` keeps only the honest 404 fallback +
  `not-found.tsx`. Editor UI `src/components/menu-editor/publish-panel.tsx`,
  view beacon `view-counter.tsx`. Tests: `tests/publishing-slug.test.ts`,
  `tests/publishing-repo.test.ts`, `tests/publishing-api.test.ts`,
  `tests/legacy-redirect.test.ts` (proxy).
  Invariant: the public page renders `menu_revision`, never `menu.doc`, so
  edits stay private until "Publish changes".
- `src/features/orders/` — Step 10 table orders: `schema.ts` (canonical
  order schema, the status transitions, totals), `repo.ts` (server-only:
  snapshot-priced placement, membership-scoped board + cursor, conditional
  status writes, fixed-window rate limit), `client.ts` (typed browser client),
  `storage.ts` + `table-links.ts` (Phase 1 local queue + link helpers).
  Routes: `src/app/api/orders/` (public POST, staff GET) and
  `src/app/api/orders/[orderId]/` (PATCH). Diner page
  `src/app/r/[restaurantSlug]/m/[menuSlug]/order/page.tsx` (snapshot only,
  noindex; `/m/<slug>/order` redirects there) with
  `src/components/order/` (`order-menu.tsx` shared UI, `server-table-order.tsx`,
  `table-order.tsx` for local mode); staff board
  `src/components/orders/server-orders-board.tsx` (5 s polling with backoff
  and a visible reconnect state) behind the session switch in
  `orders-board.tsx`. Tests: `tests/orders-repo.test.ts`,
  `tests/orders-api.test.ts` (PGlite + real handlers).
  Invariants: a diner sends ids/variants/quantities only — names, prices, and
  totals are resolved server-side from the published snapshot and the total
  is null when any line is unpriced; statuses only move forward.
- `tests/invitations.test.ts`, `tests/invitations-api.test.ts`,
  `tests/audit.test.ts`, `tests/audit-api.test.ts` — invitation and team
  audit coverage (PGlite; the emailed token is captured and reused).
- `src/lib/observability/` — Step 11 structured logs (`log.ts`: JSON lines,
  request ids, credential redaction, no stacks) and operator alerts
  (`alerts.ts`: Resend email to `OPS_ALERT_EMAIL`, deduped per process)
- `src/proxy.ts` — Next 16 proxy that mints/echoes `x-request-id`; not an
  authorization layer
- `src/lib/http/origin.ts` — same-origin guard (`rejectCrossOrigin`) used by
  every state-changing route; `next.config.ts` carries the security headers
- `src/features/usage/` — Step 11 extraction ledger + cost brake: `schema.ts`
  (cap, month window), `pricing.ts` (cost only from configured rates),
  `repo.ts` (record/summarize/count), `client.ts`; `src/app/api/usage/`
- `src/features/launch/` — onboarding snapshot (`repo.ts`), pure checklist
  derivation (`steps.ts`), schemas + client; `/api/launch`, page `/launch`,
  UI in `src/components/launch/` (checklist, usage panel, data controls)
- `src/features/retention/` — Step 11 retention: `schema.ts` (window config),
  `repo.ts` (`purgeOldOrders`, `buildAccountExport`, `deleteAccountForUser`,
  `isCronAuthorized`), `client.ts`; routes `/api/account` (DELETE),
  `/api/account/export`, and `/api/cron/retention` (secret-gated maintenance
  purge — **automatic scheduling is parked**: no `vercel.json` cron, nothing
  calls it daily, and no copy promises automatic deletion)
- `src/app/privacy/`, `src/app/terms/`, `src/lib/site.ts` — legal pages and
  shared site constants (`CONTACT_EMAIL` lookup)
- `scripts/check-client-secrets.mjs` — client-bundle secret scan
- `docs/` — launch runbook, two-device test script, backup/restore drill
- `PHASE-2.md` — Phase 2 scope, service choices, acceptance criteria
- `ROADMAP.md` — current build order (Phase 1 steps done, Phase 2 steps planned)

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
