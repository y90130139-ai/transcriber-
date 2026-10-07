"""Sign a burner in on this Mac, in its own browser — the phone's replacement.

Opens a visible Chromium window that belongs to one account alone: its own
cookie store, nothing else signed in, nothing shared with Chrome or Safari.
That is what keeps the reason the burner went onto a phone (2026-09-19: a
mis-click in Geno's own browser could hand Scout the wrong session) — the
window this opens has no other session to mis-click into.

Sign in by hand, answer any code Instagram asks for, and the window closes by
itself once Instagram has issued a session. Both copies are written:

* the account's jar (`secrets/scout-cookies.txt`, or `secrets/<id>-cookies.txt`)
* its browser state beside it — kept warm by each pass

The previous pair is kept as `*.prev` until this one is proven. Values are
never printed.

    ./bin/scout-login                    # the active account (main, or a backup
                                         #   after a failover)
    ./bin/scout-login --account scout    # a specific account from the registry
    ./bin/scout-login --viewer           # the VIEWER burner instead (src/viewer.py)

`--viewer` writes only `secrets/viewer-cookies.txt` and `viewer-state.json`, so
signing the viewer in can never replace Scout's session — the swap that cost a
working login on 2026-09-25.
"""
from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path

from . import config, ig_browser, scout_accounts
from .scout_cookies import WANTED, write

VIEWER_JAR = "secrets/viewer-cookies.txt"
VIEWER_STATE = "viewer-state.json"

LOGIN_URL = "https://www.instagram.com/accounts/login/"
WAIT_SEC = 15 * 60          # long enough to fetch a code from the burner's inbox
POLL_SEC = 2
# Paths Instagram parks a half-finished sign-in on. A sessionid can exist while
# the account is still on one of these, and saving it then saves a session that
# the first real read would bounce.
UNFINISHED = ("/accounts/login", "/challenge", "/two_factor", "/accounts/onetap", "/auth_platform")


def _keep_previous(*paths: Path) -> None:
    for path in paths:
        if path.is_file():
            shutil.copy2(path, path.with_name(path.name + ".prev"))


def _signed_in(context, page) -> dict | None:
    """Instagram's cookies once the sign-in has really finished, else None."""
    cookies = {c["name"]: c["value"] for c in context.cookies("https://www.instagram.com")}
    if not cookies.get("sessionid"):
        return None
    if any(part in page.url for part in UNFINISHED):
        return None
    return {name: cookies[name] for name in WANTED if cookies.get(name)}


def _target(args) -> tuple[Path, Path, str, str, str, str | None]:
    """(jar, state, whose, account words, prove command, registry id)."""
    if args.viewer:
        jar = config.ROOT / VIEWER_JAR
        return jar, jar.with_name(VIEWER_STATE), "the viewer's", "the VIEWER burner", "./bin/viewer --check", None
    entry = scout_accounts.get(args.account) if args.account else scout_accounts.active()
    if entry is None:
        raise SystemExit(f"no account with id {args.account!r} — see ./bin/scout-cookies --list")
    jar = scout_accounts.resolve(entry["jar"])
    return (
        jar,
        scout_accounts.state_for(jar),
        f"{entry['id']}'s",
        f"the BURNER account ({entry['label']})",
        "./bin/scout --session",
        str(entry["id"]),
    )


def main(argv: list[str] | None = None) -> int:
    from playwright.sync_api import sync_playwright

    parser = argparse.ArgumentParser(prog="scout-login", description=__doc__.splitlines()[0])
    parser.add_argument("--viewer", action="store_true", help="sign the VIEWER burner in instead")
    parser.add_argument("--account", metavar="ID", help="a registry account (default: the active one)")
    args = parser.parse_args(argv)

    jar, state, who, account, prove, account_id = _target(args)

    print(f"A browser window is opening. It is {who} alone — nothing else is signed in there.")
    print(f"Sign in as {account}. The window closes by itself when it's done.\n")

    with sync_playwright() as play:
        # The same Chrome, size and user agent the passes use afterwards, so
        # the session is never signed in on one browser and used from another.
        browser = ig_browser.launch(play, headless=False)
        # A fresh store on purpose: never the saved state, so a dead session
        # cannot sit in the window and look like a live one.
        context = browser.new_context(**ig_browser.context_options(browser))
        page = context.new_page()
        page.goto(LOGIN_URL)

        cookies = None
        deadline = time.time() + WAIT_SEC
        while time.time() < deadline:
            try:
                cookies = _signed_in(context, page)
            except Exception:           # the window was closed by hand
                break
            if cookies:
                break
            time.sleep(POLL_SEC)

        if not cookies:
            browser.close()
            print("No session was issued — nothing was changed. Run the login again.")
            return 1

        # Let the home feed settle so Instagram hands over its follow-up cookies.
        time.sleep(4)
        cookies = _signed_in(context, page) or cookies
        _keep_previous(jar, state)
        write(jar, cookies)
        context.storage_state(path=str(state))
        state.chmod(0o600)
        browser.close()

    if account_id:
        # The hand sign-in is the strongest proof there is; record it so the
        # next health check does not re-probe, and a dead active account can
        # come straight back.
        scout_accounts.mark(account_id, "alive", "signed in by hand")
    print(f"Saved {account}'s session ({', '.join(sorted(cookies))}) to {jar.name}.")
    print(f"Now prove it: {prove}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
