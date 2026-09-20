"""Scout: the weekly watchlist sweep. Run with `./bin/scout`.

Asks the app who is watched, lists each creator's recent reels (metadata only)
through two readers, and posts every sighting back. The app keeps them all,
measures each reel against its own creator's median, and queues the winners
into the ordinary transcribe queue — which this Mac's worker then drains.

    open accounts  → Apify's logged-out reel scraper   (scout_apify.py)
    gated accounts → a throwaway signed-in session      (scout_ig.py)

A creator the app has never swept, or has too few sightings of to take a
median from, gets a deep backfill. Everyone else gets the pick window
refreshed, because a reel's plays keep climbing for days after it posts.

Config lives in `config.json` under `scout`, never in the environment:

    "scout": {
      "apify_token": "apify_api_…",
      "burner_cookies": "secrets/scout-cookies.txt",
      "burner_user_agent": "…",   # the browser the burner signed in on; see scout_ig.USER_AGENT
      "max_usd_per_run": 5
    }
"""
from __future__ import annotations

import argparse
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from . import config, scout_apify, scout_browser, scout_ig

BACKFILL_REELS = 30
REFRESH_REELS = 30
REFRESH_SLACK_DAYS = 3
CHUNK = 500
DEFAULT_MAX_USD = 5.0
REQUEST_TIMEOUT_SEC = 120.0
POST_ATTEMPTS = 4


def log(message: str) -> None:
    print(message, flush=True)


class Cloud:
    def __init__(self, base: str, secret: str) -> None:
        self.base = base.rstrip("/")
        self.secret = secret

    def post(self, path: str, payload: dict) -> dict:
        """POST with retries: a Neon or Vercel blip must not cost a week."""
        for attempt in range(1, POST_ATTEMPTS + 1):
            try:
                return self._post_once(path, payload)
            except RuntimeError as error:
                if attempt == POST_ATTEMPTS or " → 4" in str(error):
                    raise
                log(f"  {path} failed ({error}); retrying in {attempt * 15}s")
                time.sleep(attempt * 15)
        return {}

    def _post_once(self, path: str, payload: dict) -> dict:
        request = urllib.request.Request(
            f"{self.base}{path}",
            data=json.dumps(payload).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.secret}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SEC) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:300]
            raise RuntimeError(f"{path} → {error.code}: {detail}") from error
        except (urllib.error.URLError, OSError) as error:
            raise RuntimeError(f"{path} → network: {error}") from error


def _settings() -> tuple[Cloud, dict]:
    user = config.load_user_config()
    url, secret = user.get("cloud_url"), user.get("worker_secret")
    if not url or not secret:
        sys.exit("config.json is missing cloud_url or worker_secret")
    return Cloud(url, secret), user.get("scout") or {}


def _resolve(path: str | None) -> Path | None:
    if not path:
        return None
    candidate = Path(path).expanduser()
    return candidate if candidate.is_absolute() else config.ROOT / candidate


def plan(creators: list[dict], min_baseline: int) -> dict[str, list[str]]:
    """Split the watchlist by reader and by depth."""
    groups: dict[str, list[str]] = {"backfill": [], "refresh": [], "gated": []}
    for creator in creators:
        handle = creator["handle"]
        if creator.get("access") == "gated":
            groups["gated"].append(handle)
        elif (creator.get("sightings") or 0) < min_baseline:
            groups["backfill"].append(handle)
        else:
            groups["refresh"].append(handle)
    return groups


def _apify_pass(handles: list[str], token: str, *, limit: int, newer_than: str | None,
                max_usd: float, stats: dict) -> tuple[list[dict], dict[str, str]]:
    if not handles:
        return [], {}
    try:
        items, info = scout_apify.run(handles, token, limit=limit, newer_than=newer_than,
                                      max_usd=max_usd, log=log)
    except scout_apify.ApifyError as error:
        log(f"  apify failed: {error}")
        stats["errors"].append(str(error)[:300])
        return [], {}
    stats["cost_usd"] += info["cost_usd"]
    sightings = [s for s in (scout_apify.to_sighting(i) for i in items) if s]
    access = scout_apify.access_from(items, handles)
    log(f"  apify {info['status'].lower()}: {len(items)} rows → {len(sightings)} reels, "
        f"${info['cost_usd']:.2f}")
    return sightings, access


def sweep(*, limit_handles: int | None, dry: bool, only: str | None) -> int:
    cloud, settings = _settings()
    run_id = datetime.now().strftime("%Y%m%d-%H%M") + "-" + secrets.token_hex(3)
    started = datetime.now(timezone.utc).isoformat()
    log(f"{datetime.now():%Y-%m-%d %H:%M:%S} scout run {run_id}")

    target = cloud.post("/api/scout/targets", {})
    creators = target.get("creators") or []
    if limit_handles:
        creators = creators[:limit_handles]
    groups = plan(creators, int(target.get("min_baseline") or 6))
    window = int(target.get("window_days") or 14) + REFRESH_SLACK_DAYS
    log(f"  {len(creators)} watched · backfill {len(groups['backfill'])} · "
        f"refresh {len(groups['refresh'])} · gated {len(groups['gated'])}")
    if dry:
        return 0

    stats: dict = {"handles": len(creators), "cost_usd": 0.0, "errors": [], "skipped": []}
    sightings: list[dict] = []
    access: dict[str, str] = {}
    budget = float(settings.get("max_usd_per_run") or DEFAULT_MAX_USD)

    token = settings.get("apify_token")
    if only != "burner":
        if not token:
            log("  no scout.apify_token in config.json — open accounts skipped")
            stats["skipped"].append("apify: no token")
        else:
            for handles, limit, newer in (
                (groups["backfill"], BACKFILL_REELS, None),
                (groups["refresh"], REFRESH_REELS, f"{window} days"),
            ):
                remaining = budget - stats["cost_usd"]
                if handles and remaining < 0.05:
                    log("  run budget spent — the rest wait for next week")
                    stats["skipped"].append(f"budget: {len(handles)} accounts")
                    continue
                found, learned = _apify_pass(handles, token, limit=limit, newer_than=newer,
                                             max_usd=remaining, stats=stats)
                sightings += found
                access.update(learned)

    # Anything Apify just found to be gated joins this week's burner pass
    # rather than waiting a week to be tried.
    gated = groups["gated"] + [h for h, a in access.items() if a == "gated" and h not in groups["gated"]]
    cookies = _resolve(settings.get("burner_cookies"))
    if gated and only != "apify":
        if not cookies or not cookies.is_file():
            log(f"  {len(gated)} gated accounts need the burner session — "
                f"export its cookies to {settings.get('burner_cookies') or 'secrets/scout-cookies.txt'}")
            stats["skipped"].append(f"burner: no cookies, {len(gated)} gated accounts")
        else:
            log(f"  burner: reading {len(gated)} gated accounts (slowly, on purpose)")
            try:
                found, learned, stopped = scout_browser.sweep(
                    gated, cookies, log=log, user_agent=settings.get("burner_user_agent"))
            except (scout_ig.BurnerStopped, FileNotFoundError) as error:
                found, learned, stopped = [], {}, str(error)
            sightings += found
            access.update(learned)
            if stopped:
                stats["errors"].append(f"burner stopped: {stopped}"[:300])
            log(f"  burner: {len(found)} reels from {len(learned)} accounts")

    stats["gated"] = sum(1 for a in access.values() if a == "gated")
    stats["sightings"] = len(sightings)
    swept = sorted({s["handle"] for s in sightings} | set(access))
    access_rows = [{"handle": h, "access": a} for h, a in access.items()]

    chunks = [sightings[i:i + CHUNK] for i in range(0, len(sightings), CHUNK)] or [[]]
    # Every chunk but the last only stores. A chunk that still fails after its
    # retries is recorded and skipped — its reels are simply picked up next
    # week — but the final call always goes, because it is the one that picks.
    result: dict = {}
    for index, chunk in enumerate(chunks):
        final = index == len(chunks) - 1
        body = {
            "run_id": run_id,
            "started_at": started,
            "sightings": chunk,
            "access": access_rows if index == 0 else [],
            "swept": swept if index == 0 else [],
            "final": final,
            "stats": stats if final else None,
        }
        try:
            result = cloud.post("/api/scout/ingest", body)
        except RuntimeError as error:
            if final:
                raise
            log(f"  ! chunk {index + 1}/{len(chunks)} not stored: {error}")
            stats["errors"].append(f"chunk {index + 1} not stored: {error}"[:300])

    log(f"  stored {len(sightings)} sightings · picked {result.get('picked', 0)} · "
        f"queued {result.get('queued', 0)} new · suggested {result.get('suggested', 0)} accounts · "
        f"${stats['cost_usd']:.2f}")
    spread = result.get("spread") or {}
    if spread.get("reels"):
        log(f"  spread over {spread['reels']} recent reels: p50 {spread.get('p50')}× · "
            f"p90 {spread.get('p90')}× · p95 {spread.get('p95')}× · "
            f"≥2× {spread.get('over_2')} · ≥3× {spread.get('over_3')}")
    for pick in (result.get("picks") or [])[:15]:
        log(f"    {pick['multiplier']}× {pick['basis']:<10} @{pick['handle']}  {pick['url']}")
    for error in stats["errors"]:
        log(f"  ! {error}")
    return 1 if stats["errors"] and not sightings else 0


def check_burner(handle: str) -> int:
    """One profile, one feed, printed — to prove a freshly exported burner
    session works before trusting it with a whole pass."""
    _, settings = _settings()
    cookies = _resolve(settings.get("burner_cookies"))
    if not cookies:
        sys.exit("set scout.burner_cookies in config.json first")
    # This is the tool you reach for when the session is in doubt, so a push-back
    # from Instagram is its *finding*, not a crash: report it and say which of
    # the two it is, because they need opposite fixes.
    try:
        found, _access, stopped = scout_browser.sweep([handle], cookies, log=log)
        if stopped:
            raise scout_ig.BurnerStopped(stopped)
        reels = sorted(found, key=lambda r: r.get("posted_at") or "", reverse=True)
    except scout_ig.BurnerStopped as error:
        log(f"burner stopped: {error}")
        if "429" in str(error):
            log("  Before guessing, separate the address from the session. Anonymously:")
            log("    curl -so/dev/null -w '%{http_code}\\n' -H 'X-IG-App-ID: 936619743392459' \\")
            log("      'https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram'")
            log("  401 there means the address is fine and the 429 belongs to this session or")
            log("  account — measured 2026-09-19, first authenticated call on a fresh jar. 429")
            log("  there means the Mac has simply asked for too much too recently; wait.")
            log("  A fresh session's first 429 is often transient: wait tens of minutes, retry")
            log("  once, and only then start changing headers.")
        else:
            log("  that reads as the session, not the address. Re-read the cookies from the")
            log("  phone (docs/SCOUT-SETUP.md, steps 6-9) and write the jar again.")
        return 1
    except FileNotFoundError as error:
        sys.exit(str(error))
    for s in reels[:8]:
        log(f"  {s['posted_at']}  plays {s['plays']}  likes {s['likes']}  comments {s['comments']}  "
            f"audio {s.get('audio_title')!r}  {s['post_id']}")
    log(f"{len(reels)} reels read")
    return 0 if reels else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="scout", description="Sweep the watchlist for winning reels.")
    parser.add_argument("--dry", action="store_true", help="show the plan, fetch nothing")
    parser.add_argument("--limit", type=int, help="sweep only the first N watched accounts")
    parser.add_argument("--only", choices=("apify", "burner"), help="run one reader only")
    parser.add_argument("--check-burner", metavar="HANDLE", help="test the burner session on one account")
    args = parser.parse_args(argv)
    if args.check_burner:
        return check_burner(args.check_burner.lstrip("@").lower())
    return sweep(limit_handles=args.limit, dry=args.dry, only=args.only)


if __name__ == "__main__":
    sys.exit(main())
