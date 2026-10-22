# Two-device test script

The primary acceptance check for table ordering (Phase 2, I1), publishing
(I3), and team invitations with staff roles. Run it against the deployed app
before onboarding a café, and again after any change to ordering, publishing,
auth, team access, or the DB schema. It takes about fifteen minutes.

Use **two physically different devices on different networks**: a laptop on
wifi and a phone on cellular data. Two tabs in one browser do not exercise the
public path, and they hide network and cookie problems that a real guest hits.

## Before you start

- A signed-in owner account with one menu that has at least two priced items.
- The menu published (Eateryo → Preview → Publish).
- The phone signed out of the app entirely (use a private/incognito tab).
- A second email address whose inbox you can open on the phone — the invitee
  account. It must be different from the owner's address.
- A way to see the server logs (Vercel → Logs) and the ops inbox
  (`OPS_ALERT_EMAIL`).

## Steps

| # | Do this | Expect |
| --- | --- | --- |
| 1 | On the laptop, open **Table QR**, pick **Table 3** under **Show**, and print or display that single card. | One large QR code, the label `Table 3`, and the typed URL under it — all pointing at `/r/<restaurant>/m/<menu>/order?table=…` for that table. |
| 2 | On the phone (cellular, signed out), scan the QR. | The themed menu renders at `/r/<restaurant>/m/<menu>/order?table=3`. No sign-in prompt. Items with no price show a dash, never `$0`. |
| 3 | Add two items (one with a variant), write a short note, send the order. | A receipt code appears (e.g. `#41F563`). No account is requested. |
| 4 | Watch the laptop's **Orders** tab without refreshing. | The order appears with the right table label, items, note, and a total that equals the published prices. Target: under 10 seconds. |
| 5 | On a second signed-in device (staff), change the order to **Preparing**. | The first board shows the new status without a refresh, within about 5 seconds. |
| 6 | Put the laptop offline (airplane mode), then back online. | The board shows a visible reconnecting state, keeps the orders it already had, and returns to **Live** with no duplicates. |
| 7 | Edit the menu title on the laptop and **do not** publish. Reload the phone. | The public page still shows the old title. The editor says draft changes are not published. |
| 8 | Press **Publish changes**, reload the phone. | The new title appears; the warning clears. |
| 9 | Press **Unpublish**, reload the phone. | The page explains it is not live (not a blank page, not a fake menu). |
| 10 | Publish again. | The same slug serves the menu again; the view counter did not reset. |

## Team invite and staff roles

Run these on the same two devices, after the steps above. The laptop is the
owner; the phone becomes staff through the invitation.

| # | Do this | Expect |
| --- | --- | --- |
| 11 | On the laptop, open **Settings → Team** and add the second email address with role **Staff**. | The add field says an invitation was emailed, and the invitation appears in the team panel as pending, with **Resend** and **Revoke**. |
| 12 | Press **Resend**, then on the phone open the *older* invitation link. | The old link is refused (unknown or expired); the newly emailed link still opens the invitation page. |
| 13 | On the phone (cellular, signed out), open the new link → **Email me a sign-in link** → open that mail link. | The invitation page shows the restaurant and the invited address. Signing in returns to the same page and offers **Accept invitation**. |
| 14 | Accept the invitation, then choose **Open the order board**. | The success panel confirms staff access; the primary button opens `/orders` and the board shows the same orders as the laptop. |
| 15 | On the phone, move an order from **New** to **Preparing**. | The laptop board shows the new status within about 5 seconds. |
| 16 | On the phone, open **My menus** and open any menu of that restaurant. | The read-only preview renders with the "view-only for staff" notice. No edit, reorder, publish or delete controls are shown. |
| 17 | On the phone, open **Settings**. | Only the staff-access note appears — no rename, team controls, or danger zone. |
| 18 | Back on the laptop, remove the staff member from the team. | The phone can no longer load the board or that restaurant's menus; the board says it has no access and menus stop syncing. |
| 19 | On the laptop, invite the second address again, then press **Revoke**. | The invitation disappears from the pending list, and opening its link on the phone reports that the invitation does not exist. |

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
