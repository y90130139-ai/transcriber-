# Phase 8 deploy — DONE 2026-09-15

Shipped. Kept as the record rather than deleted; the traps below are the ones
worth not re-learning.

- Deployment `transcriber-4vv6jbvj2-sinauraco-s-projects.vercel.app`, promoted
  by `vercel deploy --prod`. **That URL is that deployment's permanent address,
  not a new project** — there is one `transcriber` project with two aliases.
- Both aliases verified serving the new build by grepping the deployed
  stylesheet for rules that only exist in this commit (`.sheet-topbar`,
  `100dvh`, `overscroll-behavior`, `.sheet-link`):
  `transcriber-ten-zeta.vercel.app` and
  `transcriber-sinauraco-s-projects.vercel.app` (the one `config.json` points
  the Mac worker at). `--prod` moved both on its own; no manual alias needed.
- `/api/models/<id>/followers` answers **401**, not 404 — the new route is live.
- `cloud/.env.local` **byte-identical before and after**
  (`8e0d1a0e2e10…882569c`). The implicit-`env pull` trap did not fire on
  `deploy`; it was still worth checking, and still is next time.
- Migration had already run before the deploy, so the schema was ahead of the
  code rather than behind it. Nothing needed running after.
- Nothing else was touched: no retag, no relisten, no relook, no worker restart,
  no R2. None were needed — no lexicon, taxonomy, pipeline or Python change.
- Worker healthy through the whole thing (`node scripts/status.mjs`, heartbeat
  6s), and `/p/<token>` still 404s an unknown token exactly as before.

Account of what shipped: `docs/MODEL-PROFILE.md`. Commit `3bf4953`.

## Still waiting on Geno

Neither is blocked on code. Both gate the measurement half of
`docs/GAME-PLAN.md`, and the follower table shipped here is the shape the first
one lands into — until it clears, every figure in it is typed by hand.

1. **Submit the Meta app.** App Review is days to weeks and cannot be
   compressed.
2. **Check ten creators for a category label under the handle.** Five minutes.
   Decides whether competitor discovery is free or costs money.
3. **Notifications for the model portal** — waiting on his decision, not on a
   condition. His stated trigger (~5 creators) was met long ago; roster is 18.
