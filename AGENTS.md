# AGENTS.md — Instructions for coding agents

This file is the single source of truth for automated contributors.
Read it before making any change.

## Project

AI Menu Digitizer — see `PLAN.md` for mission, scope, stack, and acceptance criteria.
P0 first. Do not build out-of-scope items (auth, billing, remote DB, public site builder).

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

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
