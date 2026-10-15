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

## Step 5 — Integrate + demo mode + README

Wire upload → extract → edit → save. Demo mode without API key.
README: setup, env vars, IndexedDB behavior, tests, Vercel deploy.
Collect sample images in `local/samples/menus/` (one clean, one difficult).

## Step 6 — Verify + polish

Full PLAN.md §11 acceptance checklist: both sample images, all error paths
(missing key, quota, bad AI JSON, bad file, oversized, empty menu, malformed
import), persistence after refresh, JSON round-trip, CSV escaping, desktop +
mobile, no key leakage, production build, Vercel config.

## Decisions

- **No shadcn/ui** (user decision). Tailwind primitives + small local
  components only.
- **No P1 features** until P0 acceptance passes.

## Things needed from the user (later, not now)

- [ ] `GEMINI_API_KEY` — needed at Step 5 for live extraction testing
      (`.env.local` locally; Vercel project env vars for deploys).
- [ ] GitHub remote URL — repo is local-only; push only when asked.
- [ ] Vercel project setup — needed at Step 6 deploy check.
- [ ] Sample menu images — optional; can drop into `local/samples/menus/`
      anytime before Step 5 (or agents fetch openly-licensed ones then).

## local/ sandbox convention (untracked)

- `local/samples/menus/` — test images (`cafe-clean-01.jpg`-style names).
- `local/scratch/` — throwaway experiments and repro files.
- `local/notes/` — personal working notes (project docs live in the repo).
- Keep the root clean; if a fresh clone would need it, it belongs in the repo.
