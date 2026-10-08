"""Scout's logged-in reader, for the accounts no logged-out reader can open.

Half the watchlist is age-gated or audience-restricted (97 of 194, probed
2026-09-19). Instagram only shows those to a signed-in adult, so they are read
here, on the Mac, with the cookies of a **throwaway account made for this and
nothing else** — never Geno's, never a model's, never the `cookies_file` the
worker uses for gated fetches. If Instagram ever locks this account, the only
thing lost is this half of the sweep.

The account is protected by behaving like a slow human:

* one profile request and one feed request per creator, once a week;
* a random 8–15 s pause between creators;
* the whole pass stops at the first sign of a challenge, a login wall or a
  rate limit, and says so, instead of pushing through and getting the
  account flagged.

These are the private web endpoints the Instagram site itself calls. They are
not a published API and can change without notice; everything that knows
their shape is in this file.
"""
from __future__ import annotations

import http.cookiejar
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

APP_ID = "936619743392459"  # the Instagram web app's public id, sent by the site on every call

# Must match the client whose endpoints are being called — **not** the browser
# that created the session. Everything below is the *desktop* web client:
# `web_profile_info` and `feed/user` with APP_ID above. So this is a desktop
# browser, and pairing a mobile user-agent with the desktop app id is the
# mismatch to avoid.
#
# The session itself travels: it is created in Safari on a tethered iPhone
# (docs/SCOUT-SETUP.md) and used here, because Instagram does not bind a web
# sessionid to a user-agent. Measured 2026-09-19 — the phone was loading reels on
# that same session while this reader carried it far enough to be rate-limited
# (429) rather than rejected as invalid (401).
#
# Override with `scout.burner_user_agent` rather than editing this.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
)
PAUSE_SEC = (8.0, 15.0)
FEED_COUNT = 24
REQUEST_TIMEOUT_SEC = 30.0


class BurnerStopped(RuntimeError):
    """Instagram pushed back. Stop the pass; a human needs to look."""


class Burner:
    def __init__(self, cookies_file: str | Path, user_agent: str | None = None) -> None:
        self._ua = (user_agent or "").strip() or USER_AGENT
        path = Path(cookies_file).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f"burner cookies not found at {path}")
        jar = http.cookiejar.MozillaCookieJar(str(path))
        jar.load(ignore_discard=True, ignore_expires=True)
        if not any(c.name == "sessionid" and "instagram.com" in c.domain for c in jar):
            raise BurnerStopped(
                f"{path} has no Instagram sessionid — export cookies while signed in to the burner"
            )
        self._csrf = next((c.value for c in jar if c.name == "csrftoken"), "")
        self._opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def _get(self, url: str) -> dict:
        request = urllib.request.Request(url, headers={
            "User-Agent": self._ua,
            "X-IG-App-ID": APP_ID,
            "X-CSRFToken": self._csrf,
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://www.instagram.com/",
            "Accept": "*/*",
        })
        try:
            with self._opener.open(request, timeout=REQUEST_TIMEOUT_SEC) as response:
                final = response.geturl()
                body = response.read()
        except urllib.error.HTTPError as error:
            text = error.read().decode(errors="replace")[:300]
            if error.code == 404:
                return {"_missing": True}
            if error.code in (401, 403, 429) or "checkpoint" in text or "login_required" in text:
                raise BurnerStopped(f"Instagram answered {error.code}: {text}") from error
            raise
        if "/accounts/login" in final or "/challenge" in final:
            raise BurnerStopped(f"redirected to {final} — the burner session needs signing in again")
        try:
            data = json.loads(body)
        except ValueError as error:
            raise BurnerStopped("Instagram returned a page, not data — session likely expired") from error
        if data.get("message") in ("checkpoint_required", "login_required", "challenge_required"):
            raise BurnerStopped(f"Instagram: {data.get('message')}")
        return data

    def profile(self, handle: str) -> dict | None:
        query = urllib.parse.urlencode({"username": handle})
        data = self._get(f"https://www.instagram.com/api/v1/users/web_profile_info/?{query}")
        if data.get("_missing"):
            return None
        return (data.get("data") or {}).get("user")

    def reels(self, user_id: str) -> list[dict]:
        data = self._get(f"https://www.instagram.com/api/v1/feed/user/{user_id}/?count={FEED_COUNT}")
        return data.get("items") or []


def _names(entries) -> list[str]:
    out = []
    for entry in entries or []:
        user = entry.get("user") if isinstance(entry, dict) and "user" in entry else entry
        if isinstance(user, dict) and user.get("username"):
            out.append(user["username"])
    return out


def to_sighting(item: dict, handle: str) -> dict | None:
    """One feed item → the ingest shape. Photos and carousels are skipped:
    the library is reels, and a still has no plays to measure."""
    code = item.get("code")
    if not code or item.get("media_type") != 2:
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
        # Instagram-only plays when available; fall back through the variants
        # the signed-in web client has returned.
        "plays": item.get("ig_play_count") or item.get("play_count") or item.get("view_count"),
        "likes": item.get("like_count"),
        "comments": item.get("comment_count"),
        "duration_sec": item.get("video_duration"),
        "caption": caption.get("text") if isinstance(caption, dict) else None,
        "audio_id": music.get("audio_cluster_id") or original.get("audio_asset_id"),
        "audio_title": music.get("title") or original.get("original_audio_title"),
        "audio_artist": music.get("display_artist"),
        "original_audio": bool(original) if (original or music) else None,
        "collaborators": _names(item.get("coauthor_producers")),
        "tagged": _names((item.get("usertags") or {}).get("in")),
        # A pinned reel carries the ids of the profiles it is pinned on.
        "pinned": bool(item.get("timeline_pinned_user_ids")),
        # Read media URLs from the feed's own version lists.
        "video_url": (item.get("video_versions") or [{}])[0].get("url"),
        "poster_url": ((item.get("image_versions2") or {}).get("candidates") or [{}])[0].get("url"),
    }


def sweep(
    handles: list[str],
    cookies_file: str | Path,
    log=print,
    user_agent: str | None = None,
) -> tuple[list[dict], dict[str, str], str | None]:
    """Read each handle's recent reels. Returns (sightings, access, stop reason).

    A stop is not an exception to the caller: whatever was read before
    Instagram pushed back is still worth posting, and the reason is reported
    so the next run is not blind to it."""
    burner = Burner(cookies_file, user_agent)
    sightings: list[dict] = []
    access: dict[str, str] = {}
    for index, handle in enumerate(handles):
        if index:
            time.sleep(random.uniform(*PAUSE_SEC))
        try:
            user = burner.profile(handle)
            if user is None:
                access[handle] = "missing"
                continue
            if user.get("is_private") and not user.get("followed_by_viewer"):
                log(f"  {handle}: private, skipped")
                continue
            time.sleep(random.uniform(2.0, 4.0))
            for item in burner.reels(str(user.get("id"))):
                sighting = to_sighting(item, handle)
                if sighting:
                    sightings.append(sighting)
            access[handle] = "gated"
        except BurnerStopped as stop:
            log(f"  burner stopped at {handle} ({index}/{len(handles)}): {stop}")
            return sightings, access, str(stop)
        except (urllib.error.URLError, OSError, ValueError) as error:
            log(f"  {handle}: {error}")
    return sightings, access, None
