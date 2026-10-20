# Free-launch runbook

The launch is advertised as **free while it lasts**, with no payment step
anywhere: no checkout, no payment link, no plan, nothing to cancel. Everything
below exists so that promise can be made honestly and operated.

Step 11's done-when: a real café goes image → live URL → first order using only
the packaged checklist, and a production failure reaches us without a user
report.

## 1. Configuration

Set these in Vercel → Project → Environment Variables (production, and preview
where useful). Secrets stay server-side; none of them may be `NEXT_PUBLIC_`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Extraction via Gemini. |
| `GROQ_API_KEY` | optional | Extraction via Groq, and failover when the primary vendor is rate-limited or down. `AI_PROVIDER` chooses the primary (default `gemini`); unset `AI_FALLBACK_PROVIDER` means the other configured vendor, `none` disables failover. |
| `DATABASE_URL` | yes | Neon Postgres. |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | yes | Magic-link sessions. |
| `RESEND_API_KEY`, `EMAIL_FROM` | yes | Sign-in email and ops alerts. |
| `OPS_ALERT_EMAIL` | yes | Where failure/volume alerts land. Without it, alerts only reach the logs. |
| `CONTACT_EMAIL` | yes | Shown on the privacy and terms pages. |
| `GEMINI_INPUT_USD_PER_MTOK`, `GEMINI_OUTPUT_USD_PER_MTOK` | recommended | Enables cost for Gemini calls in the spend panel. |
| `GROQ_INPUT_USD_PER_MTOK`, `GROQ_OUTPUT_USD_PER_MTOK` | recommended with Groq | Same for Groq. A vendor without both rates leaves its calls unpriced, so the panel reports the month's cost as unavailable rather than a partial sum. |
| `EXTRACTION_MONTHLY_CAP` | optional | The per-account cost brake (default 150/month). |
| `ORDER_RETENTION_DAYS` | optional | Order history window (default 90). |

### PARKED: automatic order retention

Nothing purges orders on a schedule. Vercel cron needs a paid plan, so the
schedule was removed and no copy promises automatic deletion. The plumbing is
intact for the day a scheduler exists — run it by hand with
`Authorization: Bearer $CRON_SECRET`, or point a free scheduler (external
cron service, GitHub Action, uptime pinger) at
`GET /api/cron/retention` with that header. It deletes orders older than
`ORDER_RETENTION_DAYS` (90 by default) and stale rate-limit windows, and logs
`retention.purged`. Consequences of leaving it parked: the order table grows
with real usage, and a single tenant's restore/export gets larger. Revisit
before that matters.

## 2. Prove a production failure is visible

Do this once after the first deploy and after changing alerting.

1. In a **preview** deployment, set `GEMINI_API_KEY` to an obviously invalid
   value and redeploy. If `GROQ_API_KEY` is also set, run the drill twice —
   once with `AI_FALLBACK_PROVIDER=none`, once allowing failover — so you can
   confirm both "the vendor failed" and "failover rescued it" (look for the
   `ai.provider_fallback` log line) behave as expected.
2. Run an extraction from the UI.
3. Expect: the browser shows a plain error (no key, no stack), and the ops
   inbox receives `[Tablepass] Extraction needs attention: provider_auth_failed`
   within a minute. The log line has the same `x-request-id` the response
   carries.
4. Remove the bad value and redeploy.

Second drill, for unexpected exceptions: point a preview's `DATABASE_URL` at a
host that does not resolve, then open `/launch` while signed in (or place an
order). Expect a 503 with a plain message, an `ops_alert` log line, and an
email named after the failing event.

Alerts are throttled to one per event per hour per server instance, so a
repeated failure will not flood the inbox; it also will not vanish.

## 3. Onboard one café (the packaged checklist)

Target: under ten minutes from photo to first order.

1. **Sign in** with the café owner's email. The link is single-use and expires
   in five minutes.
2. **Extract**: upload up to four menu photos. Check the review count on the
   result.
3. **Review**: open every item flagged, fill in prices the AI left empty, and
   remove anything that is not on the menu.
4. **Theme**: open Preview, pick a theme and layout.
5. **Table QR**: open Table QR, print one card per table, and tick the step in
   `/launch`.
6. **Publish**: press Publish, copy the public link, open it on a phone that
   has never seen the app.
7. **First order**: scan a table card, order one item, confirm it lands on the
   board. Run `docs/two-device-test.md` if this is the first café.

Then check `/launch`: five verifiable steps should read done, and the usage
panel should show one or two extractions against the cap.

Nothing in this flow asks for a card. If any screen does, that is a bug and the
launch must not be advertised until it is fixed.

## 4. First week watch list

- `/launch` usage: requests against `EXTRACTION_MONTHLY_CAP` per café.
- Orders per day per café (the Orders board is the source; the launch snapshot
  counts them too).
- 429s in the logs (`orders.rate_limited`, `extract.rate_limited`,
  `extract.cap_reached`) — each one should be explainable.
- `ops_alert` log lines: every one should have a follow-up.
- Nothing in the logs named `retention.*` — expected while retention is
  parked; if an external scheduler is added later, watch for
  `retention.purged` with a plausible count.

## 5. Known gaps at the time of writing

- **Error tracking vendor**: alert emails and structured logs are live; the
  Sentry project from PHASE-2 §7 does not exist yet, so there is no third-party
  error dashboard. Add the DSN and SDK before scaling the promotion.
- **Sending domain**: sign-in mail still uses Resend's sandbox sender, which
  only delivers to the account owner's address. Verify a domain before
  onboarding a café that is not you.
- **Custom domains** are out of scope; the public menu lives on the app's
  domain.
