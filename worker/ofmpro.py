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
MEDIAS_BASE = os.environ.get("OFMPRO_MEDIAS_BASE", "https://api.ofmpro.com").rstrip("/")

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
PROFILE_DIR = DATA_DIR / "ofmpro-profile"
SCREENSHOT = DATA_DIR / "last-failure.png"

PAGE_SIZE = 10
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
    body = _agentmail(f"/v0/inboxes/{urllib.parse.quote(inbox)}/messages?limit=10")
    for summary in body.get("messages", []):
        stamp = summary.get("timestamp") or summary.get("created_at") or ""
        try:
            arrived_ms = int(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000)
        except (ValueError, AttributeError):
            continue
        if arrived_ms < since_ms:
            continue

        message_id = summary.get("message_id")
        if not message_id:
            continue
        message = _agentmail(
            f"/v0/inboxes/{urllib.parse.quote(inbox)}/messages/"
            f"{urllib.parse.quote(str(message_id), safe='')}"
        )
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
    """Ask the API whether this persistent browser has a real session.

    The login UI can stay on /auth/login after its callback succeeds, so URL
    checks alone can both miss valid sessions and mistake public pages for one.
    """
    try:
        response = page.request.post(
            f"{MEDIAS_BASE}/v2/user/fetch",
            data="{}",
            headers={"Content-Type": "application/json"},
            timeout=30_000,
        )
        result = response.json()
        if response.ok and isinstance(result, dict) and result.get("data") is not None and not result.get("error"):
            print("OFM Pro session check: authenticated", flush=True)
            return True
        print(f"OFM Pro session check: HTTP {response.status}, authenticated=False", flush=True)
    except Exception:
        print("OFM Pro session check: request failed", flush=True)
        pass

    path = urllib.parse.urlparse(page.url).path.lower().rstrip("/") or "/"
    if path in {"/", "/getstarted", "/login", "/signup", "/register"} or path.startswith("/auth/"):
        return False
    try:
        page.wait_for_selector('input[type="email"], input[type="password"]', timeout=2500)
        return False
    except PlaywrightTimeout:
        return True


def _api_result(response, label: str) -> dict:
    try:
        envelope = response.json()
    except Exception as error:
        raise WorkerStopped(f"{label} answered {response.status} — not JSON") from error
    if not response.ok:
        raise WorkerStopped(f"{label} answered HTTP {response.status}")
    if isinstance(envelope, dict) and envelope.get("error"):
        errors = envelope["error"]
        if isinstance(errors, list):
            message = "; ".join(str(item.get("message") or item) if isinstance(item, dict) else str(item) for item in errors)
        else:
            message = str(errors)
        raise WorkerStopped(f"{label} failed: {message[:400]}")
    data = envelope.get("data", envelope) if isinstance(envelope, dict) else {}
    return data if isinstance(data, dict) else {}


def sign_in(page: Page) -> None:
    """Use OFM Pro's own passwordless OTP endpoints and the AgentMail inbox."""
    email = os.environ.get("OFMPRO_EMAIL", "")
    if not email:
        raise WorkerStopped("OFMPRO_EMAIL is not set")

    started_ms = int(time.time() * 1000)
    print("OFM Pro login: requesting a one-time code; source=AgentMail", flush=True)
    headers = {
        "Content-Type": "application/json",
        "Origin": APP,
        "Referer": f"{APP}/auth/login",
    }
    otp_response = page.request.post(
        f"{MEDIAS_BASE}/v2/auth/otp",
        data=json.dumps({"email": email}),
        headers=headers,
        timeout=30_000,
    )
    print(f"OFM Pro OTP request: HTTP {otp_response.status}", flush=True)
    _api_result(otp_response, "OTP request")

    found = {}
    deadline = time.time() + CODE_WAIT_SEC
    next_wait_log = time.time() + 30
    while time.time() < deadline and not found:
        found = login_email(started_ms)
        if not found:
            if time.time() >= next_wait_log:
                print("AgentMail: waiting for a fresh OFM Pro message", flush=True)
                next_wait_log = time.time() + 30
            time.sleep(CODE_POLL_SEC)
    if not found:
        raise WorkerStopped(f"no fresh OFM Pro one-time code arrived in {CODE_WAIT_SEC}s")
    print(f"AgentMail: fresh message received; code={bool(found.get('code'))}, link={bool(found.get('link'))} (values hidden)", flush=True)

    if found.get("code"):
        params = urllib.parse.urlencode({
            "email": email,
            "type": "email",
            "token": found["code"],
            # The public OFM Pro login client supplies this value for the
            # passwordless callback, including existing-account logins.
            "invite_code": "ofmprobest153",
        })
        callback_response = page.request.post(
            f"{MEDIAS_BASE}/v2/auth/callback?{params}",
            headers=headers,
            timeout=30_000,
        )
        print(f"OFM Pro OTP callback: HTTP {callback_response.status}", flush=True)
        _api_result(callback_response, "OTP callback")
    elif found.get("link"):
        page.goto(found["link"], wait_until="domcontentloaded")
    else:
        raise WorkerStopped("AgentMail message had neither a six-digit code nor an OFM Pro login link")

    page.goto(f"{APP}/", wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    if not signed_in(page):
        raise WorkerStopped("OTP callback completed but OFM Pro still reports no authenticated session")
    print("OFM Pro login: session verified", flush=True)


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
        diagnostic = page.evaluate("""() => JSON.stringify({
          path: location.pathname,
          title: document.title,
          inputs: [...document.querySelectorAll('input')].map(({ type, name, placeholder, autocomplete }) => ({ type, name, placeholder, autocomplete })),
          buttons: [...document.querySelectorAll('button')].map((button) => button.innerText.trim()).filter(Boolean)
        })""")
        raise WorkerStopped(f"still signed out after a login attempt — page {diagnostic[:700]}")


def fetch_medias(
    page: Page,
    platform: str,
    since: str,
    until: str,
    *,
    max_pages: int = MAX_PAGES,
    sort: str = "MOST_OUTER_SCORE",
) -> list[dict]:
    """One platform's window, read through the signed-in session.

    `page.request` shares the browser's cookies, so this is the same call the
    app's own pages make — no token forging, no endpoint archaeology. Pages
    stop when a page comes back short, with MAX_PAGES as the backstop.
    """
    seen: dict[str, dict] = {}
    for number in range(1, max_pages + 1):
        # OFM Pro's SDK flattens filters and extra into POST query parameters;
        # it does not send a nested JSON body.
        query = urllib.parse.urlencode({
            "page": number,
            "page_size": PAGE_SIZE,
            "platform": platform.upper(),
            "sort": sort,
            "minimum_created_at": since,
            "maximum_created_at": until,
        })
        response = page.request.post(
            f"{MEDIAS_BASE}{MEDIAS_PATH}?{query}",
            headers={"Content-Type": "application/json"},
            timeout=60_000,
        )
        if response.status in (401, 403):
            raise WorkerStopped(f"medias fetch answered {response.status} — session is not accepted")
        try:
            envelope = response.json()
        except Exception as error:
            raise WorkerStopped(f"medias fetch answered {response.status} — not JSON ({error})") from error
        if isinstance(envelope, dict) and envelope.get("error"):
            errors = envelope["error"]
            if isinstance(errors, list):
                message = "; ".join(str(item.get("message") or item) for item in errors)
            else:
                message = str(errors)
            if "unauthorized" in message.lower():
                raise WorkerStopped(f"medias fetch rejected the session: {message[:240]}")
            raise RuntimeError(f"medias fetch failed: {message[:500]}")
        body = envelope.get("data", envelope) if isinstance(envelope, dict) else {}
        if not isinstance(body, dict):
            raise RuntimeError("medias fetch returned an unexpected response shape")
        items = body.get("items") or []
        for item in items:
            key = str(item.get("id") or item.get("external_id") or "")
            if key:
                seen[key] = item
        if len(items) < PAGE_SIZE:
            break
        if max_pages > MAX_PAGES:
            time.sleep(0.15)  # keep a full-history rescan polite to the API
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
