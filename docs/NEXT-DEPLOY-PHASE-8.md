# Next: ship phase 8 (the model profile)

Written 2026-09-15. Everything is **built, verified and committed**. This is a
deploy, not a build — roughly ten minutes. The session that built it hit the
cost guard at $112.74 immediately before running `vercel deploy`, so this file
is the self-contained prompt for a fresh one.

Hand it over with: **"Read `docs/NEXT-DEPLOY-PHASE-8.md` and do it."**

---

## State before you start

- Commit **`3bf4953`** on `main`, working tree clean, **local only — no remote**.
  (Pushing anywhere is Geno's call, not a default. Don't.)
- `next build` passes.
- **The migration has already run against the live Neon database.** Additive
  only: `transcriber.models.socials` (jsonb, default `[]`) and
  `transcriber.model_followers`. Nothing existing was altered. **Do not re-run
  it expecting it to be pending** — re-running is harmless (`if not exists`
  throughout) but proves nothing.
- So the schema is **ahead of** production code right now. Nothing is broken in
  that state; the columns simply sit unread.
- The account of what was built is `docs/MODEL-PROFILE.md`. Read it if anything
  below is surprising.

## Do this

### 1. Deploy

```bash
cd ~/projects/social-transcriber/cloud
shasum -a 256 .env.local          # write this down — step 2 needs it
npx vercel deploy --prod
```

Project is `sinauraco-s-projects/transcriber`, already linked in `.vercel/`.

**The URL it prints (`transcriber-<hash>-sinauraco-s-projects…`) is that
deployment's permanent address, not a new project.** There is one `transcriber`
project with two aliases. Explain that before pasting it at Geno — he was
reasonably alarmed by it once before.

### 2. Check `.env.local` survived

```bash
shasum -a 256 .env.local
```

Must match step 1. **Some `vercel` CLI commands run an implicit `env pull` that
overwrites `cloud/.env.local` and silently drops local-only vars.** It was
observed on `vercel blob` store commands, not on `deploy`, but it costs one
command to be sure and a lost `.env.local` costs an afternoon. A backup is at
`/tmp/env.local.backup` if that machine has not rebooted; otherwise the values
are in Vercel and `vercel env pull` restores them.

### 3. Confirm the aliases point at the new build

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://transcriber-ten-zeta.vercel.app/
curl -s https://transcriber-ten-zeta.vercel.app/ | grep -c 'sheet-\|profile'
```

`--prod` normally moves the production aliases itself. If `transcriber-ten-zeta`
is still serving the old build, alias it explicitly to the deployment URL from
step 1. The other alias is `transcriber-sinauraco-s-projects.vercel.app`, which
is what `config.json` points the Mac worker at — **that one matters**, don't
leave it behind.

### 4. Look at it, signed in

Open the roster on a phone width. Four things to confirm, in order of how
annoying they'd be to miss:

1. **The panels scroll from anywhere**, including by dragging the black header.
   Try the library reader especially — the "How to rebuild this" block must
   scroll away with everything else. That was the reported bug.
2. **A model card shows a small `IG` chip** under her figures, and tapping it
   opens her Instagram in a new tab without opening the profile sheet.
3. **Tapping Edit opens a modal, not a right-edge panel.** Her accounts render
   as buttons; Close stays reachable however far you scroll.
4. **Profile → Her accounts → Add an account.** Paste any profile link. Save.
   Reopen. It should come back as a working button.

## What must NOT happen

- **No `POST /api/retag`.** Nothing in the lexicon or taxonomy changed. Running
  it re-suggests across 220 items for no reason.
- **No `./bin/relisten`, no `./bin/relook`.** No pipeline stage changed.
- **Don't restart the worker.** No Python changed. And note: killing it by PID
  makes launchd relaunch it instantly, so starting another by hand creates a
  duplicate worker *and* a duplicate tunnel that fight over the ping and produce
  HTTP 530. If it ever does need restarting the command is
  `launchctl kickstart -k gui/$(id -u)/com.geno.social-transcriber.worker`.
- **Don't touch R2.** No plan items changed.

## If it has to come off

`git revert 3bf4953`, rebuild, redeploy. The two new database objects can stay —
they are additive and nothing else reads them. `git show 3bf4953` carries the
deleted `ModelSheet.tsx` in full.

## Then, if there is room

Two things have been waiting on Geno since 2026-09-08 and both gate the
measurement half of `docs/GAME-PLAN.md`. Raise them; do not try to do them.

1. **Submit the Meta app.** App Review is days to weeks and cannot be
   compressed. The follower table shipped here is the shape Insights lands
   into — until it clears, every figure in it is typed by hand.
2. **Check ten creators for a category label under the handle.** Five minutes.
   Decides whether competitor discovery is free or costs money.

And still open, waiting on his decision rather than on a condition:
**notifications for the model portal** (`docs/` — see the memory note). His
stated trigger, ~5 creators, was met long ago; the roster is 18.
