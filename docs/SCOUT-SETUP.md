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

## Step 2 — the burner's session, signed in on the Mac (since 2026-09-22)

**This replaced the phone on 2026-09-22, at Geno's call** — renewing over the
cable was more hassle than the risk it guarded against. The 2026-09-19 concern
still holds and is still met: the burner is never signed into Chrome or Safari.
`./bin/scout-login` opens a separate Chromium window that belongs to Scout
alone, with nothing else signed in to mis-click into.

1. `./bin/scout-login` — a window opens on Instagram's sign-in page.
2. Sign in as the **burner**. If Instagram asks for a code, get it from the
   burner's email or phone and enter it.
3. Tap "Not now" on any save-login or notifications prompt. The window closes by
   itself once the home feed loads; it writes `secrets/scout-cookies.txt` and
   `secrets/scout-state.json` (the old pair is kept as `*.prev`).
4. `./bin/scout --session` — must say the session is alive.

When the Today tab says the session died, do 1–4 again.

The phone method below is kept for reference only.

## The viewer burner — a second spare account, for reels behind a login

**Why (2026-09-25):** the downloader reached age-gated reels with Geno's own
account's cookie; 62 back to back got that account warned for automated
behaviour. No personal account is used by any automation now
(`config.json` has no `cookies_file`, on purpose). Reels that need a login are
opened by a dedicated spare account instead, in its own browser, at a person's
pace — `src/viewer.py`, launchd `com.geno.social-transcriber.viewer`.

Setting it up, once:

1. On the phone, create a new Instagram account with its own email. Not
   Geno's, not a model's, not Scout's burner.
2. **Warm it up for 3–5 days by hand:** add a photo and a bio, follow 20–40
   accounts in the roster's niches, watch reels, like a few. A new account that
   goes straight to heavy viewing is the pattern Instagram flags first.
3. Turn on two-factor authentication for it (its own email or an authenticator).
4. On the Mac: `./bin/scout-login --viewer`, sign in as the **viewer** account.
   It writes only `secrets/viewer-cookies.txt` and `viewer-state.json` — never
   Scout's files.
5. `./bin/viewer --check` — must say VIEWER ALIVE.

From then on it runs by itself: waking hours only (09:00–23:00), clear of
Scout's passes, at most 5 reels a run, 15 an hour, 60 a day, 1–3 minutes
between reels. At the first login wall or warning it stops for the day and posts
to the OPS group. `./bin/viewer --status` shows the budget and the queue.

## (Old) Step 2 — the burner's session, from an old iPhone over USB

**This replaced the Chrome-profile method on 2026-09-19, at Geno's call.** He
would not sign the burner into a browser on the Mac: that Mac holds his own
signed-in accounts and tabs, and a mis-click there hands Scout the wrong
session. So the burner now lives on an old iPhone and nowhere else, and the Mac
reads the cookie off it down the cable.

### Why Safari on the phone, and not the Instagram app

Safari on the Mac can remote-debug Safari on a tethered iPhone — full Web
Inspector, pointed at the phone's browser. Nothing is signed in on the Mac.

It has to be Safari, not the app:

* `scout_ig.py` calls Instagram's **web** endpoints with `X-IG-App-ID`, so it
  needs a **web** `sessionid`. The iOS app authenticates with `Bearer IGT:…`
  tokens against different endpoints — the wrong shape entirely, and adopting it
  would mean rewriting the reader against the mobile API.
* The app also pins its TLS certificates, so reading its traffic with a proxy
  needs a jailbreak. Safari pins nothing.

### The pass

On the iPhone:

1. Sign in to **instagram.com in Safari** (a normal tab, not Private) as the
   burner.
2. Settings → **Safari** → **Advanced** → **Web Inspector** on.
3. Plug into the Mac, unlock, **Trust**. The pairing lands in `/var/db/lockdown`
   — its mtime is how you confirm this step without touching the phone.
4. Auto-Lock → **Never** while you work. A locked phone drops off the Develop
   menu.

On the Mac:

5. Safari → Settings → **Advanced** → **Show features for web developers**.
6. **Develop** → the iPhone → **instagram.com**.
7. **Storage** → **Cookies** → `instagram.com`. Copy `sessionid` and
   `csrftoken`. **The panel shows rows; only the second column is the value** —
   first is the name, then domain, path, expiry, size. Pasting the whole row is
   the mistake that gets made.
8. If `sessionid` is hidden (it is http-only): **Network** → reload → click any
   `instagram.com` request → **Request Headers → `Cookie`**. It is in that
   string. This path always works.
9. Console (`Esc` opens the drawer) → `navigator.userAgent`. Needed below.

Then:

```bash
./bin/scout-cookies --sessionid - --csrftoken 'PASTE_CSRFTOKEN'
```

`--sessionid -` reads stdin, so the session never reaches shell history or `ps`.
Paste, Enter, Ctrl-D.

### The user agent matches the endpoints, not the phone

Tried it the other way first and it was the wrong axis. `USER_AGENT` stays a
**desktop** browser, because the reader calls the *desktop* web client's
endpoints (`web_profile_info`, `feed/user`, `X-IG-App-ID 936619743392459`).
Pairing the phone's mobile UA with the desktop app id is the mismatch to avoid.

The session travels regardless: Instagram does not bind a web `sessionid` to a
user-agent. Measured 2026-09-19 — the phone was loading reels on that same
session while this reader carried it far enough to be **rate-limited (429)**
rather than rejected as invalid (401). A fresh jar's first authenticated call
drawing a 429 looks to be pacing, not proof of anything about the jar.

`scout.burner_user_agent` overrides it if that ever stops being true.

### Renewal, and what was deferred

The phone stays plugged in and signed in. When the session dies, redo 6–9 and
the `scout-cookies` line: about two minutes, still nothing signed in on the Mac.

**Keep it healthy.** Stay signed in on the phone — logging out invalidates the
session server-side. Scroll it like a person now and then. If Instagram
challenges it, Scout stops that pass, keeps what it read, and logs
`burner stopped: …`.

Driving the phone itself (Appium + WebDriverAgent over USB, the way iOS device
farms run on racked Mac Minis) is real and was considered. Deferred: it needs
Xcode, a signing identity re-done weekly on a free Apple ID, and Developer Mode,
and it would carry no data — the reader still does the HTTP reads. Do it only if
the burner turns out to be challenged often enough to justify it.

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
