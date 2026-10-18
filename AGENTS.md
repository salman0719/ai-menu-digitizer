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

If a gate fails, fix the cause. Do not skip tests, weaken assertions, swallow
errors, or add lint/type suppressions just to make checks pass.

## Stack rules

- Next.js App Router + TypeScript strict + Tailwind CSS.
- Zod for AI output, stored records, and imported files.
- Gemini API only via server-side route (`src/app/api/extract-menu/route.ts`).
  Key lives in `GEMINI_API_KEY` (server only). Never use `NEXT_PUBLIC_` for secrets,
  never ship the key in client bundles or logs.
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
- `src/features/menus/` — Step 8 server menus: `repo.ts` (tenancy-scoped,
  conditional-UPDATE `updatedAt` conflict detection), `sync.ts` (typed
  browser client with `SyncError` codes), `move-to-account.ts` (one-way
  local import); routes in `src/app/api/menus/`; editor UI in
  `src/components/menu-editor/conflict-banner.tsx` + `move-to-account-panel.tsx`
- `tests/helpers/pg-test-db.ts`, `tests/tenancy.test.ts`,
  `tests/auth-magic-link.test.ts` — Step 7 isolation/auth tests (PGlite);
  `tests/menus-repo.test.ts`, `tests/menus-api.test.ts`,
  `tests/menus-sync.test.ts`, `tests/move-to-account.test.ts` — Step 8
  (PGlite + stubbed fetch; conflict, tenancy, import fidelity)
- `src/features/publishing/` — Step 9 publish: `schema.ts` (slug rules +
  publication status), `slug.ts` (deterministic slug generation and
  collision candidates), `repo.ts` (snapshot revisions, publish/unpublish,
  slug changes, public read path, view counter), `client.ts` (typed browser
  client). Routes: `src/app/api/menus/[menuId]/publication/` and
  `src/app/api/m/[slug]/view/`. Public page `src/app/m/[slug]/page.tsx`
  (partial prerender; snapshot only) + `not-found.tsx`; editor UI
  `src/components/menu-editor/publish-panel.tsx`, view beacon
  `view-counter.tsx`. Tests: `tests/publishing-slug.test.ts`,
  `tests/publishing-repo.test.ts`, `tests/publishing-api.test.ts`.
  Invariant: the public page renders `menu_revision`, never `menu.doc`, so
  edits stay private until "Publish changes".
- `PHASE-2.md` — Phase 2 scope, service choices, acceptance criteria
- `ROADMAP.md` — current build order (Phase 1 steps done, Phase 2 steps planned)

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
