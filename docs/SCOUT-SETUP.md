# Turning Scout on — the two human steps

Everything else is built, deployed and on a timer. These two hand Scout its
credentials. Ten minutes total, once.

## Why a browser agent cannot do step 2 for you

Instagram marks `sessionid` **http-only**. That is a browser rule, not a
setting: no extension, no page script and no in-page agent (Claude for Chrome
included) can read an http-only cookie. Only you, through DevTools or a cookie
exporter, can see it. So step 2 is three seconds of copying — and
`bin/scout-cookies` does the fiddly part.

---

## Step 1 — Apify token (the ~99 open accounts)

1. Open **https://console.apify.com/settings/integrations** (signed in).
2. Copy the **Personal API token** (starts `apify_api_…`).
3. Either paste it to Claude, or set it yourself without it passing through the
   conversation:

   ```bash
   python3 - <<'EOF'
   import json; p='config.json'; c=json.load(open(p))
   c.setdefault('scout', {})['apify_token'] = input('token: ').strip()
   json.dump(c, open(p,'w'), indent=2); print('saved')
   EOF
   ```

`config.json` is gitignored and never leaves the Mac.

## Step 2 — the burner's session (the ~97 gated accounts)

Do this in a **separate Chrome profile or an incognito window** signed in to the
throwaway account only. Signing the burner into your everyday profile risks
handing Scout your own session instead.

1. In that window, open instagram.com and confirm the burner is the logged-in
   account.
2. `⌥⌘I` (DevTools) → **Application** tab → left sidebar **Storage → Cookies →
   https://www.instagram.com**.
3. Click the row named **`sessionid`** and copy the whole **Value** (long,
   contains `%3A`). While you are there, copy **`csrftoken`** too — optional but
   better.
4. On the Mac:

   ```bash
   ./bin/scout-cookies --sessionid 'PASTE_SESSIONID' --csrftoken 'PASTE_CSRFTOKEN'
   ```

   It writes `secrets/scout-cookies.txt` with mode 600, gitignored, and prints
   nothing back.
5. Prove it: `./bin/scout --check-burner <a gated handle>` — it should print
   that creator's recent reels with play counts.

**Keep the burner healthy.** Stay signed in on that profile (logging out
invalidates the session). Scroll it like a person now and then. If Instagram
ever challenges it, Scout stops that pass, keeps what it read, and logs
`burner stopped: …`; sign in again, re-run step 2, and the next Saturday
carries on.

---

## Then Claude runs, in this order

1. `./bin/scout --only apify --limit 40` — the free-credit trial. Prints the
   spread of multipliers and what the plays field looks like.
2. Sets `PICK_MULTIPLIER` from that spread (top decile, the way `HOT_THRESHOLD`
   was set) and pins one plays field if the actor fills them unevenly.
3. `./bin/scout --only burner --limit 10` — proves the gated half.
4. You upgrade Apify to Starter ($19), `max_usd_per_run` goes to ~8.
5. `./bin/scout` — the full first sweep, ~196 accounts. Winners land in the
   Queue; the worker transcribes them; Sunday's auto-draft uses them.

After that it is unattended: Saturday 10:00 sweep, Sunday 17:00 draft, and your
part is reviewing weeks and pressing send.
