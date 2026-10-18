# Two-device test script

The primary acceptance check for table ordering (Phase 2, I1) and publishing
(I3). Run it against the deployed app before onboarding a café, and again
after any change to ordering, publishing, auth, or the DB schema. It takes
about ten minutes.

Use **two physically different devices on different networks**: a laptop on
wifi and a phone on cellular data. Two tabs in one browser do not exercise the
public path, and they hide network and cookie problems that a real guest hits.

## Before you start

- A signed-in owner account with one menu that has at least two priced items.
- The menu published (Tablepass → Preview → Publish).
- The phone signed out of the app entirely (use a private/incognito tab).
- A way to see the server logs (Vercel → Logs) and the ops inbox
  (`OPS_ALERT_EMAIL`).

## Steps

| # | Do this | Expect |
| --- | --- | --- |
| 1 | On the laptop, open **Table cards** and print or display the card for table 3. | A QR code and the public link, both containing `/m/<slug>/order?table=3`. |
| 2 | On the phone (cellular, signed out), scan the QR. | The themed menu renders at `/m/<slug>/order?table=3`. No sign-in prompt. Items with no price show a dash, never `$0`. |
| 3 | Add two items (one with a variant), write a short note, send the order. | A receipt code appears (e.g. `#41F563`). No account is requested. |
| 4 | Watch the laptop's **Orders** tab without refreshing. | The order appears with the right table label, items, note, and a total that equals the published prices. Target: under 10 seconds. |
| 5 | On a second signed-in device (staff), change the order to **Preparing**. | The first board shows the new status without a refresh, within about 5 seconds. |
| 6 | Put the laptop offline (airplane mode), then back online. | The board shows a visible reconnecting state, keeps the orders it already had, and returns to **Live** with no duplicates. |
| 7 | Edit the menu title on the laptop and **do not** publish. Reload the phone. | The public page still shows the old title. The editor says draft changes are not published. |
| 8 | Press **Publish changes**, reload the phone. | The new title appears; the warning clears. |
| 9 | Press **Unpublish**, reload the phone. | The page explains it is not live (not a blank page, not a fake menu). |
| 10 | Publish again. | The same slug serves the menu again; the view counter did not reset. |

## Record the result

Note the two timings (order visible, status visible), the browser/OS on the
phone, and anything that looked wrong. If a step fails, capture the order
receipt code and the `x-request-id` response header from the failing request —
those two values are what the server logs are searchable by.

## Common failures

| Symptom | Likely cause |
| --- | --- |
| 503 on ordering with a plain message | Server DB unreachable (`DATABASE_URL`) — the logs have the cause, and an alert email should have arrived. |
| 429 on ordering | The per-minute limit for that caller; wait a minute. Repeated 429s from one address send an alert. |
| 404 on the public page | The menu is unpublished or the slug was renamed. |
| Order appears but the total is missing | At least one ordered item has no price in the published revision. That is deliberate: a partial total would be invented. |
| Board never leaves "Reconnecting" | The polling endpoint is failing; check `/api/orders` in the network tab and the server logs for the request id. |
