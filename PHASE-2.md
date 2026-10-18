# PHASE-2.md — Going live: accounts, ordering backend, B2B API, paid pilot

Status: **scoping, not started.** Written 2026-10-18 on branch
`docs/phase-2-scope` (based on `feat/table-ordering`).

Phase 1 (the `PLAN.md` P0/P1 prototype) is shipped and deployed on Vercel:
local-first menus in IndexedDB, Gemini extraction through a server route, an
editable workspace, JSON/CSV import-export, a themed customer preview, and
table ordering that lives entirely in one browser (QR page + local staff
board). This document scopes Phase 2, where the app stops being a demo and
becomes something unrelated people can sign up for, use on two devices at
once, and pay for.

Build order lives in `ROADMAP.md` (Step 7+). This document is the _what and
why_; the roadmap is the _when_.

## 1. The three bets

| #   | Initiative                                  | One line                                                            | Buyer                      | Size | Risk |
| --- | ------------------------------------------- | ------------------------------------------------------------------- | -------------------------- | ---- | ---- |
| I1  | Hosted backend (accounts + server DB)       | A customer's phone and the owner's device see the same order stream | Café owner (through pilot) | L    | Med  |
| I2  | B2B extraction API with usage-based billing | Sell menu digitization as an API to POS resellers and agencies      | Reseller/agency developer  | L    | High |
| I3  | One-click publish to a real public URL      | An extracted menu is live at a shareable link in under a minute     | Café owner (paid pilot)    | M    | Low  |

They are not three parallel projects. They share one platform (accounts, a
server DB, tenancy) and can be sold as one thing:

- **The paid pilot = I1 + I3.** A café pays for a hosted menu at a public URL
  with QR table ordering that syncs to the owner's board. That is the whole
  pilot product; neither half is worth paying for alone.
- **I2 is a separate product line** with a different buyer, a different
  support burden, and its own pricing. It reuses the platform layer
  (accounts, API keys, metering, billing) but must not distort the café app.

### Adjustments made while scoping (vs. the original three bullets)

1. **Platform first, pilot second, B2B third.** All three initiatives need
   accounts + a server DB, so that is one shared step, not three. Selling the
   pilot first (I1+I3) produces revenue and real usage data before the B2B
   line needs pricing decisions. Doing I2 first would mean inventing a price
   with no measured cost per extraction.
2. **Measuring real cost per extraction is a work item.** Usage-based pricing
   cannot be set before we know what a Gemini call costs per page-image (and
   what fraction of calls need the repair retry). This is a Step, not an
   assumption.
3. **"Make it live" hardening is in scope.** Accounts + public endpoints +
   a server DB means abuse control, rate limits, retention/deletion, privacy
   terms, error tracking, and backups become real requirements, not polish.
   Section 7.
4. **Customers stay anonymous.** Only owners and staff get accounts. A
   diner ordering at a table never signs up — one less conversion step for
   the pilot and no customer PII to worry about.
5. **Local-first mode is not deleted.** Anonymous use of the prototype keeps
   working exactly as today. The server is an upgrade path (\"move my menus
   to my account\"), never a forced migration.

## 2. Recommended sequence

```text
M0  Foundation        accounts, tenancy, server DB, migrations, staging      (I1/I2/I3 shared)
M1  Publish MVP       one-click publish -> public URL, themes, QR            (I3 core)
M2  Live ordering     orders API, live staff board, public table links       (I1 done)
M3  Pilot running     packaging: price, payment link, terms, onboarding      (I3/I1 shipped + sold)
M4  B2B API beta      extraction API + key dashboard, metering, billing      (I2)
M5  Harden            observability, rate limits, retention, backup pass     (all)
```

M1 before M2 deliberately: publishing a menu needs the DB but no ordering
sync, so the first café-visible win lands early and de-risks the tenancy
model before the harder realtime-ish work. M5's concerns are also built into
each step — M5 is a verification pass, not the first time we think about
security.

## 3. Foundation — shared platform (M0)

### 3.1 Tenancy model

One owner account can belong to one or more restaurants. Everything hangs off
the restaurant (tenant), never off a user id directly:

```text
account ──< membership(role: owner|staff) >── restaurant
                                              ├──< menu ──< menu_revision (published snapshots)
                                              │        └──< published_menu (slug, live revision, theme)
                                              │        └──< table (label, active)
                                              ├──< order ──< order_line   (snapshot of menu at order time)
                                              └──< api_key ──< usage_event (I2; may be org-level)
```

- Roles start at two: `owner` (everything, billing, keys) and `staff` (order
  board: read orders, change status; no billing, no API keys).
- Order rows keep the existing Phase 1 snapshot semantics (names, variants,
  prices copied at order time; total derived, `null` when any line is
  unpriced). Server recomputes totals — never trust a client total.
- `menu_revision` is what "published" points at, so an edit never silently
  changes the public page.

### 3.2 Keep one canonical schema

Menus and orders stay Zod-validated at every boundary (`src/features/menu/schema.ts`,
`src/features/orders/schema.ts`). The DB is a persistence detail: rows are
read back through the same Zod schemas, so a malformed row fails loudly
rather than rendering garbage. New Phase 2 entities (restaurant, api_key,
usage_event, published_menu) get their own Zod schemas in
`src/features/<area>/schema.ts` — no competing types, per `AGENTS.md`.

### 3.3 Service choices (researched 2026-10-18, decide before M0 starts)

| Concern   | Recommendation                                                                                                     | Why / caveats                                                                                                                                                                                                                                                                                                                                                      | Alternatives                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Server DB | **Neon Postgres + Drizzle**                                                                                        | Free tier: 100 CU-h, 1 GB; scales to zero (cold-start wake on idle). Vercel Postgres is discontinued — Vercel now points at external Postgres. Use the HTTP driver for one-shot serverless queries and a **direct** connection for migrations; with Fluid Compute, Neon recommends the pooled TCP via `attachDatabasePool`.                                        | Turso/libSQL (SQLite, generous free tier), Supabase (Free 500 MB and pauses weekly) |
| Auth      | **Better Auth** (magic-link plugin + API-key plugin)                                                               | Self-hosted, no vendor lock-in, App Router support; the API-key plugin already does create/verify/revoke/rate-limit, which I2 needs. Needs an email sender (Resend or similar) for magic links. Clerk is fastest but machine keys are paid and auth is vendor-hosted; Auth.js v5 email sign-in needs a DB adapter and the project now points users at Better Auth. | Clerk (fastest, hosted), Auth.js (familiar)                                         |
| Billing   | **Own usage ledger now, Stripe Payment Links for the pilot, Stripe Billing Meters when recurring metering starts** | Keep usage in our own DB as the source of truth; Stripe is a billing surface, not a usage store. Legacy Stripe usage records are deprecated in favour of Billing Meters; meter processing is asynchronous (invoice reporting can lag ~1 h). Prepaid credits first, metered plans later.                                                                            | Orb, Lago (only when pricing rules outgrow Stripe)                                  |

Sources: [Neon plans](https://neon.com/docs/introduction/plans),
[Neon × Vercel connection methods](https://neon.com/docs/guides/vercel-connection-methods),
[Vercel Postgres](https://vercel.com/docs/postgres),
[Drizzle + Neon](https://orm.drizzle.team/docs/connect-neon),
[Turso pricing](https://turso.tech/pricing),
[Supabase pricing](https://supabase.com/pricing),
[Better Auth magic link](https://better-auth.com/docs/plugins/magic-link),
[Better Auth API keys](https://better-auth.com/docs/plugins/api-key),
[Auth.js](https://authjs.dev/),
[Clerk machine keys](https://clerk.com/docs/guides/development/machine-auth/api-keys),
[Stripe meters vs usage records](https://docs.stripe.com/billing/subscriptions/usage-based-legacy/migration-guide),
[Stripe meter aggregation](https://docs.stripe.com/api/billing/meter/object),
[Stripe usage reporting latency](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage).

Adding these dependencies is a deliberate exception to the "no new
dependencies" rule in `AGENTS.md`: a DB driver/ORM and an auth library
materially reduce effort and risk. Record the choice here when made.

### 3.4 Migration from local data

Existing users (including the pilot café, if they tried the demo) have menus
and orders in IndexedDB. Ship an explicit **"Move my menus to my account"**
action that reads local documents and creates server copies through the same
validated API used by the editor. One-way, idempotent-ish (import by id, skip
existing), and never deletes local data. Local-only mode keeps working for
anyone who never signs in.

### 3.5 Environments and data safety

- `local` / preview / production environments; migrations run explicitly,
  never implicitly at request time. Staging = Vercel preview + a separate DB
  branch (Neon branch semantics).
- Backups: rely on the provider's PITR, plus a scheduled owner-exportable
  JSON dump of menus/orders we control.
- Secrets stay server-side (`GEMINI_API_KEY` rule unchanged); new secrets
  (DB URL, auth secret, email provider, Stripe keys) follow the same rule:
  `.env.example` placeholders, real values only in Vercel env vars.

## 4. I1 — Hosted backend: accounts + server DB for table ordering

**Outcome:** a diner orders from their phone; the owner's board shows the
order within seconds, on a different device, without either side refreshing
into stale data.

### In scope

- **P2-1 Server persistence.** Schema + migrations for restaurants, menus,
  revisions, tables, orders; repository functions that accept and return only
  Zod-validated data.
- **P2-2 Accounts.** Magic-link sign-in, restaurant creation, owner/staff
  members, session handling. Ordering endpoint stays anonymous.
- **P2-3 Server-backed menus.** When signed in, the editor reads/writes the
  server (IndexedDB remains the anonymous-mode store and an offline cache);
  conflict handling starts simple: last-writer-wins with an `updatedAt`
  check that surfaces "someone else changed this" instead of silently
  overwriting.
- **P2-4 Orders API.** `POST /api/orders` (public, rate-limited, size-limited,
  server-computed totals), `GET` board query with cursor, `PATCH` status
  transitions with server timestamps. Statuses stay the Phase 1 set
  (`new / preparing / served / cancelled`).
- **P2-5 Live staff board.** Polling (≈5 s) or SSE with backoff and visible
  reconnect state — no websockets, we stay on the Vercel serverless runtime.
  Optimistic status changes that roll back loudly on failure.
- **P2-6 Public table links.** The QR target changes from a local menu id to
  a public one (e.g. `/order?m=<menuId>&table=3` served from server data, or
  a slug under `/m/<slug>` once I3 lands). Printable cards keep working; a
  dead link says so honestly instead of silently.

### Out of scope for I1

Table-side payment/checkout, delivery, bookings, inventory, menu image blobs
in the DB (images stay client-side — extraction only needs them at upload
time), offline-first sync engine, push notifications, native apps.

### Acceptance criteria

- [ ] Cold phone (no login, cellular) opens a printed table link, sees the
      server-side menu, places an order; the owner's laptop board on a
      different network shows it within ~10 s with no manual refresh.
- [ ] Board survives a deploy/restart with no data loss; status changes from
      two devices converge sensibly (server timestamps, documented rule).
- [ ] Tenancy isolation has tests: account A cannot read or mutate
      restaurant B's menus or orders, staff role cannot reach billing/keys.
- [ ] Server rejects malformed/oversized payloads with the existing
      `{ error: { code, message } }` shape; no provider errors, keys, or
      stack traces ever reach a client.
- [ ] Totals are recomputed server-side with Phase 1 honesty: an unpriced
      line makes the total `null`, never a partial sum.
- [ ] Anonymous local-only mode still works end to end (no regression for
      users who never sign in).
- [ ] "Move my menus to my account" imports local documents intact
      (ids, order, variants, review notes).

### Risks

| Risk                                            | Mitigation                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| No websockets on serverless → board feels laggy | Polling with 5 s interval + ETag/`If-Modified-Since`; measure before adding infra.        |
| Connection pooling on serverless DB             | HTTP driver per request or pooled TCP as per §3.3; never hold a session connection.       |
| Local/server dual state gets confusing          | signed-out = local, signed-in = server; one visible storage-mode indicator; migrate once. |
| Public order endpoint gets spammed              | Rate limit per IP+table, honeypot field, payload caps, daily volume alert (§7).           |
| Menu edited while orders arrive                 | Order lines are snapshots (already in Phase 1 schema) — history is immune by design.      |

## 5. I2 — B2B extraction API with usage-based billing

**Outcome:** a reseller's backend calls our API with an API key, gets a
validated menu JSON back, and is billed per unit of usage they can audit.

### API surface (v1, sync-first)

```text
POST /v1/extract          multipart: 1–4 image pages (same limits as the app), Bearer key
GET  /v1/extract/:id      reserved for a future async mode; not in v1
GET  /v1/usage            usage events for the calling key (date range, units, request ids)
```

- **Auth:** `Authorization: Bearer <key>` where the key is shown once at
  creation, stored hashed with an id-bearing lookup prefix, revocable and
  rotatable from the dashboard. Phase 1's Gemini key never leaves the server.
- **Headers:** `Idempotency-Key` supported for POST (replay returns the stored
  result, no double billing); every response carries `X-Request-Id` that
  matches a `usage_event` row.
- **Response:** the same validated shape the app already consumes (canonical
  schema dumped to JSON), plus `usage: { units, requestId }`. Honesty rules
  unchanged: no invented prices/descriptions/dietary labels, uncertainty in
  `reviewNotes`.
- **Errors:** the existing `{ error: { code, message } }` contract with HTTP
  `401` (bad/revoked key), `402` (spend cap reached), `413` (image limits),
  `429` (`Retry-After`), `5xx` (ours, generic). Never a provider error or
  stack trace — the Phase 1 rule carries over verbatim.
- **Limits:** reuse `src/lib/image-constraints.ts` client and server rules
  (they are shared by design), per-key rate limit, per-key monthly spend cap.

### Metering and billing

- **Unit = one image page submitted successfully.** Failed requests (4xx, and
  provider failures we surface as 5xx) are **not** billed — customers only
  pay for results they received. Every unit traces to a request id.
- **Ledger is ours, in the DB:** `usage_event(key_id, request_id, units,
model, latency_ms, status, created_at)`, written idempotently per request.
  Stripe receives _aggregated_ reports; it is not the source of truth (meter
  processing is asynchronous and can lag invoice reporting by ~1 h).
- **Phase A (M3/M4): prepaid credits.** Buy N extractions, draw down the
  balance, `402` at zero. Sold via Stripe Payment Link — no checkout code in
  the app, honest and simple.
- **Phase B (post-pilot): Stripe Billing Meters.** Recurring pay-as-you-go
  with an included tier; choose aggregation deliberately (`sum` for page
  units, `count` for calls). Set up in test mode first and verify test/live
  objects are not mixed.
- **Pricing requires measured cost first:** instrument Gemini spend per
  extraction (per page, with/without repair retry) before publishing any
  number. Price = cost × margin, then sanity-check against the reseller's
  alternative (manual transcription).

### Developer experience

- A `/developers` page in the existing app: what it does, pricing, curl
  example, error codes, limits — a separate docs site is not needed for v1.
- Key dashboard under the account: create / rotate / revoke / spend cap /
  usage table (last 30 days) — same primitives the pilot uses for API keys.
- **Sandbox key** that returns a deterministic, clearly-labelled sample
  extraction (zero Gemini cost) — labelled, like demo mode in Phase 1, never
  pretending to be a live model result.

### Acceptance criteria

- [ ] An external developer can sign up, create a key, run the documented
      curl, and get a schema-valid menu JSON — no repo access, no manual
      step from us.
- [ ] Every successful call produces exactly one `usage_event`; the dashboard
      total equals the sum of request ids (test-asserted), and a Stripe
      test-mode invoice (or credit drawdown) matches it.
- [ ] Revoked/balanced-key/rate-limit paths return documented codes; a
      replayed `Idempotency-Key` bills once.
- [ ] Per-key spend caps hard-stop usage (`402`) so a leaked key cannot burn
      the Gemini quota; alerts fire on anomalous volume.
- [ ] No key, provider error, or stack trace ever appears in a client
      response or log line.

### Out of scope for I2 v1

White-label/portal branding, SDKs in other languages, webhooks, SLA/uptime
contract, batch/async jobs, on-prem or regional endpoints, storing the
customer's uploaded images, multi-tenant reseller sub-accounts. All are
phase-3 candidates once someone is paying.

## 6. I3 — One-click publish + the paid pilot

**Outcome:** an owner clicks **Publish**, gets
`https://<app>/m/<their-cafe>` that works on any phone with no login, and can
pay for that as a pilot package.

### In scope

- **Publish action in the editor:** slug generation (name-derived, suffix on
  collision, changeable), theme selection reusing the four existing preview
  themes + layouts (`src/features/menu/preview-themes.ts`), and an explicit
  **Publish changes** button. Live page = a stored `menu_revision` snapshot;
  the editor shows "draft changes not published" until it is clicked, so the
  owner is never guessing what the public sees.
- **Public page `/m/[slug]`:** read-only render of the existing preview
  components, honest empty/null handling, print stylesheet already built in
  Phase 1, `og:`/Twitter meta tags, and a QR code for the page itself (the
  `qrcode` dependency is already in the project).
- **Unpublish** (slug released or reserved — decide, defaults to reserved)
  and a plain robots/noindex control until the café wants to be found.
- **Lightweight views counter** (server-side count, no third-party tracker,
  no cookies) — a pilot café wants to see someone opened the link.
- **Ordering on the page:** once M2 lands, the published page routes to the
  table order flow for the chosen table (or shows the printed-card flow). A
  pilot café gets menu + QR ordering as one package.
- **Pilot packaging:** a fixed pilot price (decision needed, §9) sold via a
  Stripe Payment Link; an onboarding checklist (extract → review → pick theme
  → print table cards → publish → first order); a one-page "what you get"
  description. Success metrics: time-from-image-to-live-URL < 10 minutes,
  N pilot cafés live, weekly ordering activity on their boards.

### Out of scope for I3

Custom domains / per-restaurant subdomains (phase 3 — assess demand first),
new themes beyond the existing four, translations/i18n, per-item photos,
menus with multiple published variants (A/B), analytics dashboards beyond a
view count.

### Acceptance criteria

- [ ] Publish → URL opens on a phone that has never seen the app (cold,
      different network) and renders the themed menu correctly with honest
      nulls.
- [ ] Owner edits after publishing → public page unchanged, editor visibly
      says unpublished changes exist → **Publish changes** → public page
      updates.
- [ ] Unpublish → public URL stops serving (documented status); other
      slugs unaffected.
- [ ] Table cards printed from the app open the working order flow on a
      customer phone (M2), and the owner board receives the order.
- [ ] Pilot purchase (payment link) → onboarding completed by a real café,
      end to end, once, before charging a second one.

## 7. Cross-cutting: what "live and usable by anyone" forces on us

These are in Phase 2 scope because accounts, public endpoints, and a server
DB create them. Not optional polish.

- **Abuse control:** rate limits on `POST /api/orders`, `/v1/extract`;
  honeypot + volume alert on public order submission; payload caps already
  enforced by the shared image constraints; per-tenant anomaly alerts.
- **Error tracking & logs:** structured server logs with request ids,
  third-party error tracking (e.g. Sentry free tier) — today a server error
  in production is invisible to us.
- **Privacy, retention, deletion:** orders are purged after a configurable
  window (default suggestion: 90 days) so the DB does not grow forever;
  owners can export and delete their data; a privacy policy + terms page
  exist before the first paid pilot sign-up (payment providers and diners
  both expect it). We deliberately collect no diner PII — table label and an
  optional free-text note only — and say so.
- **Cost visibility:** Gemini spend per restaurant and per API key, with a
  warning threshold. This is also the data needed to price I2.
- **Security pass:** security headers, CORS scoped to the API origin,
  dependency audit, and re-verification that no secret reaches any client
  bundle (the Phase 1 rule, re-checked after adding auth/DB code).
- **E2E smoke:** keep manual two-device test scripts as the primary check;
  consider Playwright only if they become a bottleneck — it is a new
  dependency and needs justification under `AGENTS.md`.

## 8. Explicit non-goals for Phase 2

No mobile apps; no payment at the table (ordering sends a request to the
kitchen, money still changes hands at the counter); no POS integrations;
no inventory, delivery, or booking; no white-label reseller portal (the API
is the product, not a branded console); no custom domains or per-restaurant
sub-brands; no websocket/realtime infrastructure; no multi-region or
enterprise security questionnaires; no marketplace or directory listings; the
two remaining Phase 1 P1 items (description cleanup, translation) stay in the
backlog below Phase 2 revenue work.

## 9. Decisions needed from the user

| Decision                   | Recommendation                                                                  |
| -------------------------- | ------------------------------------------------------------------------------- |
| Server DB                  | Neon Postgres + Drizzle (§3.3)                                                  |
| Auth                       | Better Auth with magic links + its API-key plugin; Resend for email             |
| Billing provider           | Stripe: Payment Links for the pilot, own ledger now, Billing Meters later       |
| Pilot price                | needs a number from us — suggest pricing after M1 measures real effort per café |
| Pilot size                 | 3–5 cafés before automating any metered billing                                 |
| Public URL shape           | `/m/<slug>` on the current domain (defer custom domains)                        |
| Local vs server mode       | keep both: signed-out = local prototype, signed-in = server (recommended)       |
| Error tracking / analytics | error tracking yes (Sentry free tier); cookie-free view counts only             |
| Dependency exception       | approve DB driver/ORM + auth library as the documented `AGENTS.md` exception    |

## 10. Milestone exit criteria

| Milestone | Exit criteria                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------- |
| M0        | Migrations run in staging; sign-in works; tenancy isolation tests green; local-only mode unbroken |
| M1        | Publish → public URL verified on a stranger's phone; unpublish works; og tags + QR correct        |
| M2        | Two-device order flow passes the I1 acceptance list on real networks                              |
| M3        | One real café onboarded through the pilot checklist and has taken orders                          |
| M4        | External developer completes the I2 acceptance list in test mode, credits bought                  |
| M5        | Hardening checklist (§7) verified; incident runbook = documented first-response steps             |

`ROADMAP.md` turns these into ordered steps with checkmarks as they land.
