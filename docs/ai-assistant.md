# Assistant operator guide

The Assistant is the signed-in help and menu-edit surface backed by Cloudflare
Workers AI. It answers questions from a curated feature list, and an owner can
point it at one of their menus to get a reviewable change proposal. It never
writes without an explicit approval, and it never publishes.

This guide covers setup, release, spend, failure copy and the A4 acceptance
results. Product scope and the A0 measurements live in the R&D folder
(`local/ai-assistant-rnd/`, not committed).

## 1. What ships

| Piece | Behaviour |
| --- | --- |
| Assistant tab | Signed-in help chat. Answers only from `src/features/assistant/capability-card.ts`; unsupported features get a refusal, missing facts a clarifying question. |
| Menu proposals | With one of the caller's menus selected, the model may return one allowlisted tool call: `add_item`, `update_item`, `set_item_availability`, `add_category`, `rename_category`, `move_item`. |
| Review | The server re-validates the operations, dry-runs them on a clone and returns a diff. The owner can edit a proposed price, approve or discard. |
| Approval | `POST /api/assistant/apply` writes the draft with `expectedUpdatedAt`; a concurrent edit is a `409 stale_menu`, never an overwrite. |
| Publishing | Untouched. The public page still renders the last published revision until **Publish changes**. |
| Spend | The launch page adds an "Assistant this month" line when the ledger has calls: messages/cap, neurons and paid-equivalent cost. |

Not in scope: deletions, promotions/discounts/campaigns, opening-hours or
restaurant-profile edits, website copy, image extraction changes, and any
autonomous change or model-driven SQL.

## 2. Configuration

All values are server-side. Never add a `NEXT_PUBLIC_` variant.

| Variable | Required | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Workers AI account. Missing → tab reports "not configured" and disables the composer. |
| `CLOUDFLARE_API_TOKEN` | yes | Token with Workers AI permission. Server only; never logged or returned. |
| `CLOUDFLARE_DEFAULT_AI_MODEL` | no | Default `@cf/zai-org/glm-4.7-flash` (the A0-verified model). |
| `ASSISTANT_MONTHLY_MESSAGE_CAP` | no | Per-account messages per UTC month; default `300`, clamped to 5,000. |
| `ASSISTANT_DAILY_CALL_CEILING` | no | Model calls per UTC day across all accounts; default `500`, clamped to 5,000. Workers AI's free allocation is shared by the account. |
| `FEATURE_FLAGS` | no | JSON release config. Unset/blank means nothing is released, but URL previews are allowed. See §4. |

`.env.example` carries the same names with comments and copy-paste examples.

### First deploy

1. Set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `DATABASE_URL` for
   the target environment, then deploy.
2. Apply migrations to **that environment's** database:
   `DATABASE_URL=<target-connection-string> npm run db:migrate`.
   Preview and production are separate Neon databases; a migration that ran
   in production does not exist in preview. Missing `assistant_usage` shows up
   as `assistant.allowance_failed` / 503 `server_db_unavailable`.
3. Sign in and open `/assistant?ff=assistantProposals` to review the shipped
   surface without releasing it.
4. Release per §4, then redeploy (or change the env var in Vercel and redeploy
   if your plan does not hot-reload environment changes).

Migrations are generated offline with `npm run db:generate` and applied only
explicitly. `drizzle/0012_living_nextwave.sql` adds `assistant_usage`; never
hand-edit files under `drizzle/`.

## 3. Cost and the cap

- The ledger row (`assistant_usage`) is written for every model attempt,
  successful or failed, because Workers AI bills both. A request refused
  before the provider (feature off, cap hit, missing config) writes nothing.
- `usage.neurons` comes from the provider. Cost is `neurons × 11 µ$` — the
  Workers Paid rate — so the spend line is the **paid-equivalent** cost, not
  an invoice. The free allocation is 10,000 neurons/day; when it is exhausted
  the provider fails and the route returns the normal unavailable message.
- The monthly cap counts ledger rows, including failed attempts. The daily
  ceiling counts rows for every account together.
- `GET /api/assistant` reports the allowance and `configured` without writing
  a row or calling the provider.
- Cost is `null` (shown as "cost unknown") when any call omitted neurons; a
  partial sum is never shown as a total.

The A0 spike measured 22 calls at p50 1.5 s / p95 3.5 s and 215 neurons total.
Compact turns cost roughly 5–11 neurons; that is why 500 calls/day is about
half the free pool.

## 4. Feature flags

Defaults when `FEATURE_FLAGS` is unset or blank:

| Flag | Default | Preview link |
| --- | --- | --- |
| `assistant` | off | `?ff=assistant` — help only |
| `assistantProposals` | off | `?ff=assistantProposals` — help plus proposals; also unlocks `assistant` |

`FEATURE_FLAGS` is one JSON object; a present value replaces the default
config. Unknown flags and invalid JSON are ignored, so a typo fails closed to
the registry defaults rather than taking the app down.

```dotenv
# one named account
FEATURE_FLAGS={"assistantProposals":{"emails":["owner@cafe.test"]}}
# everyone (proposals imply the Assistant)
FEATURE_FLAGS={"assistantProposals":{"enabled":true}}
# help only, everyone
FEATURE_FLAGS={"assistant":{"enabled":true}}
# emergency stop; proposals cannot outlive the Assistant
FEATURE_FLAGS={"assistant":{"disabled":true}}
```

Per-flag fields: `enabled` (everyone), `disabled` (hard stop), `emails`,
`userIds`, `preview` (allow `?ff=`). A preview link is a review convenience,
not authorization: ownership, tenancy, caps and same-origin checks still run
server-side. Only signed-in users see flags; a preview cookie lasts 30 days
and is cleared with `?ff=off`.

## 5. Failure copy and what to do

| Status / code | What the owner sees | Operator action |
| --- | --- | --- |
| 403 `feature_disabled` | "The assistant is not available for this account yet." | Check `FEATURE_FLAGS`; `disabled` wins. |
| 503 `assistant_not_configured` | "The assistant isn't configured on this deployment yet…" and the composer is disabled. | Set the two Cloudflare variables for this environment and redeploy. |
| 429 `assistant_cap_reached` | Used `N` of `N` messages; resets on a date. | Raise `ASSISTANT_MONTHLY_MESSAGE_CAP`, or wait for the UTC month. |
| 429 `assistant_budget_exhausted` | Shared daily limit; try after 00:00 UTC. | Expected brake on the free tier. Raise the ceiling only with paid headroom. |
| 503 `assistant_unavailable` | "Unavailable right now. Try again…" or "busy" for a vendor 429. | Check server logs for `assistant.failed` and the request id. Provider bodies stay out of the response. |
| 409 `stale_menu` | The menu changed since the preview; review a fresh proposal. | Expected conflict handling; nothing was written. |
| 400 `invalid_request` | Message length or malformed body. | Client bug; the schema is the contract. |
| 404 `not_found` | "That menu does not exist." | Cross-tenant ids are deliberately indistinguishable from missing ones. |
| 503 `server_db_unavailable` | "Server data is not available right now…" | Database unreachable or migration missing — check the **environment's** DB first. |

Missing facts are not failures: a new item without a price produces a
clarifying question, never a guessed price.

## 6. Invariants and how they are held

1. **No write without approval.** The chat route dry-runs on a clone; only
   `/api/assistant/apply` writes, and only with the previewed operations and
   `expectedUpdatedAt`.
2. **No silent clobber.** The repository's conditional update returns 409 when
   the revision moved.
3. **No cross-tenant data.** Session id only; a foreign menu id is 404.
4. **Staff are read-only.** Staff get the help surface even if they send a
   menu id; approval requires ownership.
5. **Menu content is data.** Account/menu/item text is sanitized, stripped of
   control/zero-width/bidi characters, and angle brackets are neutralized
   inside delimited blocks. The A4 corpus exercises `</menu-data>`, fake
   `<account-context>`, "ignore previous instructions", fake system turns and
   instruction-shaped ids.
6. **The tool is an allowlist.** Zod validates every operation; unknown ops
   are rejected rather than treated as no-ops; at most 12 operations per
   proposal; ids must exist in the target document.
7. **Published data is untouched.** Applying changes writes `menu.doc`; the
   public page renders `menu_revision` until the owner publishes.
8. **No secrets or provider bodies leak.** Errors are mapped to fixed copy;
   the ledger keeps only an error code; logs redact credentials and stack
   traces.
9. **The cap runs before the provider.** A cap hit cannot spend a neuron.

## 7. Tests

```bash
npx vitest run tests/assistant-*.test.ts
npm run lint
npm run typecheck
npm run test
npm run build
npm run secrets:check
```

| Test file | Covers |
| --- | --- |
| `tests/assistant-schema.test.ts` | request limits, proposal schema |
| `tests/assistant-prompt.test.ts` | capability card, path accuracy, delimiters |
| `tests/assistant-security.test.ts` | A4 injection/jailbreak corpus, unknown ids/ops |
| `tests/assistant-propose.test.ts` | tool call parsing, one repair, refusals |
| `tests/assistant-proposal.test.ts` | deterministic apply and preview |
| `tests/assistant-route.test.ts` | auth, flags, caps, tenant isolation, ledger, no writes |
| `tests/assistant-apply-api.test.ts` | approval, stale 409, staff 403, published revision untouched |
| `tests/assistant-client.test.ts` | browser client and failure mapping |
| `tests/assistant-spend.test.ts` | ledger spend summary and unpriced-cost rule |
| `tests/feature-flags*.test.ts`, `tests/features-api.test.ts` | flag evaluation and previews |

## 8. A4 acceptance results

| Draft criterion | Result |
| --- | --- |
| Owners ask practical questions about existing features | **Met in the automated suite.** The capability card carries screen-level paths and `assistant-prompt` asserts them. The five-question human walkthrough is still a launch task, not recorded here. |
| Owners request supported menu changes in natural language | **Met at the API/apply level.** Route tests cover add/update/availability; A3's UI is wired, but there is no checked-in DOM test, so the click-through remains a manual check. |
| Missing information is requested, never invented | **Met.** A price-less add becomes `clarify`; unknown category/item ids are rejected; route tests assert the menu did not move. |
| Proposed changes can be reviewed, edited, approved or discarded | **Met in code.** Server-computed diff, inline price edit, approve/discard; automated coverage is API-level, DOM behaviour is manually checked. |
| Unapproved changes never modify published data | **Met.** Applying changes the draft only; `menu_revision` is untouched; publish is separate. |
| Auth, tenancy and validation stay enforced | **Met.** 401 signed-out, 403 staff on apply, 404 cross-tenant menu, Zod at both boundaries, same-origin guard. |
| Gemini/Groq extraction unchanged | **Met.** No shared extraction interface was edited; the extraction suite stays green. |
| Runs on the Workers AI free tier | **Met for the pilot.** A0 measured 215 neurons for 22 calls; caps and the daily ceiling bound growth. The spend line is paid-equivalent, not a free-tier invoice. |
| Feature flag to disable | **Met.** Default off; named-account release; `disabled` kill switch; URL previews are review-only. |

Known limitations, reported rather than hidden:

- No checked-in DOM/component test for the review panel; API and client
  contracts are tested, the visual pass is manual.
- The A1 five-question owner walkthrough and the A3 click-through are not
  recorded in this repository.
- A preview deployment needs its own migration and its own environment
  variables; production values do not carry over.
- Deletions, promotions and opening-hours edits are intentionally absent.
