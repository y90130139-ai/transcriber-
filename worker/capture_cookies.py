"""Capture a burner's Instagram session on THIS computer, for the Railway worker.

Run it, a real browser opens, sign in to the burner by hand (answer whatever
Instagram asks — that part is a human's job and only happens here, once), and
the script waits until the session is genuinely usable, then writes:

    secrets/ig-cookies.txt    the Netscape jar the worker reads
    secrets/ig-state.json     the warm browser state, if you want the ceiling too

and prints both as base64, ready to paste into Railway as `IG_COOKIES_B64`
(and optionally `IG_STATE_B64`). The scrape itself is untouched by all this —
the worker runs the same reader the Mac ran; only where the cookie lives
changes.

    pip install patchright
    python capture_cookies.py

Instagram parks half-finished sign-ins on special paths; a sessionid can exist
while the account is still there, and that session bounces on first use. The
script watches for both — sessionid AND a page that is not one of those.
"""
from __future__ import annotations

import base64
import http.cookiejar
import sys
import time
from pathlib import Path

from patchright.sync_api import sync_playwright

LOGIN_URL = "https://www.instagram.com/accounts/login/"
OUT_DIR = Path(__file__).parent / "secrets"
JAR = OUT_DIR / "ig-cookies.txt"
STATE = OUT_DIR / "ig-state.json"
PROFILE = Path(__file__).parent / "data" / "capture-profile"

WAIT_SEC = 15 * 60
POLL_SEC = 2
UNFINISHED = ("/accounts/login", "/challenge", "/two_factor", "/accounts/onetap", "/auth_platform")


def signed_in(ctx, url: str) -> bool:
    cookies = {c["name"]: c["value"] for c in ctx.cookies("https://www.instagram.com")}
    if not cookies.get("sessionid"):
        return False
    return not any(part in url for part in UNFINISHED)


def write_jar(ctx) -> None:
    jar = http.cookiejar.MozillaCookieJar(str(JAR))
    for cookie in ctx.cookies("https://www.instagram.com"):
        entry = http.cookiejar.Cookie(
            version=0, name=cookie["name"], value=cookie["value"],
            port=None, port_specified=False,
            domain=".instagram.com", domain_specified=True, domain_initial_dot=True,
            path="/", path_specified=True,
            secure=bool(cookie.get("secure", True)),
            expires=int(cookie["expires"]) if cookie.get("expires", -1) > 0 else None,
            discard=False, comment=None, comment_url=None, rest={},
        )
        jar.set_cookie(entry)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    jar.save(ignore_discard=True, ignore_expires=True)
    JAR.chmod(0o600)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PROFILE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as play:
        ctx = play.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=False,
            viewport={"width": 1280, "height": 800},
            locale="en-US",
            timezone_id="America/New_York",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(LOGIN_URL, wait_until="domcontentloaded")
        print("Sign in to the burner in the window that just opened.")
        print("Answer any challenge/2FA by hand — nothing is automated while you do.")
        print(f"Waiting up to {WAIT_SEC // 60} minutes for a real session...")

        deadline = time.time() + WAIT_SEC
        while time.time() < deadline:
            if signed_in(ctx, page.url):
                ctx.storage_state(path=str(STATE))
                STATE.chmod(0o600)
                write_jar(ctx)
                jar64 = base64.b64encode(JAR.read_bytes()).decode()
                state64 = base64.b64encode(STATE.read_bytes()).decode()
                print("\nSession captured.")
                print(f"  jar   {JAR}")
                print(f"  state {STATE}\n")
                print("Railway env — paste these (PowerShell: copy the whole line):\n")
                print(f"IG_COOKIES_B64={jar64}\n")
                print(f"IG_STATE_B64={state64}\n")
                ctx.close()
                return 0
            # Keep the page on the login surface if Instagram bounced it.
            if "instagram.com" not in page.url:
                page.goto(LOGIN_URL, wait_until="domcontentloaded")
            time.sleep(POLL_SEC)

        print("Timed out before a usable session appeared. Nothing was written.")
        ctx.close()
        return 1


if __name__ == "__main__":
    sys.exit(main())
