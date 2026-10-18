# AI Menu Digitizer

Upload a photo or scan of a menu, extract it into structured categories and
items with Gemini, review and correct the draft in an editable workspace, and
save or export the result. AI output is a draft — the app flags anything
uncertain for review and never invents missing prices, descriptions, or
dietary labels.

Local-first prototype: menus are stored in your browser (IndexedDB). No
accounts, no server database.

## Stack

- Next.js (App Router) + TypeScript strict + Tailwind CSS
- Zod for validating AI output, stored records, and imported files
- Gemini API, called only through the server route `POST /api/extract-menu`
- Native IndexedDB for menus and image blobs (no wrapper library)
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

| Variable         | Where             | Purpose                                              |
| ---------------- | ----------------- | ---------------------------------------------------- |
| `GEMINI_API_KEY` | Server only       | Gemini API key. Required for real extraction.        |
| `GEMINI_MODEL`   | Server (optional) | Model override; defaults to `gemini-3.5-flash-lite`. |

Rules enforced by the code:

- The key is read only in server-side code (`.env.local` locally, Vercel
  project environment variables in deployment).
- Never expose it via a `NEXT_PUBLIC_` variable, the client bundle, or logs.
- `.env.local` is gitignored — never commit real keys.
- Provider errors, credentials, and stack traces are never returned to the
  browser; the API responds with `{ error: { code, message } }` only.
- Uploaded images are processed in memory and never stored server-side.

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
```

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

- Database `ai-menu-digitizer` with versioned schema and object stores for
  `menus` and `images` (original image blobs, stored optionally).
- Native browser API only — no database server, no sync.
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
import/export escaping.

Before finishing a change, run the full gate:

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

## Deployment (Vercel)

1. Push the repository to GitHub/GitLab (when you choose to).
2. Import the project in Vercel — it is detected as Next.js automatically.
3. Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) under
   Project → Settings → Environment Variables. Production builds fail
   extraction gracefully without a key (demo mode still works).
4. Deploy. The extraction endpoint runs as a serverless Next.js route; there
   is no separate server or long-running process.
5. Verify with a real image after deploying: upload → extract → edit → reload.

No other services are required: no external database, auth, or file storage.

## Scope

What is live today is the local-first prototype (see `PLAN.md`): menus and
table orders live in this browser's IndexedDB, there are no accounts and no
server database. Themed customer previews and printable QR table cards are
included; on a customer's phone the QR page is honest that the menu lives on
the owner's device.

Phase 2 makes it live and usable by anyone — accounts with a server database
so ordering works across devices, one-click publish to a public menu URL,
and a usage-billed B2B extraction API. Scope is in `PHASE-2.md`, build order
in `ROADMAP.md`. Still out of scope: POS integrations, delivery/booking, and
inventory management.
