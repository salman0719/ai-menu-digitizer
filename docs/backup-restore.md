# Backup and restore check

Everything durable lives in Postgres (Neon): accounts, restaurants, menus,
published revisions, orders, and the extraction usage ledger. Menu images are
never stored server-side, and the signed-out prototype lives only in each
browser's IndexedDB — so there is nothing else to back up.

The point of this document is not "the provider has backups". It is to prove,
on a schedule, that the data can be read back and that the app renders it
correctly afterwards.

## What is protected, and by whom

| Data | Primary store | Backup |
| --- | --- | --- |
| Accounts, sessions | Neon Postgres | Neon history / point-in-time restore |
| Menus, published revisions, publications | Neon Postgres | same |
| Orders, usage ledger | Neon Postgres | same |
| Uploaded menu images | not stored | n/a |
| Signed-out menus | the owner's browser (IndexedDB) | JSON export, from the app |

Order history has a second, deliberate limit — currently inactive: a purge
exists for orders older than `ORDER_RETENTION_DAYS` (90 by default), but
**nothing runs it on a schedule** (Vercel cron needs a paid plan, so retention
is parked). Until a scheduler is added, orders accumulate and a restore simply
brings back everything the database held at that moment. If the purge is ever
scheduled, export before a restore would matter, because a restore does not
resurrect purged orders.

## Quarterly restore drill (about 15 minutes)

1. Pick a timestamp in the Neon console's history window for the current plan.
   Choose a time when you know an order existed.
2. Create a **branch** from that timestamp. Do not touch the production
   branch.
3. Copy the branch connection string and, **locally only**, set
   `DATABASE_URL` to it in `.env.local` (back up the old value first), then
   `npm run dev`.
4. Verify, in this order:
   - `/launch` loads the checklist and shows the expected menu count.
   - The editor opens a menu and its categories/items match what you expect.
   - `/r/<restaurant>/m/<menu>` serves the published menu (`/m/<slug>`
     redirects there).
   - The Orders tab lists the order you used as the reference point.
   - An extraction still succeeds (the cap and usage ledger are readable).
5. Restore your local `DATABASE_URL`, stop the dev server, and delete the
   branch in Neon.
6. Record the date and outcome below.

Never point the deployed production app at a restore branch: new writes would
land there and be lost with the branch.

## If a bad migration or deletion reaches production

1. Roll back the deployment in Vercel to the last good build (code rollback is
   instant and does not touch data).
2. If data was damaged, create a restore branch at the timestamp just before
   the change; verify it with the drill above.
3. Point production at the restored branch **only** after deciding what to do
   with writes made since the incident: they will not exist on the restored
   branch.
4. Fix the migration, run `npm run db:generate` offline, review the SQL, then
   `npm run db:migrate` explicitly. Migrations never run at request time.

## Single-tenant copy

An owner can download every menu, publication, and order as JSON from the
launch page (`Export my data`). That export is the right tool for a single
café leaving, or for keeping a copy before deleting an account — account
deletion is immediate and cascades to everything the account created.

## Record

| Date | Checked by | Result | Notes |
| --- | --- | --- | --- |
| | | | |
