"""Discord alerts for the worker — the exact error, to the operator's <@id>.

The rule this exists for (Geno, 2026-10-09): if the daily scrape is not taking
place, someone is told, and the message says exactly why. The worker can only
report what it sees — a failure in its own pass — so the "nothing ran at all"
case is the cloud watchdog's job (`/api/cron/watchdog`), which reads the run
tables from the outside.

Identical alerts are held to one per half hour, so a crash loop reports once
per cause instead of sixty times an hour.
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path

WEBHOOK = os.environ.get("DISCORD_WEBHOOK", "").strip()
USER = os.environ.get("DISCORD_USER_ID", "").strip()
STATE = Path(os.environ.get("DATA_DIR", "./data")) / "alerts.json"
HOLD_SEC = 30 * 60


def alert(title: str, detail: str) -> None:
    """One line of what broke, plus the raw error underneath."""
    print(f"ALERT: {title} — {detail[:300]}")
    if not WEBHOOK:
        return

    now = time.time()
    seen: dict[str, float] = {}
    try:
        seen = json.loads(STATE.read_text())
    except Exception:
        seen = {}
    if now - float(seen.get(title, 0)) < HOLD_SEC:
        return
    seen[title] = now
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(seen))
    except Exception:
        pass

    content = (f"<@{USER}> " if USER else "") + f"🚨 **{title}**\n```\n{detail[:1500]}\n```"
    request = urllib.request.Request(
        WEBHOOK,
        data=json.dumps({"username": "Transcriber worker", "content": content}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(request, timeout=30)
    except Exception as error:
        print(f"alert could not be sent: {error}")
