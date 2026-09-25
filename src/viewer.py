"""The viewer burner: opens reels Instagram only shows signed-in accounts, the
way a person would, and hands the video link to the worker.

Why this exists (2026-09-25): the downloader reached gated reels with Geno's
own account's cookie, pulled 62 of them back to back, and Instagram warned his
account for automated behaviour. His account is out of every automated path
now. What is left needs *some* signed-in account to look at each reel, so:

* **A dedicated burner** — not Geno's, not Scout's. If Instagram flags it,
  nothing else goes with it. Signed in with `./bin/scout-login --viewer`, into
  its own files (`secrets/viewer-cookies.txt`, `viewer-state.json`).
* **A real browser that looks like one.** Ordinary desktop Chrome on a Mac —
  not "HeadlessChrome", which is the first thing a bot check reads — the same
  window size and saved session every time, like one phone.
* **A person's pace.** It opens the home feed first, then each reel, stays on
  it for a few seconds, and waits 1–3 minutes before the next. At most
  `PER_RUN` a run, `PER_HOUR` an hour, `PER_DAY` a day, only in waking hours,
  never while a Scout pass is running or about to.
* **It reads, it never asks.** The video link comes from the responses the page
  loads for itself, as `scout_browser` does. The worker then fetches the file
  from Instagram's video servers, which is not an account action.
* **One strike and it stops.** A login wall, a challenge or a warning ends the
  day's viewing, posts to the OPS group, and is never retried into.

    ./bin/viewer            # one run (launchd calls this every 20 minutes)
    ./bin/viewer --check    # is the viewer signed in? one page, no reels
    ./bin/viewer --status   # budget and what is waiting, no browser
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import http.cookiejar
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from . import alerts, config, ig_browser

JAR = config.ROOT / "secrets" / "viewer-cookies.txt"
STATE = config.ROOT / "secrets" / "viewer-state.json"
BUDGET = config.ROOT / "secrets" / "viewer-budget.json"
LOCK = config.ROOT / "secrets" / ".instagram-browser.lock"

PER_RUN = 5
PER_HOUR = 15
PER_DAY = 60
GAP_SEC = (60.0, 180.0)          # between two reels
WATCH_SEC = (6.0, 14.0)          # time on a reel's page, as if watching it
FEED_SEC = (4.0, 9.0)            # the home feed first, like opening the app
AWAKE = range(9, 23)             # local hours it may run: 09:00-22:59
# Scout's own passes, local time: (weekday or None for daily, hour, minute).
# The viewer keeps 45 minutes clear before each, so two browsers never share
# this connection at once. 5 = Saturday (Python's Monday=0).
SCOUT_PASSES = [(None, 19, 0), (5, 10, 0), (5, 16, 0)]
CLEAR_BEFORE_MIN = 45
CLEAR_AFTER_MIN = 60

NAV_TIMEOUT_MS = 60_000
WALL = ("/accounts/login", "/challenge", "/accounts/suspended", "/accounts/disabled")
# Instagram's own wording on its warning screens. Kept to phrases a caption is
# unlikely to contain, so a reel about "suspicious" exes does not end the day.
WARNING_WORDS = ("automated behavior", "automated behaviour", "try again later",
                 "we restrict certain activity")
SHORTCODE = re.compile(r"/(?:reels?|p)/([A-Za-z0-9_-]+)")


def log(message: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


# ------------------------------------------------------------------ budget

def _load_budget() -> dict:
    try:
        return json.loads(BUDGET.read_text())
    except (OSError, ValueError):
        return {"views": []}


def _save_budget(budget: dict) -> None:
    BUDGET.parent.mkdir(parents=True, exist_ok=True)
    budget["views"] = [t for t in budget.get("views", []) if t > time.time() - 86_400]
    BUDGET.write_text(json.dumps(budget, indent=1))
    os.chmod(BUDGET, 0o600)


def _room(budget: dict) -> int:
    """How many reels may be opened right now."""
    now = time.time()
    views = budget.get("views", [])
    hour = sum(1 for t in views if t > now - 3600)
    day = sum(1 for t in views if t > now - 86_400)
    return max(0, min(PER_RUN, PER_HOUR - hour, PER_DAY - day))


def _stopped(budget: dict) -> str | None:
    until = budget.get("stopped_until", 0)
    if until > time.time():
        return f"stopped until {dt.datetime.fromtimestamp(until):%a %H:%M} — {budget.get('stopped_why', '')}"
    return None


def _stop_for_the_day(budget: dict, why: str) -> None:
    tomorrow = dt.datetime.now() + dt.timedelta(days=1)
    budget["stopped_until"] = tomorrow.replace(hour=AWAKE.start, minute=0, second=0).timestamp()
    budget["stopped_why"] = why


def _quiet_now(now: dt.datetime) -> str | None:
    if now.hour not in AWAKE:
        return "outside waking hours"
    for weekday, hour, minute in SCOUT_PASSES:
        if weekday is not None and now.weekday() != weekday:
            continue
        start = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if start - dt.timedelta(minutes=CLEAR_BEFORE_MIN) <= now <= start + dt.timedelta(minutes=CLEAR_AFTER_MIN):
            return f"clear of Scout's {hour:02d}:{minute:02d} pass"
    return None


def _scout_running() -> bool:
    found = subprocess.run(["pgrep", "-f", "src.scout "], capture_output=True, text=True)
    return bool(found.stdout.strip())


# ------------------------------------------------------------------- cloud

def _cloud(method: str, path: str, payload: dict | None = None) -> dict:
    settings = config.load_user_config()
    base = str(settings.get("cloud_url") or "").rstrip("/")
    secret = settings.get("worker_secret")
    if not base or not secret:
        raise RuntimeError("cloud_url and worker_secret are needed in config.json")
    request = urllib.request.Request(
        f"{base}{path}", method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


# ----------------------------------------------------------------- browser

def _cookies() -> list[dict]:
    jar = http.cookiejar.MozillaCookieJar(str(JAR))
    jar.load(ignore_discard=True, ignore_expires=True)
    if not any(c.name == "sessionid" for c in jar):
        raise RuntimeError("the viewer's cookie file has no sessionid")
    return [{"name": c.name, "value": c.value, "domain": ".instagram.com", "path": "/",
             "secure": True, "httpOnly": c.name == "sessionid"} for c in jar]


def _walk(node):
    if isinstance(node, dict):
        if node.get("code") and ("video_versions" in node or "image_versions2" in node):
            yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


class Viewer:
    def __init__(self) -> None:
        from playwright.sync_api import sync_playwright
        self._play = sync_playwright().start()
        # The installed Chrome, dressed as an ordinary one (ig_browser.py).
        self._browser = ig_browser.launch(self._play, headless=True)
        self._ctx = self._browser.new_context(**ig_browser.context_options(
            self._browser,
            storage_state=str(STATE) if STATE.is_file() else None,
        ))
        self._ctx.add_cookies(_cookies())

    def close(self) -> None:
        try:
            self._ctx.storage_state(path=str(STATE))
            os.chmod(STATE, 0o600)
        except Exception:
            pass
        for shut in (self._ctx.close, self._browser.close, self._play.stop):
            try:
                shut()
            except Exception:
                pass

    def _open(self, url: str, dwell: tuple[float, float], scroll: bool = False):
        """Open a page, stay a while, and return (every media item it loaded,
        the page's final URL, its visible text)."""
        items: list[dict] = []
        page = self._ctx.new_page()

        def collect(response):
            if "instagram.com" not in response.url or "json" not in (response.headers.get("content-type") or ""):
                return
            try:
                items.extend(_walk(response.json()))
            except Exception:
                pass

        page.on("response", collect)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
            page.wait_for_timeout(random.uniform(*dwell) * 1000)
            if scroll:
                page.mouse.wheel(0, random.randint(600, 1600))
                page.wait_for_timeout(random.uniform(1.5, 3.5) * 1000)
            # A reel opened directly often ships its data inside the page
            # rather than in a later fetch.
            for text in page.eval_on_selector_all(
                    'script[type="application/json"]', "els => els.map(e => e.textContent)"):
                try:
                    items.extend(_walk(json.loads(text)))
                except Exception:
                    continue
            final = page.url
            try:
                body = page.inner_text("body")[:4000].lower()
            except Exception:
                body = ""
        finally:
            try:
                page.close()
            except Exception:
                pass
        return items, final, body

    def blocked(self, final: str, body: str) -> str | None:
        if any(w in final for w in WALL):
            return f"Instagram sent the viewer to {final}"
        hit = next((w for w in WARNING_WORDS if w in body), None)
        return f"Instagram showed a warning (\"{hit}\")" if hit else None

    def feed(self) -> str | None:
        """The home feed, as anyone opening the app would see first."""
        _, final, body = self._open("https://www.instagram.com/", FEED_SEC, scroll=True)
        return self.blocked(final, body)

    def reel(self, url: str) -> tuple[str | None, str | None, str | None]:
        """(video_url, poster_url, blocked_reason)."""
        code_match = SHORTCODE.search(url)
        code = code_match.group(1) if code_match else None
        clean = f"https://www.instagram.com/reel/{code}/" if code else url
        items, final, body = self._open(clean, WATCH_SEC)
        stop = self.blocked(final, body)
        if stop:
            return None, None, stop
        for item in items:
            if code and item.get("code") != code:
                continue
            video = (item.get("video_versions") or [{}])[0].get("url")
            poster = ((item.get("image_versions2") or {}).get("candidates") or [{}])[0].get("url")
            if video:
                return video, poster, None
        return None, None, None


# --------------------------------------------------------------------- run

def _alert_stop(why: str) -> None:
    alerts.send(
        f"⚠️ Viewer burner stopped for the day.\n{why}\n\n"
        "It will not retry until tomorrow. If it keeps happening, sign it in again with:\n"
        "! cd ~/projects/social-transcriber && ./bin/scout-login --viewer\n"
        "(that writes only the viewer's files — Scout's login is untouched)",
        log=log,
    )


def run_once() -> int:
    if not JAR.is_file():
        log("no viewer account yet — sign one in with ./bin/scout-login --viewer")
        return 0
    budget = _load_budget()
    reason = _stopped(budget) or _quiet_now(dt.datetime.now())
    if reason:
        log(f"not viewing: {reason}")
        return 0
    room = _room(budget)
    if room == 0:
        log("not viewing: hourly or daily budget used")
        return 0
    if _scout_running():
        log("not viewing: a Scout pass is running")
        return 0

    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            log("not viewing: another viewer run holds the lock")
            return 0

        jobs = (_cloud("GET", "/api/worker/viewed").get("jobs") or [])[:room]
        if not jobs:
            log("nothing waiting")
            return 0

        stop: str | None = None
        viewer = Viewer()
        try:
            stop = viewer.feed()
            for index, job in enumerate(jobs):
                if stop:
                    break
                if index:
                    gap = random.uniform(*GAP_SEC)
                    log(f"  waiting {gap:.0f}s before the next reel")
                    time.sleep(gap)
                video, poster, stop = viewer.reel(job["source"])
                budget.setdefault("views", []).append(time.time())
                if stop:
                    break
                result = _cloud("POST", "/api/worker/viewed", {
                    "job_id": job["id"], "video_url": video, "poster_url": poster,
                    "error": None if video else "no video link on the page",
                })
                log(f"  {job['source']} → {'queued for download' if result.get('requeued') else 'no link found'}")
        finally:
            viewer.close()
            if stop:
                log(f"STOPPED: {stop}")
                _stop_for_the_day(budget, stop)
                _alert_stop(stop)
            _save_budget(budget)
    return 1 if stop else 0


def check() -> int:
    """Is the viewer signed in? The home feed only — no reels, no budget."""
    if not JAR.is_file():
        log("no viewer account yet — sign one in with ./bin/scout-login --viewer")
        return 1
    viewer = Viewer()
    try:
        stop = viewer.feed()
    finally:
        viewer.close()
    log(f"VIEWER {'BLOCKED — ' + stop if stop else 'ALIVE — the home feed opened signed in'}")
    return 1 if stop else 0


def status() -> int:
    budget = _load_budget()
    now = time.time()
    views = budget.get("views", [])
    log(f"viewer account: {'signed in (file present)' if JAR.is_file() else 'none yet'}")
    log(f"last hour {sum(1 for t in views if t > now - 3600)}/{PER_HOUR} · "
        f"last day {sum(1 for t in views if t > now - 86_400)}/{PER_DAY}")
    log(_stopped(budget) or _quiet_now(dt.datetime.now()) or "free to view now")
    try:
        log(f"waiting to be viewed: {len(_cloud('GET', '/api/worker/viewed').get('jobs') or [])} (first 20)")
    except Exception as error:
        log(f"could not ask the app: {str(error)[:120]}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="viewer", description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="is the viewer signed in?")
    parser.add_argument("--status", action="store_true", help="budget and queue, no browser")
    args = parser.parse_args(argv)
    if args.check:
        return check()
    if args.status:
        return status()
    return run_once()


if __name__ == "__main__":
    sys.exit(main())
