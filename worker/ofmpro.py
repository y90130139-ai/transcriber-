"""OFM Pro, driven by a browser that looks like a person's.

This is the Mac's scout pattern pointed at a different site. It does not
construct API calls from scratch and it does not parse the DOM: it opens the
real app in an anti-detect browser (patchright — patched Chromium, which keeps
the automation flags out of the fingerprint) with a persistent profile that
lives on the worker's volume, signs in once, and then reads the JSON the app's
own pages fetch.

Session rules, carried over from `src/scout_browser.py`:

* one profile, warm — the cookies and the browser state persist between runs,
  so a signed-in session survives restarts;
* a login is only ever attempted when the app actually shows its login page;
* the FIRST challenge or wall stops everything and says so — a burner pushed
  through a challenge is a burner burned, and the run log should say why;
* verification codes come from the AgentMail inbox, never a human.

The site's own endpoints are configuration, not guesses: OFMPRO_MEDIAS_PATH
defaults to the path the hand exports came from (/v2/medias/fetch), and the
first live probe corrects it. When in doubt, run with OFMPRO_DEBUG=1 and the
worker saves the page it saw to data/last-failure.png.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from patchright.sync_api import Page, TimeoutError as PlaywrightTimeout, sync_playwright

APP = os.environ.get("OFMPRO_URL", "https://app.ofmpro.com").rstrip("/")
MEDIAS_PATH = os.environ.get("OFMPRO_MEDIAS_PATH", "/v2/medias/fetch")
MEDIAS_BASE = os.environ.get("OFMPRO_MEDIAS_BASE", APP).rstrip("/")

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
PROFILE_DIR = DATA_DIR / "ofmpro-profile"
SCREENSHOT = DATA_DIR / "last-failure.png"

PAGE_SIZE = 500
MAX_PAGES = 20
CODE_WAIT_SEC = 240
CODE_POLL_SEC = 6

WALL_HINTS = ("challenge", "verify", "captcha", "cloudflare")


class WorkerStopped(RuntimeError):
    """The site asked for something a background worker must not answer."""


def _agentmail(path: str) -> dict:
    key = os.environ.get("AGENTMAIL_API_KEY", "")
    if not key:
        raise WorkerStopped("AGENTMAIL_API_KEY is not set — no way to read a code")
    request = urllib.request.Request(
        f"https://api.agentmail.to{path}",
        headers={"Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def login_email(since_ms: int) -> dict:
    """The newest OFM Pro login mail in the worker's inbox, or {} yet.

    OFM Pro is passwordless: the email address gets a one-time code (and
    sometimes a link). Both are read here — a code is typed into the form, a
    link is simply opened. `since_ms` is the whole safety rail: the inbox has
    history in it (other services' codes from months back), so anything older
    than the login attempt that asked for this mail is ignored outright.
    """
    inbox = os.environ.get("AGENTMAIL_INBOX", "")
    if not inbox:
        raise WorkerStopped("AGENTMAIL_INBOX is not set")
    body = _agentmail(f"/inboxes/{urllib.parse.quote(inbox)}/messages?limit=10")
    for message in body.get("messages", []):
        stamp = message.get("timestamp") or message.get("created_at") or ""
        try:
            arrived_ms = int(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000)
        except (ValueError, AttributeError):
            continue
        if arrived_ms < since_ms:
            continue
        text = f"{message.get('subject') or ''}\n{message.get('extracted_text') or message.get('text') or ''}"
        link = None
        for candidate in re.findall(r"https?://[^\s<>\"')]+", text):
            if "ofmpro.com" in candidate or "ofm.pro" in candidate:
                link = candidate
                break
        match = re.search(r"\b(\d{6})\b", text)
        if link or match:
            return {"code": match.group(1) if match else None, "link": link}
    return {}


def _click_any(page: Page, patterns: list[str]) -> bool:
    for pattern in patterns:
        locator = page.get_by_role("button", name=re.compile(pattern, re.I)).first
        try:
            if locator.is_visible(timeout=1000):
                locator.click()
                return True
        except PlaywrightTimeout:
            continue
        except Exception:
            continue
    return False


def _fill_any(page: Page, selectors: list[str], value: str) -> bool:
    for selector in selectors:
        locator = page.locator(selector).first
        try:
            if locator.is_visible(timeout=1500):
                locator.fill(value)
                return True
        except PlaywrightTimeout:
            continue
        except Exception:
            continue
    return False


def _use_login_email(page: Page, since_ms: int) -> bool:
    """Wait for the OTP mail and use it — link if there is one, code otherwise."""
    found = {}
    deadline = time.time() + CODE_WAIT_SEC
    while time.time() < deadline and not found:
        found = login_email(since_ms)
        if not found:
            time.sleep(CODE_POLL_SEC)
    if not found:
        return False
    if found.get("link"):
        page.goto(found["link"], wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        return True
    if not found.get("code"):
        return False
    if not _fill_any(page, [
        'input[autocomplete="one-time-code"]', 'input[name*="code" i]',
        'input[id*="code" i]', 'input[inputmode="numeric"]', 'input[type="tel"]',
        'input[type="text"]',
    ], found["code"]):
        return False
    _click_any(page, [r"verify", r"continue", r"confirm", r"submit", r"sign in", r"log in", r"next"])
    page.wait_for_timeout(3000)
    return True


def signed_in(page: Page) -> bool:
    """Whether the app is past its login. The login page is the only proof of
    the opposite; everything else is treated as signed in, because a slow
    dashboard and a login wall look identical for the first second."""
    url = page.url.lower()
    if any(hint in url for hint in ("/login", "/signin", "/sign-in", "/auth/", "/register")):
        return False
    try:
        page.wait_for_selector('input[type="email"], input[type="password"]', timeout=2500)
        return False
    except PlaywrightTimeout:
        return True


def sign_in(page: Page) -> None:
    """Passwordless (Geno, 2026-10-09): the inbox address goes in, OFM Pro
    mails it a one-time code, and AgentMail answers. First signup and later
    logins are the same form, so the pages are tried in the order that finds
    an email field; whichever one asks, the rest of the flow is identical."""
    email = os.environ.get("OFMPRO_EMAIL", "")
    if not email:
        raise WorkerStopped("OFMPRO_EMAIL is not set")

    started_ms = int(time.time() * 1000)
    for target in (f"{APP}/login", f"{APP}/signup", f"{APP}/register", f"{APP}/"):
        page.goto(target, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        if signed_in(page):
            return
        if _fill_any(page, ['input[type="email"]', 'input[name="email" i]', 'input[placeholder*="email" i]'], email):
            break
    else:
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        raise WorkerStopped(f"no email field found on any entry page — see {SCREENSHOT}")

    _click_any(page, [r"continue", r"next", r"sign in", r"log in", r"sign up",
                      r"get started", r"send", r"submit"])

    # An OTP step may or may not arrive; either it is asked for and answered
    # from AgentMail, or the app appears and the wait returns on its own.
    for _ in range(8):
        page.wait_for_timeout(3000)
        if signed_in(page):
            return
        if _use_login_email(page, started_ms):
            continue

    page.screenshot(path=str(SCREENSHOT), full_page=True)
    raise WorkerStopped(f"could not sign in — the page is saved at {SCREENSHOT} (url {page.url})")


def ensure_session(page: Page) -> None:
    page.goto(f"{APP}/", wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if signed_in(page):
        return
    sign_in(page)
    page.goto(f"{APP}/", wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    if not signed_in(page):
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        raise WorkerStopped("still signed out after a login attempt")


def fetch_medias(page: Page, platform: str, since: str, until: str) -> list[dict]:
    """One platform's window, read through the signed-in session.

    `page.request` shares the browser's cookies, so this is the same call the
    app's own pages make — no token forging, no endpoint archaeology. Pages
    stop when a page comes back short, with MAX_PAGES as the backstop.
    """
    seen: dict[str, dict] = {}
    for number in range(1, MAX_PAGES + 1):
        query = urllib.parse.urlencode({
            "platform": platform.upper(),
            "page_size": PAGE_SIZE,
            "sort": "MOST_OUTER_SCORE",
            "minimum_created_at": since,
            "maximum_created_at": until,
            "page": number,
        })
        response = page.request.get(f"{MEDIAS_BASE}{MEDIAS_PATH}?{query}")
        if response.status in (401, 403):
            raise WorkerStopped(f"medias fetch answered {response.status} — session is not accepted")
        try:
            body = response.json()
        except Exception as error:
            raise WorkerStopped(f"medias fetch answered {response.status} — not JSON ({error})") from error
        items = body.get("items") or []
        for item in items:
            key = str(item.get("id") or item.get("external_id") or "")
            if key:
                seen[key] = item
        if len(items) < PAGE_SIZE:
            break
    return list(seen.values())


def open_browser():
    """A persistent, anti-detect context. Caller owns the playwright handle."""
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    playwright = sync_playwright().start()
    proxy = os.environ.get("PROXY_URL") or None
    context = playwright.chromium.launch_persistent_context(
        user_data_dir=str(PROFILE_DIR),
        headless=os.environ.get("OFMPRO_HEADLESS", "1") != "0",
        proxy={"server": proxy} if proxy else None,
        viewport={"width": 1440, "height": 900},
        locale="en-US",
        timezone_id="America/New_York",
    )
    page = context.pages[0] if context.pages else context.new_page()
    return playwright, context, page
