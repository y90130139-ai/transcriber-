"""Railway's durable queue trigger and Instagram freshness watchdog.

This service replaces the Mac worker for cloud-capable queue work by invoking
the existing cloud fallback route. It does not scrape Instagram by default.
When explicitly enabled after a one-account Railway egress test, it runs the
same browser reader on the existing daily/weekly cadence only.

Required Railway variables: WORKER_SECRET. CLOUD_URL defaults to the
canonical origin, https://plan.gosianmedia.com. Optional: DISCORD_WEBHOOK,
ENABLE_INSTAGRAM_SCRAPING (defaults false), SCRAPE_TIMEZONE (defaults New York).
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import stat
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

POLL_SEC = 5 * 60
TIMEOUT_SEC = 60
TZ = os.environ.get("SCRAPE_TIMEZONE", "America/New_York")


def _prepare_runtime() -> None:
    """Write Railway secret variables onto its mounted private volume.

    Cookie env values are Netscape-format cookie jar contents, not raw browser
    passwords. Never log them. A volume keeps refreshed browser state between
    Railway deploys; the scraper remains off until explicitly enabled.
    """
    mount = Path(os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "/data"))
    secrets = mount / "secrets"
    secrets.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("TRANSCRIBER_CONFIG", str(mount / "config.json"))
    os.environ.setdefault("SCOUT_ACCOUNTS_FILE", str(secrets / "scout-accounts.json"))
    os.environ.setdefault("SCOUT_PAUSE_FILE", str(secrets / "scout-paused.json"))

    accounts = []
    for account_id, label, env_name in (
        ("scout", "Scout primary", "SCOUT_COOKIE_JAR"),
        ("backup-1", "Scout backup", "SCOUT_BACKUP_COOKIE_JAR"),
    ):
        contents = os.environ.get(env_name, "").strip()
        if not contents:
            continue
        jar = secrets / f"{account_id}-cookies.txt"
        jar.write_text(contents.rstrip() + "\n", encoding="utf-8")
        jar.chmod(stat.S_IRUSR | stat.S_IWUSR)
        accounts.append({
            "id": account_id,
            "label": label,
            "jar": str(jar),
            "enabled": True,
            "last_status": None,
            "last_checked_at": None,
            "last_error": None,
        })

    if accounts:
        registry = secrets / "scout-accounts.json"
        registry.write_text(json.dumps({"active": "scout", "accounts": accounts}, indent=1))
        registry.chmod(stat.S_IRUSR | stat.S_IWUSR)

    config_path = Path(os.environ["TRANSCRIBER_CONFIG"])
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps({
        "cloud_url": os.environ.get("CLOUD_URL", "").strip(),
        "worker_secret": os.environ.get("WORKER_SECRET", "").strip(),
        "scout": {"burner_cookies": str(secrets / "scout-cookies.txt")},
    }, indent=1))
    config_path.chmod(stat.S_IRUSR | stat.S_IWUSR)


def _post(base: str, secret: str, path: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload or {}).encode()
    request = urllib.request.Request(
        base.rstrip("/") + path,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "User-Agent": "social-transcriber-railway/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
        return json.loads(response.read() or b"{}")


def _run_scrape(now: dt.datetime) -> None:
    """Retain the observed low-frequency schedule; never poll Instagram hourly."""
    if os.environ.get("ENABLE_INSTAGRAM_SCRAPING", "false").lower() != "true":
        return
    pause_file = Path(os.environ.get("SCOUT_PAUSE_FILE", "/data/secrets/scout-paused.json"))
    if pause_file.exists():
        print("Instagram scraping remains paused by the persistent safety stop.", flush=True)
        return
    if not os.environ.get("SCOUT_COOKIE_JAR", "").strip() or not os.environ.get("SCOUT_BACKUP_COOKIE_JAR", "").strip():
        raise RuntimeError(
            "scraping is enabled but both SCOUT_COOKIE_JAR and SCOUT_BACKUP_COOKIE_JAR are required"
        )
    # One daily profile-only read at 19:00. A full reels sweep is Friday only,
    # after that daily read, matching the previously deployed schedule.
    if now.hour != 19 or now.minute >= 5:
        return
    from . import scout

    scout.daily()
    if now.weekday() == 4:
        scout.sweep(limit_handles=None, dry=False, only="burner")


def main() -> None:
    base = os.environ.get("CLOUD_URL", "https://plan.gosianmedia.com").strip()
    secret = os.environ.get("WORKER_SECRET", "").strip()
    if not base or not secret:
        raise SystemExit("Railway requires WORKER_SECRET")

    _prepare_runtime()

    print("Railway worker online; cloud queue check every 5 minutes.", flush=True)
    last_scrape_slot = ""
    while True:
        now = dt.datetime.now(ZoneInfo(TZ))
        slot = now.strftime("%Y-%m-%d-%H")
        try:
            result = _post(base, secret, "/api/worker/cloud")
            if result.get("transcribed") or result.get("uploaded"):
                print(f"cloud fallback: {result}", flush=True)
        except (urllib.error.URLError, OSError, ValueError) as error:
            print(f"cloud worker trigger failed: {str(error)[:240]}", flush=True)

        if slot != last_scrape_slot and now.hour == 19 and now.minute < 5:
            last_scrape_slot = slot
            try:
                _run_scrape(now)
            except (Exception, SystemExit) as error:
                # One safety stop: do not auto-retry a challenged Instagram pass.
                print(f"Instagram scheduled pass stopped: {str(error)[:300]}", flush=True)

        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
