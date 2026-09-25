"""Are both Instagram logins still alive? Say so on Telegram when one dies.

Two accounts, two jars, and neither announces its own death:

* **The downloader** (`secrets/cookies.txt`, yt-dlp). When Instagram ends the
  session, yt-dlp saves the jar back without its `sessionid` and every gated
  reel fails as "could not download … tried anonymously, then with cookies".
  That is how 62 reels failed quietly from 2026-09-22 until Geno pasted the
  queue on 2026-09-25.
* **Scout's burner** (`secrets/scout-cookies.txt`, the browser reader). A dead
  one just stops producing rows.

Each check proves the login rather than trusting the file:

* downloader — resolve one reel Instagram hides from logged-out visitors, with
  a *copy* of the jar so a failure cannot rewrite the real one;
* burner — the same one-page read `./bin/scout --session` does.

A probe that fails for any other reason (the reel was deleted, the network is
down) is reported as the probe being broken, not as a dead login, so a false
alarm does not send Geno off to sign in for nothing.

Alerts go out on a change — alive to dead, dead to alive — and once a day while
a login stays dead. State lives in `secrets/session-health.json`.

    ./bin/session-check              # both; alert on change
    ./bin/session-check --downloader # just the downloader (what the worker calls)
    ./bin/session-check --test-alert # prove Telegram works
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from . import alerts, config, media

STATE = config.ROOT / "secrets" / "session-health.json"
# Magnus's 9.3x winner: Instagram shows it to signed-in accounts only, which is
# exactly the property the probe needs. Override with `session_probe_url` in
# config.json if it is ever taken down.
DEFAULT_PROBE = "https://www.instagram.com/reel/DctJJRFRE5I/"
PROBE_TIMEOUT_SEC = 90
REMIND_EVERY_SEC = 24 * 60 * 60
# The worker calls this on every login-type failure; a batch of 60 must not
# become 60 probes.
MIN_GAP_SEC = 30 * 60

FIX = {
    "downloader": (
        "Fix: in Chrome, signed in as the DOWNLOADER account, copy the Cookie header "
        "(DevTools → Network → www.instagram.com → Request Headers → cookie → Copy value), then in "
        "Claude Code:\n"
        "! cd ~/projects/social-transcriber && pbpaste | ./bin/scout-cookies --header --path secrets/cookies.txt\n"
        "(one line — and keep --path, or it overwrites Scout's login)"
    ),
    "scout": (
        "Fix: ! cd ~/projects/social-transcriber && ./bin/scout-login  — sign in as the BURNER, "
        "then ./bin/scout --session should say SESSION ALIVE."
    ),
}
NAME = {"downloader": "Downloader login", "scout": "Scout (burner) login"}


def log(message: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


def _has_session(jar: Path) -> bool:
    try:
        return any(line.split("\t")[5:6] == ["sessionid"] and line.split("\t")[6].strip()
                   for line in jar.read_text().splitlines() if not line.startswith("#"))
    except (OSError, IndexError):
        return False


def check_downloader(user_config: dict) -> tuple[str, str]:
    """('alive' | 'dead' | 'unknown' | 'off', why)."""
    raw = user_config.get("cookies_file")
    if not raw:
        # Deliberate since 2026-09-25: no personal account's cookies are used
        # by the downloader, so there is no login here to die.
        return "off", "the downloader uses no login"
    jar = (config.ROOT / raw).expanduser()
    if not jar.is_file():
        return "dead", "the configured cookie file is missing"
    if not _has_session(jar):
        return "dead", "the cookie file has no sessionid — Instagram ended the session"
    probe = user_config.get("session_probe_url") or DEFAULT_PROBE
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "jar.txt"
        shutil.copy2(jar, copy)
        try:
            result = subprocess.run(
                [str(config.YT_DLP), "--simulate", "--no-warnings", "--print", "id",
                 "--cookies", str(copy), probe],
                capture_output=True, text=True, timeout=PROBE_TIMEOUT_SEC,
            )
        except subprocess.TimeoutExpired:
            return "unknown", "the probe timed out"
    if result.returncode == 0 and result.stdout.strip():
        return "alive", "resolved a signed-in-only reel"
    said = (result.stderr or result.stdout).strip().splitlines()
    said = said[-1] if said else "no output"
    if media._needs_login(said):
        return "dead", f"Instagram treated us as logged out: {said[:140]}"
    return "unknown", f"the probe failed for another reason: {said[:140]}"


def _scout_busy() -> bool:
    """Another Scout pass is running. Two browsers on one burner is what makes
    it look automated, so the check waits for next time instead."""
    found = subprocess.run(["pgrep", "-f", "src.scout "], capture_output=True, text=True)
    return bool(found.stdout.strip())


def check_scout(user_config: dict) -> tuple[str, str]:
    from . import scout_browser  # the browser stack is heavy; only load it here

    settings = user_config.get("scout") or {}
    raw = settings.get("burner_cookies") or "secrets/scout-cookies.txt"
    jar = (config.ROOT / raw).expanduser()
    if not jar.is_file():
        return "dead", "no burner cookie file"
    if not _has_session(jar):
        return "dead", "the burner's cookie file has no sessionid"
    if _scout_busy():
        return "unknown", "a Scout pass is running; checked next time"
    try:
        snapshots, stopped = scout_browser.light_sweep(["instagram"], jar, log=lambda *_: None)
    except Exception as error:
        return "unknown", f"the check itself failed: {str(error)[:140]}"
    if stopped:
        return "dead", str(stopped)[:160]
    if not snapshots:
        return "unknown", "nothing came back"
    return "alive", "read @instagram's profile"


def _load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def _save_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=1))
    os.chmod(STATE, 0o600)


def _report(which: str, status: str, why: str, state: dict) -> None:
    """Alert on change, and daily while dead. 'unknown' never alerts and never
    overwrites a known status — a broken probe is not news about the login."""
    now = time.time()
    entry = state.get(which, {})
    before = entry.get("status")
    entry["checked_at"] = now
    entry["last_result"] = f"{status}: {why}"
    if status == "off":
        log(f"{which}: off — {why}")
        entry["status"] = "off"
        state[which] = entry
        return
    if status == "unknown":
        log(f"{which}: could not tell — {why}")
        state[which] = entry
        return
    log(f"{which}: {status.upper()} — {why}")
    if status == "dead":
        due = before != "dead" or now - entry.get("alerted_at", 0) >= REMIND_EVERY_SEC
        if due:
            first = before != "dead"
            text = (f"{'⚠️' if first else '⏰ Still down:'} {NAME[which]} is DEAD.\n{why}\n\n{FIX[which]}")
            if alerts.send(text, log=log):
                entry["alerted_at"] = now
    elif before == "dead":
        alerts.send(f"✅ {NAME[which]} is back.", log=log)
    entry["status"] = status
    state[which] = entry


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="session-check", description=__doc__.splitlines()[0])
    parser.add_argument("--downloader", action="store_true", help="check only the downloader")
    parser.add_argument("--scout", action="store_true", help="check only Scout's burner")
    parser.add_argument("--from-worker", action="store_true",
                        help="skip if checked in the last 30 minutes")
    parser.add_argument("--test-alert", action="store_true", help="send a test message and stop")
    args = parser.parse_args(argv)

    if args.test_alert:
        ok = alerts.send("🔔 Test from social-transcriber: login alerts reach this group.", log=log)
        log("sent" if ok else "NOT sent")
        return 0 if ok else 1

    user_config = config.load_user_config()
    state = _load_state()
    both = not (args.downloader or args.scout)

    if args.downloader or both:
        last = state.get("downloader", {}).get("checked_at", 0)
        if args.from_worker and time.time() - last < MIN_GAP_SEC:
            log("downloader: checked recently, skipping")
        else:
            _report("downloader", *check_downloader(user_config), state)
    if args.scout or both:
        _report("scout", *check_scout(user_config), state)
    _save_state(state)
    dead = [k for k in ("downloader", "scout") if state.get(k, {}).get("status") == "dead"]
    return 1 if dead else 0


if __name__ == "__main__":
    sys.exit(main())
