"""Instagram, read exactly the way the Mac reads it â€” browser, not API.

A line-for-line port of `src/scout_browser.py` and `src/scout_ig.to_sighting`
onto the worker's anti-detect stack (patchright), with one substitution: the
cookie jar arrives as an environment variable (`IG_COOKIES_B64`, a base64
Netscape jar captured on the Mac or a local PC with `capture_cookies.py`)
instead of a file on the machine, and the warm browser state lives on the
worker's volume.

Everything that made the Mac reader safe is kept verbatim:

* a real browser visits the pages a person would open and reads the JSON the
  site fetches for itself â€” no hand-built API calls, nothing parsed from the DOM;
* the jar is the floor, the saved browser state is the ceiling â€” Instagram
  refreshes a session as it is used, so a warm profile outlives a stale jar;
* one creator at a time, a random pause between them, full stop at the first
  login wall, HTTP 401/403/429, or warning page â€” the pass keeps whatever it
  read before the pushback and says where it stopped.
"""
from __future__ import annotations

import base64
import http.cookiejar
import os
import random
import time
import urllib.parse
from pathlib import Path

from patchright.sync_api import sync_playwright

from ofmpro import WorkerStopped

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))

# One burner is a session. A backup may retry missing profiles only after a
# clean primary pass; any pushback cools down all sessions first.
# Primary first; each keeps its own jar AND its own warm browser state,
# so two accounts can never share a session â€” the Mac's registry rule.
BURNERS = (
    {"label": "main", "jar": "ig-cookies.txt", "state": "ig-state.json",
     "jar_env": "IG_COOKIES_B64", "state_env": "IG_STATE_B64"},
    {"label": "backup", "jar": "ig-cookies-backup.txt", "state": "ig-state-backup.json",
     "jar_env": "IG_COOKIES_BACKUP_B64", "state_env": "IG_STATE_BACKUP_B64"},
)

PAUSE_SEC = (20.0, 35.0)
BREAK_EVERY = 20
BREAK_SEC = (60.0, 120.0)
SETTLE_MS = 5000
SCROLL_ROUNDS = 2
NAV_TIMEOUT_MS = 60_000
WALL = ("/accounts/login", "/challenge")

# The page Instagram serves for a handle it no longer resolves. Kept apart
# from a real miss: a gone account cannot be retried into existence, and the
# daily report should name it as deleted or renamed instead of repeating it
# under "missing" forever.
GONE_TEXT = ("sorry, this page isn't available", "page not found", "link you followed may be broken")

VIEWPORT = {"width": 1280, "height": 800}
LOCALE = "en-US"
TIMEZONE = "America/New_York"
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36")

# 1 photo, 2 video, 8 carousel. `product_type` separates a reel from a video
# posted to the feed, which matters because only one of them counts as a reel.
KIND = {1: "photo", 2: "video", 8: "carousel"}


class BurnerStopped(WorkerStopped):
    """Instagram pushed back. Stop the pass; a human needs to look."""


def _seed(jar_name: str, state_name: str, jar_env: str, state_env: str) -> Path:
    """One burner's env pair â†’ the volume, written only when it differs from
    what is already there: the same capture shipped on every boot must not
    overwrite the file the volume has been keeping, and a NEW capture
    (different bytes) always lands â€” that is a human saying the session moved."""
    jar_path = DATA_DIR / jar_name
    state_path = DATA_DIR / state_name
    encoded = os.environ.get(jar_env, "").strip()
    if encoded:
        raw = base64.b64decode(encoded)
        if not jar_path.is_file() or jar_path.read_bytes() != raw:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            jar_path.write_bytes(raw)
    state = os.environ.get(state_env, "").strip()
    if state:
        raw = base64.b64decode(state)
        if not state_path.is_file() or state_path.read_bytes() != raw:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            state_path.write_bytes(raw)
    return jar_path


def jars() -> list[tuple[str, Path, Path]]:
    """Every burner that has a jar on the volume, primary first."""
    found: list[tuple[str, Path, Path]] = []
    for burner in BURNERS:
        jar = _seed(burner["jar"], burner["state"], burner["jar_env"], burner["state_env"])
        if jar.is_file():
            found.append((burner["label"], jar, DATA_DIR / burner["state"]))
    return found


def jar_from_env() -> Path:
    """The primary jar, for callers that only want one (the local probe)."""
    found = jars()
    if not found:
        raise FileNotFoundError("no burner cookies â€” set IG_COOKIES_B64 or place a jar in DATA_DIR")
    return found[0][1]


def _cookies(path: Path) -> list[dict]:
    jar = http.cookiejar.MozillaCookieJar(str(path))
    jar.load(ignore_discard=True, ignore_expires=True)
    if not any(c.name == "sessionid" for c in jar):
        raise BurnerStopped(f"{path} has no Instagram sessionid")
    return [{
        "name": c.name, "value": c.value, "domain": ".instagram.com",
        "path": "/", "secure": True, "httpOnly": c.name == "sessionid",
    } for c in jar]


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


def _pace(index: int, log=print) -> None:
    """Space profile visits out and take a longer break during large rosters."""
    if not index:
        return
    time.sleep(random.uniform(*PAUSE_SEC))
    if index % BREAK_EVERY == 0:
        delay = random.uniform(*BREAK_SEC)
        log(f"  rate limit: resting {int(delay)}s after {index} profiles")
        time.sleep(delay)


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


# Keys Instagram hangs the real author off, in the order they are worth
# trusting. The caption's own user is included because several of the
# profile-page responses carry the author there and nowhere else.
_OWNER_PATHS = (("user", "username"), ("owner", "username"), ("caption", "user", "username"))

# What an injected item looks like. A sponsored reel in a profile's feed is
# still a media item with a pk and a code, so nothing upstream filters it.
_AD_KEYS = ("ad_id", "is_ad", "injected", "ad_metadata", "sponsor_tags", "ad_action")


def _dig(item: dict, path: tuple[str, ...]) -> str:
    node = item
    for key in path:
        if not isinstance(node, dict):
            return ""
        node = node.get(key)
    return str(node or "").lower()


def belongs_to(item: dict, handle: str) -> bool:
    """Is this post actually hers?

    The reader harvests every media item in every response the profile page
    makes, because the site nests them differently per query. Instagram
    injects sponsored and suggested reels into those same responses, so a
    Meta advert for VR glasses arrived stamped with a model's handle and sat
    at the top of her Top reels on 25 million plays.

    An item is hers when its own author is her, or when she is a credited
    coauthor. An item whose author is somebody else is dropped, and so is
    anything wearing an ad marker. An item with no author at all is KEPT:
    not every response carries one, and losing her real posts to a shape we
    do not recognise is the worse failure of the two.
    """
    if any(item.get(key) for key in _AD_KEYS):
        return False
    want = handle.lower()
    owner = next((found for path in _OWNER_PATHS if (found := _dig(item, path))), "")
    if not owner:
        return True
    if owner == want:
        return True
    coauthors = {
        str(c.get("username") or "").lower()
        for c in (item.get("coauthor_producers") or [])
        if isinstance(c, dict)
    }
    return want in coauthors


def to_sighting(item: dict, handle: str) -> dict | None:
    """One feed item â†’ the ingest shape. Photos and carousels are skipped:
    the library is reels, and a still has no plays to measure."""
    code = item.get("code")
    if not code or item.get("media_type") != 2:
        return None
    if not belongs_to(item, handle):
        return None
    clips = item.get("clips_metadata") or {}
    music = (clips.get("music_info") or {}).get("music_asset_info") or {}
    original = clips.get("original_sound_info") or {}
    caption = item.get("caption") or {}
    taken = item.get("taken_at")
    return {
        "post_id": code,
        "handle": handle,
        "via": "burner",
        "posted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(taken)) if taken else None,
        "plays": item.get("ig_play_count") or item.get("play_count") or item.get("view_count"),
        "likes": item.get("like_count"),
        "comments": item.get("comment_count"),
        "reposts": item.get("media_repost_count"),
        "caption": caption.get("text") if isinstance(caption, dict) else None,
        "audio_title": music.get("title") or original.get("original_audio_title"),
        "video_url": (item.get("video_versions") or [{}])[0].get("url"),
        "poster_url": ((item.get("image_versions2") or {}).get("candidates") or [{}])[0].get("url"),
    }


def to_post(item: dict, handle: str) -> dict | None:
    """One item â†’ the cadence record. Unlike `to_sighting` this keeps photos
    and carousels: "2-3 carousels a week" cannot be measured from reels alone."""
    code = item.get("code")
    if not code or not belongs_to(item, handle):
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
        "reposts": item.get("media_repost_count"),
        "caption": caption.get("text") if isinstance(caption, dict) else None,
        "audio_title": music.get("title") or original.get("original_audio_title"),
        "is_paid_partnership": item.get("is_paid_partnership"),
        "collaborators": [
            c.get("username") for c in (item.get("coauthor_producers") or []) if c.get("username")
        ],
        "video_url": (item.get("video_versions") or [{}])[0].get("url") if kind == "reel" else None,
        "poster_url": ((item.get("image_versions2") or {}).get("candidates") or [{}])[0].get("url"),
    }


def to_snapshot(profile: dict, handle: str) -> dict:
    """The account as it stands right now. `latest_reel_media` is the timestamp
    of the most recent story and is 0 when none is live â€” the only way to see
    stories at all from outside, which is why a story read has to run daily."""
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


class Reader:
    """One browser, one burner, reused across the sweep. Launching is the
    expensive part; the state file is that burner's own warm session."""

    def __init__(self, cookies_file: Path, state_file: Path) -> None:
        if not Path(cookies_file).is_file():
            raise FileNotFoundError(f"burner cookies not found at {cookies_file}")
        self._state_file = state_file
        self._play = sync_playwright().start()
        # The anti-detect Chromium, headless by default; IG_HEADLESS=0 opens a
        # real window for the local probe. Canvas/WebGL fingerprints and the
        # `navigator.webdriver` tell are what patchright patches out.
        self._browser = self._play.chromium.launch(
            headless=os.environ.get("IG_HEADLESS", "1") != "0",
            args=["--disable-blink-features=AutomationControlled"],
        )
        major = str(self._browser.version).split(".")[0]
        self._ctx = self._browser.new_context(
            viewport=VIEWPORT,
            locale=LOCALE,
            timezone_id=TIMEZONE,
            user_agent=USER_AGENT.format(major=major),
            storage_state=str(self._state_file) if self._state_file.is_file() else None,
        )
        # The jar is the floor, not the ceiling: adding it after the saved
        # state means a hand-captured session always wins over a warmed one.
        self._ctx.add_cookies(_cookies(Path(cookies_file)))
        self._want = ""

    def _save(self) -> None:
        """Keep whatever Instagram handed back, so the next run â€” same burner â€”
        starts fresher than this one did."""
        try:
            self._ctx.storage_state(path=str(self._state_file))
        except Exception:
            pass

    def close(self) -> None:
        self._save()
        for shut in (self._ctx.close, self._browser.close, self._play.stop):
            try:
                shut()
            except Exception:
                pass

    def _visit(self, url: str) -> tuple[dict[str, dict], dict, str | None]:
        """Open a page and keep every post the site fetched, keyed by pk.

        Returns the posts, the account header, and — when the requested
        handle's own header never arrived — why: "renamed to @x" if Instagram
        landed on a different username for this address, "gone" if the page is
        the one it serves for an account that no longer exists, else None. The
        caller reports that instead of a blanket "header not present".
        """
        found: dict[str, dict] = {}
        profile: dict = {}
        headers: dict[str, dict] = {}
        blocked: list[str] = []
        note: str | None = None
        page = self._ctx.new_page()

        def collect(response):
            if "instagram.com" in response.url and response.status in (401, 403, 429):
                retry_after = response.headers.get("retry-after")
                retry_note = f" retry-after={retry_after}" if retry_after else ""
                blocked.append(f"Instagram HTTP {response.status}{retry_note} at {response.url.split('?')[0]}")
                return
            if "/graphql" not in response.url and "/api/graphql" not in response.url:
                return
            try:
                body = response.json()
            except Exception:
                return
            for who in _profiles(body):
                name = str(who.get("username") or "").lower()
                if not name:
                    continue
                clean = {k: v for k, v in who.items() if v is not None}
                if name == self._want:
                    profile.update(clean)
                else:
                    headers[name] = clean
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
            if not profile:
                # The handle's header never arrived: say what the page was
                # instead of leaving the caller to guess.
                landed = urllib.parse.urlparse(page.url).path.strip("/").split("/")[0].lower()
                if landed and landed != self._want and landed in headers:
                    profile = headers[landed]
                    note = f"renamed to @{landed}"
                elif any(marker in body_text for marker in GONE_TEXT):
                    note = "gone"
        finally:
            try:
                page.close()
            except Exception:
                pass
        return found, profile, note

    def posts(self, handle: str) -> tuple[list[dict], dict]:
        """Both tabs, merged, plus the account header. Items are the shape
        `to_sighting` and `to_post` expect."""
        self._want = handle.lower()
        merged, profile, _note = self._visit(f"https://www.instagram.com/{handle}/")
        time.sleep(random.uniform(5.0, 10.0))
        more, also, _note = self._visit(f"https://www.instagram.com/{handle}/reels/")
        for key, item in more.items():
            merged.setdefault(key, {}).update({k: v for k, v in item.items() if v is not None})
        profile.update({k: v for k, v in also.items() if v is not None})
        return list(merged.values()), profile

    def profile_only(self, handle: str) -> tuple[dict, str | None]:
        """The header alone — one page load, no scrolling. The daily pass:
        cheap enough for the whole watchlist, and the only way to catch a
        story before it expires. The second value says why a header might be
        absent (see `_visit`)."""
        self._want = handle.lower()
        _, profile, note = self._visit(f"https://www.instagram.com/{handle}/")
        return profile, note


def sweep(handles: list[str], cookies_file: Path, state_file: Path,
          log=print, record=None) -> tuple[list[dict], dict[str, str], str | None]:
    """Same contract as the Mac's: (sightings, access, stop reason). A stop is
    not an exception to the caller — whatever was read before Instagram pushed
    back is still worth posting."""
    reader = Reader(cookies_file, state_file)
    sightings: list[dict] = []
    access: dict[str, str] = {}
    stopped: str | None = None
    try:
        for index, handle in enumerate(handles):
            _pace(index, log)
            try:
                posts, profile = reader.posts(handle)
            except BurnerStopped as error:
                stopped = str(error)
                log(f"  burner stopped: {error}")
                break
            except Exception as error:  # one bad profile must not end the pass
                access[handle] = "missing"
                log(f"  ! @{handle}: {str(error)[:120]}")
                continue
            reels = [s for s in (to_sighting(p, handle) for p in posts) if s]
            access[handle] = "open" if reels else "missing"
            sightings += reels
            # The same read, kept twice over: reels for scoring, everything for
            # cadence. Collecting it here costs nothing â€” the page is already open.
            if record is not None:
                record(
                    reels,
                    [r for r in (to_post(p, handle) for p in posts) if r],
                    to_snapshot(profile, handle) if profile else None,
                )
            log(f"  @{handle}: {len(reels)} reels Â· {len(posts)} items")
    finally:
        reader.close()
    return sightings, access, stopped


def light_sweep(handles: list[str], cookies_file: Path, state_file: Path,
                log=print) -> tuple[list[dict], list[str], dict[str, str], dict[str, str], str | None]:
    """The daily pass: one page load each, header only, no scrolling. Stories
    expire, so a weekly reading can never show one posted midweek.

    Returns (snapshots, missing, gone, renamed, stop reason). `missing` is
    only handles that failed for an unknown reason; `gone` maps a handle to
    the reason Instagram no longer serves it (deleted, renamed without a
    landing username, suspended); `renamed` maps the tracked handle to the
    username Instagram now lands on. The caller reports the three apart —
    a gone account is not a refresh that "failed", and retrying it with the
    backup session is pointless.
    """
    reader = Reader(cookies_file, state_file)
    snapshots: list[dict] = []
    missing: list[str] = []
    gone: dict[str, str] = {}
    renamed: dict[str, str] = {}
    stopped: str | None = None
    try:
        for index, handle in enumerate(handles):
            _pace(index, log)
            try:
                profile, note = reader.profile_only(handle)
            except BurnerStopped as error:
                stopped = str(error)
                log(f"  burner stopped: {error}")
                missing.extend(handles[index:])
                break
            except Exception as error:
                log(f"  ! @{handle}: {str(error)[:120]}")
                missing.append(handle)
                continue
            if not profile:
                if note == "gone":
                    gone[handle] = "gone"
                    log(f"  ! @{handle}: Instagram says this page is not available")
                else:
                    log(f"  ! @{handle}: profile header was not present in Instagram response")
                    missing.append(handle)
                continue
            snap = to_snapshot(profile, handle)
            if snap["followers"] is None:
                log(f"  ! @{handle}: profile header had no follower count")
                missing.append(handle)
                continue
            snapshots.append(snap)
            if note and note.startswith("renamed to @"):
                renamed[handle] = note.removeprefix("renamed to @")
                log(f"  @{handle}: {snap['followers']} followers Â· {note}")
            else:
                log(f"  @{handle}: {snap['followers']} followers Â· "
                    f"{'story ' + (snap['story_at'] or '') if snap['has_story'] else 'no story'}")
    finally:
        reader.close()
    return snapshots, list(dict.fromkeys(missing)), gone, renamed, stopped
