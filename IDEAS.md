# IDEAS.md — possible future features

Ideas we might implement later. This is a parking lot, not a plan:
`ROADMAP.md` stays the build order and `PHASE-2.md` the current scope —
an idea graduates by being scoped into those docs.

## Routing / URLs

- **Table-aware public order links** — put the selected table number in
  the public order page URL (e.g. a `?table=` param on `/r/<restaurant>/m/<menu>/order`),
  so table QR codes deep-link straight to that table's ordering page
  instead of asking the diner to pick one.
- **Refresh-proof capture flow** — persist the capture flow state in the
  URL so a refresh doesn't lose the upload step.
