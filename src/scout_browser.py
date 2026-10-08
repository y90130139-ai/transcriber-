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

from . import ig_browser, scout_accounts
from .scout_ig import BurnerStopped, to_sighting

PAUSE_SEC = (8.0, 15.0)
STATE_NAME = "scout-state.json"   # the browser's own copy of the session, kept warm
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


# 1 photo, 2 video, 8 carousel. `product_type` separates a reel from a video
# posted to the feed, which matters because only one of them counts as a reel.
KIND = {1: "photo", 2: "video", 8: "carousel"}


def to_post(item: dict, handle: str) -> dict | None:
    """One item → the cadence record. Unlike `to_sighting` this keeps photos
    and carousels: "2-3 carousels a week" cannot be measured from reels alone."""
    code = item.get("code")
    if not code:
        return None
    kind = KIND.get(item.get("media_type"))
    if kind == "video" and item.get("product_type") == "clips":
        kind = "reel"
    caption = item.get("caption") or {}
    clips = item.get("clips_metadata") or {}
    music = (clips.get("music_info") or {}).get("music_asset_info") or {}
    original = clips.get("original_sound_info") or {}
    taken = item.get("taken_at")
    return {
        "post_id": code,
        "handle": handle,
        "posted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(taken)) if taken else None,
        "kind": kind,
        "product_type": item.get("product_type"),
        "carousel_count": item.get("carousel_media_count"),
        "plays": item.get("ig_play_count") or item.get("play_count") or item.get("view_count"),
        "likes": item.get("like_count"),
        "comments": item.get("comment_count"),
        # Shares, which Instagram does expose here even though the app never
        # shows them to a viewer. Measured 2026-09-20: present and non-null on
        # every timeline item read. Saves are the one signal that genuinely is
        # not public — only the account's own Insights carry those.
        "reposts": item.get("media_repost_count"),
        "caption": caption.get("text") if isinstance(caption, dict) else None,
        "audio_title": music.get("title") or original.get("original_audio_title"),
        "is_paid_partnership": item.get("is_paid_partnership"),
        "collaborators": [
            c.get("username") for c in (item.get("coauthor_producers") or []) if c.get("username")
        ],
        # Her reel's own file. Her winners are downloaded from this when yt-dlp
        # cannot resolve the page — age-gated or an empty media response, 12 of
        # 62 on 2026-09-21 — and it expires in about a day, so it rides along
        # on every pass rather than being fetched when needed.
        "video_url": (item.get("video_versions") or [{}])[0].get("url") if kind == "reel" else None,
        "poster_url": ((item.get("image_versions2") or {}).get("candidates") or [{}])[0].get("url"),
    }


def to_snapshot(profile: dict, handle: str) -> dict:
    """The account as it stands right now. `latest_reel_media` is the timestamp
    of the most recent story and is 0 when none is live — which is the only way
    to see stories at all from outside, and why this has to run daily: a story
    is gone in 24 hours, so a weekly reading can never show one posted midweek."""
    story = profile.get("latest_reel_media") or 0
    return {
        "handle": handle,
        "followers": profile.get("follower_count"),
        "posts": profile.get("media_count"),
        "story_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(story)) if story else None,
        "has_story": bool(story),
        "highlights": len(((profile.get("highlights") or {}).get("edges")) or []),
        "is_private": profile.get("is_private"),
        "is_verified": profile.get("is_verified"),
    }


def _profiles(node):
    """Every dict that looks like the account's own header."""
    if isinstance(node, dict):
        if node.get("username") and "latest_reel_media" in node:
            yield node
        for value in node.values():
            yield from _profiles(value)
    elif isinstance(node, list):
        for value in node:
            yield from _profiles(value)


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
        # One browser profile per account, so two burners can never share a
        # session; the main jar keeps its historic state name (scout_accounts).
        self._state = scout_accounts.state_for(path)
        self._play = sync_playwright().start()
        # Installed Chrome with an ordinary user agent, not Playwright's
        # headless build, which says "HeadlessChrome" (ig_browser.py).
        self._browser = ig_browser.launch(self._play, headless=True)
        # Carry the previous run's cookies forward when there are any. Instagram
        # refreshes a session as it is used, so a browser that keeps its own
        # state stays signed in on its own — which is what stops this needing a
        # trip to the tethered phone every time the jar goes stale.
        self._ctx = self._browser.new_context(**ig_browser.context_options(
            self._browser,
            storage_state=str(self._state) if self._state.is_file() else None,
        ))
        # The jar from the phone is the floor, not the ceiling: adding it after
        # the saved state means a hand-refreshed session always wins.
        self._ctx.add_cookies(_cookies(path))
        self._want = ""

    def _save(self) -> None:
        """Keep whatever Instagram handed back, so the next run starts fresher
        than this one did."""
        try:
            self._ctx.storage_state(path=str(self._state))
            self._state.chmod(0o600)
        except Exception:
            pass

    def close(self) -> None:
        self._save()
        for shut in (self._ctx.close, self._browser.close, self._play.stop):
            try:
                shut()
            except Exception:
                pass

    def _visit(self, url: str) -> dict[str, dict]:
        """Open a page and keep every post the site fetched, keyed by pk."""
        found: dict[str, dict] = {}
        profile: dict = {}
        blocked: list[str] = []
        page = self._ctx.new_page()

        def collect(response):
            if "instagram.com" in response.url and response.status in (401, 403, 429):
                blocked.append(f"Instagram HTTP {response.status} at {response.url.split('?')[0]}")
                return
            if "/graphql" not in response.url and "/api/graphql" not in response.url:
                return
            try:
                body = response.json()
            except Exception:
                return
            for who in _profiles(body):
                if who.get("username", "").lower() == self._want:
                    profile.update({k: v for k, v in who.items() if v is not None})
            for item in _media(body):
                key = str(item["pk"])
                # Merge rather than overwrite: the two tabs carry different
                # halves of the same post and arrive in no fixed order.
                found.setdefault(key, {}).update({k: v for k, v in item.items() if v is not None})

        page.on("response", collect)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
            page.wait_for_timeout(SETTLE_MS)
            if blocked:
                raise BurnerStopped(blocked[0])
            if any(w in page.url for w in WALL):
                raise BurnerStopped(f"redirected to {page.url} — the burner session needs signing in again")
            for _ in range(SCROLL_ROUNDS):
                page.mouse.wheel(0, 4000)
                page.wait_for_timeout(SETTLE_MS)
                if blocked:
                    raise BurnerStopped(blocked[0])
            body_text = page.locator("body").inner_text(timeout=5_000).lower()
            warning = next((phrase for phrase in (
                "we restrict certain activity",
                "automated behavior",
                "automated behaviour",
                "try again later",
            ) if phrase in body_text), None)
            if warning:
                raise BurnerStopped(f"Instagram warning page: {warning}")
        finally:
            try:
                page.close()
            except Exception:
                pass
        return found, profile

    def posts(self, handle: str) -> tuple[list[dict], dict]:
        """Both tabs, merged, plus the account header. Items are the shape
        `to_sighting` and `to_post` expect."""
        self._want = handle.lower()
        merged, profile = self._visit(f"https://www.instagram.com/{handle}/")
        more, also = self._visit(f"https://www.instagram.com/{handle}/reels/")
        for key, item in more.items():
            merged.setdefault(key, {}).update({k: v for k, v in item.items() if v is not None})
        profile.update({k: v for k, v in also.items() if v is not None})
        return list(merged.values()), profile

    def profile_only(self, handle: str) -> dict:
        """The header alone — one page load, no scrolling. This is the daily
        pass: cheap enough for the whole watchlist, and the only way to catch a
        story before it expires."""
        self._want = handle.lower()
        _, profile = self._visit(f"https://www.instagram.com/{handle}/")
        return profile


def sweep(
    handles: list[str],
    cookies_file: str | Path,
    log=print,
    user_agent: str | None = None,   # accepted for call-site compatibility; the browser sets its own
    record=None,                     # called per creator with (reels, cadence rows, snapshot)
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
                posts, profile = reader.posts(handle)
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
            # The same read, kept twice over: reels for scoring, everything for
            # cadence. Collecting it here costs nothing — the page is already open.
            if record is not None:
                record(
                    reels,
                    [r for r in (to_post(p, handle) for p in posts) if r],
                    to_snapshot(profile, handle) if profile else None,
                )
            kinds = {}
            for p in posts:
                k = KIND.get(p.get("media_type"))
                kinds[k] = kinds.get(k, 0) + 1
            story = "story" if (profile.get("latest_reel_media") or 0) else "-"
            log(f"  @{handle}: {len(reels)} reels · {kinds} · {story}")
    finally:
        reader.close()
    return sightings, access, stopped


def light_sweep(
    handles: list[str],
    cookies_file: str | Path,
    log=print,
) -> tuple[list[dict], str | None]:
    """The daily pass: one page load each, header only, no scrolling.

    This exists because stories expire. The Saturday sweep can say whether
    someone had a story up on Saturday morning and nothing more; only a daily
    reading can tell whether they post stories at all."""
    reader = Reader(cookies_file)
    snapshots: list[dict] = []
    stopped: str | None = None
    try:
        for index, handle in enumerate(handles):
            if index:
                time.sleep(random.uniform(*PAUSE_SEC))
            try:
                profile = reader.profile_only(handle)
            except BurnerStopped as error:
                stopped = str(error)
                log(f"  burner stopped: {error}")
                break
            except Exception as error:
                log(f"  ! @{handle}: {str(error)[:120]}")
                continue
            if not profile:
                continue
            snap = to_snapshot(profile, handle)
            snapshots.append(snap)
            log(f"  @{handle}: {snap['followers']} followers · "
                f"{'story ' + (snap['story_at'] or '') if snap['has_story'] else 'no story'}")
    finally:
        reader.close()
    return snapshots, stopped
