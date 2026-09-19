"""Scout's logged-out reader: Apify's Instagram Reel Scraper.

Metadata only. The actor lists each account's recent reels with plays, likes,
comments, audio and collaborators, and never downloads a video — the Mac still
fetches the few winners itself, exactly as it fetches a pasted link.

Priced per reel written (about $0.0023 on the Starter tier, checked against the
actor's own pricing record 2026-09-19), so every run carries a hard
`maxTotalChargeUsd`: a runaway input can cost the cap and never more.

Everything vendor-shaped lives in this file. If the actor renames a field or we
change provider, `to_sighting` is the one place that learns about it.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

ACTOR = "apify~instagram-reel-scraper"
API = "https://api.apify.com/v2"
POLL_SEC = 10.0
RUN_TIMEOUT_SEC = 45 * 60
REQUEST_TIMEOUT_SEC = 60.0
PAGE = 1_000
MAX_POLL_FAILURES = 5

# Words the actor uses when an account cannot be read logged out. Checked
# against its own issue tracker: 18+ accounts come back as restricted with
# "You must be 21 years old or over".
_GATED_HINTS = ("restrict", "age", "21 years", "18 years", "private", "login")
_MISSING_HINTS = ("not found", "not exist", "doesn't exist", "does not exist", "no such")


class ApifyError(RuntimeError):
    pass


def _request(method: str, url: str, token: str, payload: dict | None = None) -> dict | list:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SEC) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:300]
        raise ApifyError(f"Apify {method} {error.code}: {detail}") from error


def run(handles: list[str], token: str, *, limit: int, newer_than: str | None,
        max_usd: float, log=print) -> tuple[list[dict], dict]:
    """Run the actor over `handles` and wait for it. Returns (items, run info)."""
    actor_input: dict = {
        "username": handles,
        "resultsLimit": limit,
        "skipPinnedPosts": True,
    }
    if newer_than:
        actor_input["onlyPostsNewerThan"] = newer_than
    query = urllib.parse.urlencode({"maxTotalChargeUsd": f"{max_usd:.2f}"})
    started = _request("POST", f"{API}/acts/{ACTOR}/runs?{query}", token, actor_input)
    info = started.get("data", {}) if isinstance(started, dict) else {}
    run_id = info.get("id")
    if not run_id:
        raise ApifyError(f"Apify did not start a run: {started}")
    log(f"  apify run {run_id} · {len(handles)} accounts · ≤{limit} reels each · cap ${max_usd:.2f}")

    # The run is billed whether or not we manage to watch it finish, so a
    # failed poll or a timeout is never allowed to throw the results away:
    # the dataset id is known from the start and is read regardless.
    dataset_hint = info.get("defaultDatasetId")
    deadline = time.monotonic() + RUN_TIMEOUT_SEC
    poll_failures = 0
    while info.get("status") in (None, "READY", "RUNNING"):
        if time.monotonic() > deadline:
            log(f"  apify run {run_id} still running after {RUN_TIMEOUT_SEC // 60} min — reading what it has")
            _abort(run_id, token)
            break
        time.sleep(POLL_SEC)
        try:
            polled = _request("GET", f"{API}/actor-runs/{run_id}", token)
        except (ApifyError, urllib.error.URLError, OSError, ValueError) as error:
            poll_failures += 1
            if poll_failures >= MAX_POLL_FAILURES:
                log(f"  apify polling failed {poll_failures}× ({error}) — reading what it has")
                break
            continue
        poll_failures = 0
        info = (polled.get("data") if isinstance(polled, dict) else None) or info

    status = info.get("status") or "UNKNOWN"
    info.setdefault("defaultDatasetId", dataset_hint)
    # A run stopped by its own charge cap still wrote what it paid for, so the
    # dataset is read either way; only a failure with no dataset is fatal.
    if not info.get("defaultDatasetId"):
        raise ApifyError(f"Apify run {run_id} ended {status}")

    items: list[dict] = []
    dataset = info.get("defaultDatasetId")
    offset = 0
    while dataset:
        page = _request(
            "GET",
            f"{API}/datasets/{dataset}/items?clean=true&format=json&offset={offset}&limit={PAGE}",
            token,
        )
        rows = page if isinstance(page, list) else []
        items.extend(rows)
        if len(rows) < PAGE:
            break
        offset += PAGE
    return items, {
        "id": run_id,
        "status": status,
        "cost_usd": float(info.get("usageTotalUsd") or 0.0),
    }


def _abort(run_id: str, token: str) -> None:
    """Stop a run we have given up waiting for, so it cannot keep charging
    up to its cap after we have stopped listening."""
    try:
        _request("POST", f"{API}/actor-runs/{run_id}/abort", token, {})
    except (ApifyError, urllib.error.URLError, OSError, ValueError):
        pass


def _first(*values):
    return next((v for v in values if v not in (None, "", -1)), None)


def _names(entries) -> list[str]:
    out = []
    for entry in entries or []:
        if isinstance(entry, str):
            out.append(entry)
        elif isinstance(entry, dict):
            name = entry.get("username") or (entry.get("user") or {}).get("username")
            if name:
                out.append(name)
    return out


def _audio(item: dict) -> dict:
    """The actor's `musicInfo` has shifted shape over time; read every name
    it has used rather than trusting one."""
    music = item.get("musicInfo") or {}
    if not isinstance(music, dict):
        return {}
    asset = music.get("music_asset_info") or {}
    original = music.get("original_sound_info") or {}
    uses_original = _first(music.get("uses_original_audio"), bool(original) or None)
    return {
        "audio_id": _first(
            music.get("audio_id"), music.get("audio_cluster_id"), asset.get("audio_cluster_id"),
            music.get("music_asset_id"), original.get("audio_asset_id"), music.get("id"),
        ),
        "audio_title": _first(
            music.get("song_name"), music.get("title"), asset.get("title"),
            original.get("original_audio_title"),
        ),
        "audio_artist": _first(
            music.get("artist_name"), music.get("display_artist"), asset.get("display_artist"),
        ),
        "original_audio": bool(uses_original) if uses_original is not None else None,
    }


def to_sighting(item: dict) -> dict | None:
    """One actor row → the shape `/api/scout/ingest` validates."""
    code = item.get("shortCode")
    handle = (item.get("ownerUsername") or "").lower()
    if not code or not handle or item.get("error"):
        return None
    sighting = {
        "post_id": code,
        "handle": handle,
        "via": "apify",
        "posted_at": item.get("timestamp"),
        # `videoPlayCount` is THE field — see the note in cloud/src/lib/scout-apify.ts.
        # One measure for everybody, or a creator's median is not a baseline.
        "plays": _first(item.get("videoPlayCount"), item.get("igPlayCount"), item.get("videoViewCount")),
        "likes": item.get("likesCount"),
        "comments": item.get("commentsCount"),
        "duration_sec": item.get("videoDuration"),
        "caption": item.get("caption"),
        "collaborators": _names(item.get("coauthorProducers")),
        "tagged": _names(item.get("taggedUsers")),
        "pinned": bool(item.get("isPinned")),
    }
    sighting.update(_audio(item))
    return sighting


def access_from(items: list[dict], handles: list[str]) -> dict[str, str]:
    """What each account's run taught us: open, gated, or missing.

    An account that returned reels is open. One that returned only an error row
    is classified from the error's wording. One that returned nothing at all
    simply posted nothing in the window, which is not evidence either way."""
    wanted = {h.lower() for h in handles}
    seen: dict[str, str] = {}
    for item in items:
        handle = (item.get("ownerUsername") or "").lower()
        if not handle:
            source = str(item.get("inputUrl") or item.get("username") or "")
            handle = source.rstrip("/").split("/")[-1].lower()
        if handle not in wanted:
            continue
        if not item.get("error"):
            seen[handle] = "open"
            continue
        if seen.get(handle) == "open":
            continue
        message = " ".join(
            str(item.get(k) or "") for k in ("error", "errorDescription", "requestErrorMessages")
        ).lower()
        if item.get("isRestrictedProfile") or any(h in message for h in _GATED_HINTS):
            seen[handle] = "gated"
        elif any(h in message for h in _MISSING_HINTS):
            seen[handle] = "missing"
    return seen
