"""Scout's logged-in reader, by letting Instagram's own site do the asking.

`scout_ig.py` built its own calls to `/api/v1/...`. That path is **retired** —
measured 2026-09-20: filtering a tethered phone's Web Inspector for `api/v1`
returns nothing while `graphql` returns rows, and the hand-built call answered
429 identically for gated accounts, for famous open ones, under every header set
and after every wait. It never worked, and it never could have.

The lesson is not "find the new endpoint". Instagram's GraphQL calls are keyed by
`doc_id`s resolved at runtime from Relay metadata and rotated without notice, so
re-pointing by hand buys the same treadmill on a shorter cycle.

So this module does not construct a request at all. It drives a real browser,
signed in as the burner, to the pages a person would open, and **reads the
responses the site makes for itself**. When Instagram changes its queries the
site changes with them and this keeps working. Nothing is parsed out of the DOM
either — the JSON the page fetched is the JSON we keep.

Two tabs, because the data is split and neither half is enough:

* `/<handle>/`       → `taken_at`, caption, audio, carousel counts, likes, comments
* `/<handle>/reels/` → `play_count`, which the timeline omits

They share `pk`, so they merge into one item of exactly the shape
`scout_ig.to_sighting` already expects — which is why that function is reused
here untouched rather than reimplemented.

The burner is protected the same way as before: a real browser profile, one
creator at a time, a random pause between them, and a full stop at the first
login wall or challenge.
"""
from __future__ import annotations

import http.cookiejar
import random
import time
from pathlib import Path

from .scout_ig import BurnerStopped, to_sighting

PAUSE_SEC = (8.0, 15.0)
SETTLE_MS = 5000          # let the page's own fetches land
SCROLL_ROUNDS = 2         # each one asks the site for another page of posts
NAV_TIMEOUT_MS = 60_000
WALL = ("/accounts/login", "/challenge")


def _cookies(path: Path) -> list[dict]:
    jar = http.cookiejar.MozillaCookieJar(str(path))
    jar.load(ignore_discard=True, ignore_expires=True)
    if not any(c.name == "sessionid" for c in jar):
        raise BurnerStopped(f"{path} has no Instagram sessionid")
    return [{
        "name": c.name, "value": c.value, "domain": ".instagram.com",
        "path": "/", "secure": True, "httpOnly": c.name == "sessionid",
    } for c in jar]


def _media(node):
    """Every dict in a response that looks like a post. The site nests them
    differently per query, so this walks rather than assuming a path."""
    if isinstance(node, dict):
        if node.get("pk") and ("code" in node):
            yield node
        for value in node.values():
            yield from _media(value)
    elif isinstance(node, list):
        for value in node:
            yield from _media(value)


class Reader:
    """One browser, reused across the sweep. Launching is the expensive part."""

    def __init__(self, cookies_file: str | Path) -> None:
        from playwright.sync_api import sync_playwright
        path = Path(cookies_file).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f"burner cookies not found at {path}")
        self._play = sync_playwright().start()
        self._browser = self._play.chromium.launch(headless=True)
        self._ctx = self._browser.new_context(viewport={"width": 1280, "height": 900})
        self._ctx.add_cookies(_cookies(path))

    def close(self) -> None:
        for shut in (self._ctx.close, self._browser.close, self._play.stop):
            try:
                shut()
            except Exception:
                pass

    def _visit(self, url: str) -> dict[str, dict]:
        """Open a page and keep every post the site fetched, keyed by pk."""
        found: dict[str, dict] = {}
        page = self._ctx.new_page()

        def collect(response):
            if "/graphql" not in response.url and "/api/graphql" not in response.url:
                return
            try:
                body = response.json()
            except Exception:
                return
            for item in _media(body):
                key = str(item["pk"])
                # Merge rather than overwrite: the two tabs carry different
                # halves of the same post and arrive in no fixed order.
                found.setdefault(key, {}).update({k: v for k, v in item.items() if v is not None})

        page.on("response", collect)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
            page.wait_for_timeout(SETTLE_MS)
            if any(w in page.url for w in WALL):
                raise BurnerStopped(f"redirected to {page.url} — the burner session needs signing in again")
            for _ in range(SCROLL_ROUNDS):
                page.mouse.wheel(0, 4000)
                page.wait_for_timeout(SETTLE_MS)
        finally:
            try:
                page.close()
            except Exception:
                pass
        return found

    def posts(self, handle: str) -> list[dict]:
        """Both tabs, merged. Items are the shape `to_sighting` expects."""
        merged = self._visit(f"https://www.instagram.com/{handle}/")
        for key, item in self._visit(f"https://www.instagram.com/{handle}/reels/").items():
            merged.setdefault(key, {}).update({k: v for k, v in item.items() if v is not None})
        return list(merged.values())


def sweep(
    handles: list[str],
    cookies_file: str | Path,
    log=print,
    user_agent: str | None = None,   # accepted for call-site compatibility; the browser sets its own
) -> tuple[list[dict], dict[str, str], str | None]:
    """Same contract as `scout_ig.sweep`: (sightings, access, stop reason).

    A stop is not an exception to the caller — whatever was read before
    Instagram pushed back is still worth posting."""
    reader = Reader(cookies_file)
    sightings: list[dict] = []
    access: dict[str, str] = {}
    stopped: str | None = None
    try:
        for index, handle in enumerate(handles):
            if index:
                time.sleep(random.uniform(*PAUSE_SEC))
            try:
                posts = reader.posts(handle)
            except BurnerStopped as error:
                stopped = str(error)
                log(f"  burner stopped: {error}")
                break
            except Exception as error:                      # one bad profile must not end the pass
                access[handle] = "missing"
                log(f"  ! @{handle}: {str(error)[:120]}")
                continue
            reels = [s for s in (to_sighting(p, handle) for p in posts) if s]
            access[handle] = "open" if reels else "missing"
            sightings += reels
            log(f"  @{handle}: {len(reels)} reels")
    finally:
        reader.close()
    return sightings, access, stopped
