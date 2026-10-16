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

## Decisions

- **No shadcn/ui** (user decision). Tailwind primitives + small local
  components only.
- **No P1 features** until P0 acceptance passes.

## Things needed from the user (later, not now)

- [x] `GEMINI_API_KEY` — in `.env.local` (live extraction tested at Step 5)
      and in Vercel project env vars (production extraction verified at deploy).
- [x] GitHub remote URL — `https://github.com/salman0719/ai-menu-digitizer.git`.
- [x] Vercel project setup — imported from GitHub, production verified 2026-10-16.
- [x] Sample menu images — collected in `local/samples/menus/`
      (clean: `cafe-board-clean-01.jpg`; difficult: `vintage-menu-01.png`).

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
