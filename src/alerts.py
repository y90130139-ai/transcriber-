"""Tell Geno something needs him, on his phone.

Posts to the OPS group through the Gosian bot — the Telegram channel he
already reads. Settings live in `secrets/alerts.json` (never committed):

    {"telegram_bot_token": "...", "telegram_chat_id": -100...}

Nothing here raises: an alert that cannot be sent is logged and the caller
carries on, because the thing being alerted about is the real problem.
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from . import config

SETTINGS = config.ROOT / "secrets" / "alerts.json"
TIMEOUT_SEC = 20


def _settings() -> dict | None:
    try:
        data = json.loads(Path(SETTINGS).read_text())
    except (OSError, ValueError):
        return None
    if not data.get("telegram_bot_token") or not data.get("telegram_chat_id"):
        return None
    return data


def ready() -> bool:
    return _settings() is not None


def send(text: str, log=print) -> bool:
    """Post one message. True if Telegram took it."""
    settings = _settings()
    if not settings:
        log(f"alert not sent — no {SETTINGS.name}: {text.splitlines()[0]}")
        return False
    body = json.dumps({
        "chat_id": settings["telegram_chat_id"],
        "text": text,
        "disable_web_page_preview": True,
    }).encode()
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{settings['telegram_bot_token']}/sendMessage",
        data=body, headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
            return json.loads(response.read()).get("ok") is True
    except Exception as error:  # the token never appears in what is logged
        log(f"alert not sent — Telegram said: {str(error)[:160]}")
        return False
