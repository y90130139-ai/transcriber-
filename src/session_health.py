"""Are the Instagram logins still alive? Say so instantly when one dies.

The downloader login (usually off), every Scout burner in the registry — main
plus backups — and the viewer burner. None announces its own death:

* **The downloader** (`secrets/cookies.txt`, yt-dlp). When Instagram ends the
  session, yt-dlp saves the jar back without its `sessionid` and every gated
  reel fails as "could not download … tried anonymously, then with cookies".
  That is how 62 reels failed quietly from 2026-09-22 until Geno pasted the
  queue on 2026-09-25.
* **A Scout burner.** A dead one just stops producing rows — so each is proven
  with a one-page read, and when the active account is dead and a backup is
  alive, the registry is rotated to the backup on the spot.
* **The viewer burner.** Every gated reel depends on it; a dead one stops the
  viewer in silence. Probed the same way, unless it shares Scout's jar.

Alerts go to every configured channel (Telegram and/or Discord — see
src/alerts.py) on a change — alive to dead, dead to alive, a rotation — and
once a day while a login stays dead. State lives in `secrets/session-health.json`,
and the worker re-arms the checks whenever that file is more than six hours old,
so a missed launchd slot cannot leave a cookie unprobed.

    ./bin/session-check                    # downloader + every burner + viewer
    ./bin/session-check --scout            # just the burners
    ./bin/session-check --viewer           # just the viewer burner
    ./bin/session-check --downloader       # just the downloader (what the worker calls)
    ./bin/session-check --test-alert       # prove Telegram/Discord reach you
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

from . import alerts, config, media, scout_accounts

STATE = config.ROOT / "secrets" / "session-health.json"
VIEWER_JAR = config.ROOT / "secrets" / "viewer-cookies.txt"
# The worker re-arms the checks when the state file is older than this — the
# launchd slots can be missed while the Mac sleeps, and a cookie nobody checks
# is exactly the cookie that expires in silence.
CHECK_STALE_SEC = 6 * 60 * 60
# Magnus's 9.3x winner: Instagram shows it to signed-in accounts only, which is
# exactly the property the probe needs. Override with `session_probe_url` in
# config.json if it is ever taken down.
DEFAULT_PROBE = "https://www.instagram.com/reel/DctJJRFRE5I/"
PROBE_TIMEOUT_SEC = 90
REMIND_EVERY_SEC = 24 * 60 * 60
# The worker calls this on every login-type failure; a batch of 60 must not
# become 60 probes.
MIN_GAP_SEC = 30 * 60

VIEWER_FIX = (
    "Fix: ! cd ~/projects/social-transcriber && ./bin/scout-login --viewer "
    "— sign in as the VIEWER burner, then ./bin/viewer --check should say ALIVE."
)
DOWNLOADER_FIX = (
    "Fix: in Chrome, signed in as the DOWNLOADER account, copy the Cookie header "
    "(DevTools → Network → www.instagram.com → Request Headers → cookie → Copy value), then in "
    "Claude Code:\n"
    "! cd ~/projects/social-transcriber && pbpaste | ./bin/scout-cookies --header --path secrets/cookies.txt\n"
    "(one line — and keep --path, or it overwrites Scout's login)"
)


def burner_fix(entry: dict) -> str:
    """How to bring one burner back, or replace it with a backup."""
    return (
        f"Fix: ! cd ~/projects/social-transcriber && ./bin/scout-login --account {entry.get('id', 'scout')} "
        "— sign in as that burner, then ./bin/scout --session should say SESSION ALIVE.\n"
        "Or add a backup: ./bin/scout-cookies --add --label 'backup 1' --header '…'"
    )


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


def _viewer_busy() -> bool:
    """The viewer is mid-run. A different burner, but two browsers on one
    connection at once is the pattern the docs warn about — defer."""
    found = subprocess.run(["pgrep", "-f", "src.viewer"], capture_output=True, text=True)
    return bool(found.stdout.strip())


def _jar_age(jar: Path) -> str:
    """How long since the jar was written — context for a failure, not a
    verdict. A session can live for months; only the probe knows."""
    try:
        days = (time.time() - jar.stat().st_mtime) / 86400
    except OSError:
        return ""
    return f"jar written {days:.0f}d ago" if days >= 1 else "jar written today"


def check_account(entry: dict) -> tuple[str, str]:
    """Prove one burner's session with a single profile read."""
    from . import scout_browser  # the browser stack is heavy; only load it here

    jar = scout_accounts.resolve(entry.get("jar") or "")
    if not jar.is_file():
        return "dead", f"no cookie file at {entry.get('jar')}"
    if not _has_session(jar):
        return "dead", "the cookie file has no sessionid — Instagram ended the session"
    if _scout_busy() or _viewer_busy():
        return "unknown", "another Instagram browser is running; checked next time"
    try:
        snapshots, stopped = scout_browser.light_sweep(["instagram"], jar, log=lambda *_: None)
    except Exception as error:
        return "unknown", f"the check itself failed: {str(error)[:140]}"
    if stopped:
        return "dead", f"{str(stopped)[:150]} · {_jar_age(jar)}"
    if not snapshots:
        return "unknown", "nothing came back"
    return "alive", f"read @instagram's profile · {_jar_age(jar)}"


def check_viewer(user_config: dict) -> tuple[str, str]:
    """Prove the viewer burner's session too — it dies on its own schedule,
    and every gated reel depends on it."""
    from . import scout_browser  # the browser stack is heavy; only load it here

    if not VIEWER_JAR.is_file():
        return "off", "the viewer burner is not set up yet"
    # While it is the same file as Scout's (the current symlink), one probe
    # already covers both — say so rather than reading the same session twice.
    scout = scout_accounts.active_jar()
    try:
        if scout.is_file() and VIEWER_JAR.resolve() == scout.resolve():
            return "off", f"shares Scout's session ({scout.name}) — covered above"
    except OSError:
        pass
    if not _has_session(VIEWER_JAR):
        return "dead", "the viewer's cookie file has no sessionid — Instagram ended the session"
    if _scout_busy() or _viewer_busy():
        return "unknown", "another Instagram browser is running; checked next time"
    try:
        snapshots, stopped = scout_browser.light_sweep(["instagram"], VIEWER_JAR, log=lambda *_: None)
    except Exception as error:
        return "unknown", f"the check itself failed: {str(error)[:140]}"
    if stopped:
        return "dead", f"{str(stopped)[:150]} · {_jar_age(VIEWER_JAR)}"
    if not snapshots:
        return "unknown", "nothing came back"
    return "alive", f"read @instagram's profile · {_jar_age(VIEWER_JAR)}"


def _load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def _save_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=1))
    os.chmod(STATE, 0o600)


def _report(key: str, name: str, fix: str, status: str, why: str, state: dict) -> None:
    """Alert on change, and daily while dead. 'unknown' never alerts and never
    overwrites a known status — a broken probe is not news about the login."""
    now = time.time()
    entry = state.get(key, {})
    before = entry.get("status")
    entry["checked_at"] = now
    entry["last_result"] = f"{status}: {why}"
    if status == "off":
        log(f"{key}: off — {why}")
        entry["status"] = "off"
        state[key] = entry
        return
    if status == "unknown":
        log(f"{key}: could not tell — {why}")
        state[key] = entry
        return
    log(f"{key}: {status.upper()} — {why}")
    if status == "dead":
        due = before != "dead" or now - entry.get("alerted_at", 0) >= REMIND_EVERY_SEC
        if due:
            first = before != "dead"
            text = (f"{'⚠️' if first else '⏰ Still down:'} {name} is DEAD (session expired).\n"
                    f"{why}\n\n{fix}")
            if alerts.send(text, log=log):
                entry["alerted_at"] = now
    elif before == "dead":
        alerts.send(f"✅ {name} is back.", log=log)
    entry["status"] = status
    state[key] = entry


def check_burners(state: dict) -> list[str]:
    """Probe every enabled account, record it, and fail over if the active one
    is dead. Returns the ids that are dead."""
    reg = scout_accounts.load()
    dead: list[str] = []
    for account in reg["accounts"]:
        if not account.get("enabled", True):
            continue
        account_id = str(account.get("id"))
        name = f"Scout burner {account_id} ({account.get('label', '')})".strip()
        status, why = check_account(account)
        scout_accounts.mark(account_id, status, why)
        _report(f"scout:{account_id}", name, burner_fix(account), status, why, state)
        if status == "dead":
            dead.append(account_id)

    active_id = str(reg.get("active"))
    if active_id in dead:
        switched = scout_accounts.rotate(exclude=active_id)
        if switched:
            old, new = switched
            alerts.send(
                f"↪️ Scout switched to backup {new['id']} ({new['label']}).\n"
                f"{old['id']} is dead; the next pass uses {new['id']} instead.\n"
                f"Bring the main back when you can — {burner_fix(old)}",
                log=log,
            )
        else:
            alerts.send(
                "🛑 Every Scout burner is dead — no account left to sweep with.\n"
                "Add a backup: ./bin/scout-cookies --add --label 'backup 1' --header '…'\n"
                "(or sign one in: ./bin/scout-login)",
                log=log,
            )
    return dead


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="session-check", description=__doc__.splitlines()[0])
    parser.add_argument("--downloader", action="store_true", help="check only the downloader")
    parser.add_argument("--scout", action="store_true", help="check only the Scout burners")
    parser.add_argument("--viewer", action="store_true", help="check only the viewer burner")
    parser.add_argument("--from-worker", action="store_true",
                        help="skip if checked in the last 30 minutes")
    parser.add_argument("--test-alert", action="store_true", help="send a test message and stop")
    args = parser.parse_args(argv)

    if args.test_alert:
        results = alerts.send_each(
            "🔔 Test from social-transcriber: login alerts reach this channel.", log=log)
        if not results:
            log(f"nothing to test — no secrets/alerts.json yet")
            return 1
        for channel, ok in results.items():
            log(f"{channel}: {'sent' if ok else 'NOT sent'}")
        return 0 if any(results.values()) else 1

    user_config = config.load_user_config()
    state = _load_state()
    both = not (args.downloader or args.scout or args.viewer)
    dead: list[str] = []

    if args.downloader or both:
        last = state.get("downloader", {}).get("checked_at", 0)
        if args.from_worker and time.time() - last < MIN_GAP_SEC:
            log("downloader: checked recently, skipping")
        else:
            status, why = check_downloader(user_config)
            _report("downloader", "Downloader login", DOWNLOADER_FIX, status, why, state)
            if status == "dead":
                dead.append("downloader")
    if args.scout or both:
        dead += [f"scout:{i}" for i in check_burners(state)]
    if args.viewer or both:
        status, why = check_viewer(user_config)
        _report("viewer", "Viewer burner", VIEWER_FIX, status, why, state)
        if status == "dead":
            dead.append("viewer")

    _save_state(state)
    return 1 if dead else 0


if __name__ == "__main__":
    sys.exit(main())
