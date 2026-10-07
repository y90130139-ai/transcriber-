"""Tell Geno something needs him — on Telegram, in Discord, or both.

Posts to the OPS group through the Gosian bot, and to a Discord webhook when one
is configured. Every configured channel gets every message; a channel that
fails is logged and never stops the others. Settings live in
`secrets/alerts.json` (never committed):

    {
      "telegram_bot_token": "...",
      "telegram_chat_id": -100...,
      "discord_webhook": "https://discord.com/api/webhooks/..."
    }

Nothing here raises: an alert that cannot be sent is logged and the caller
carries on, because the thing being alerted about is the real problem.

    ./bin/alerts --discord 'https://discord.com/api/webhooks/…'  # save a webhook
    ./bin/alerts --test                                          # prove every channel
    ./bin/alerts --show                                          # what's set (masked)
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.request
from pathlib import Path

from . import config

SETTINGS = config.ROOT / "secrets" / "alerts.json"
TIMEOUT_SEC = 20
# Discord rejects anything past 2000 characters outright.
DISCORD_LIMIT = 2000
# Cloudflare in front of Discord answers 403 to urllib's default UA; measured
# 2026-10-05 — the same POST with a plain UA returns 204.
USER_AGENT = "social-transcriber/1.0"


def _settings() -> dict | None:
    data: dict = {}
    try:
        loaded = json.loads(Path(SETTINGS).read_text())
        if isinstance(loaded, dict):
            data = loaded
    except (OSError, ValueError):
        pass
    # Env fills what the file does not say — a server (Vercel) can hold the
    # webhook without a secrets file on disk.
    for key, env in (("discord_webhook", "DISCORD_WEBHOOK"),
                     ("telegram_bot_token", "TELEGRAM_BOT_TOKEN"),
                     ("telegram_chat_id", "TELEGRAM_CHAT_ID")):
        if not data.get(key) and os.environ.get(env):
            data[key] = os.environ[env]
    if not (data.get("discord_webhook")
            or (data.get("telegram_bot_token") and data.get("telegram_chat_id"))):
        return None
    return data


def ready() -> bool:
    return _settings() is not None


def _telegram(text: str, settings: dict, log) -> bool:
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


def _discord(text: str, settings: dict, log) -> bool:
    body = json.dumps({"content": text[:DISCORD_LIMIT]}).encode()
    request = urllib.request.Request(
        settings["discord_webhook"], data=body,
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
            # Discord answers 204 No Content on success.
            return response.status in (200, 204)
    except Exception as error:  # the webhook URL never appears in what is logged
        log(f"alert not sent — Discord said: {str(error)[:160]}")
        return False


def send_each(text: str, log=print) -> dict[str, bool]:
    """Post to every configured channel. {'telegram': bool, 'discord': bool}."""
    settings = _settings()
    if not settings:
        log(f"alert not sent — no {SETTINGS.name}: {text.splitlines()[0]}")
        return {}
    results: dict[str, bool] = {}
    if settings.get("telegram_bot_token") and settings.get("telegram_chat_id"):
        results["telegram"] = _telegram(text, settings, log)
    if settings.get("discord_webhook"):
        results["discord"] = _discord(text, settings, log)
    return results


def send(text: str, log=print) -> bool:
    """True if at least one channel took it."""
    return any(send_each(text, log=log).values())


def _save(settings: dict) -> None:
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    handle = os.open(str(SETTINGS), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(handle, "w") as file:
        file.write(json.dumps(settings, indent=1))
    os.chmod(SETTINGS, 0o600)


def _mask(value: str) -> str:
    """Enough to recognise which one it is, never enough to use it."""
    if len(value) <= 12:
        return "…"
    return f"{value[:12]}…"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="alerts",
        description="Telegram + Discord alert settings for social-transcriber.",
    )
    parser.add_argument("--discord", metavar="URL", help="save this Discord webhook")
    parser.add_argument("--test", action="store_true", help="send a test to every channel")
    parser.add_argument("--show", action="store_true", help="what's configured, masked")
    args = parser.parse_args(argv)

    if args.discord:
        url = args.discord.strip().strip("'\"")
        if "discord.com/api/webhooks/" not in url and "discordapp.com/api/webhooks/" not in url:
            raise SystemExit("that does not look like a Discord webhook URL")
        settings = _settings() or {}
        settings["discord_webhook"] = url
        _save(settings)
        print(f"saved Discord webhook to {SETTINGS} (0600, never committed)")
        print("Prove it: ./bin/alerts --test")
        return 0

    if args.show:
        settings = _settings() or {}
        tg = bool(settings.get("telegram_bot_token") and settings.get("telegram_chat_id"))
        print(f"telegram: {'set' if tg else 'not set'}")
        print(f"discord:  {_mask(settings['discord_webhook']) if settings.get('discord_webhook') else 'not set'}")
        return 0

    if args.test:
        results = send_each("🔔 Test from social-transcriber: alerts reach this channel.", log=print)
        if not results:
            print(f"nothing to test — no {SETTINGS.name} yet")
            return 1
        for name, ok in results.items():
            print(f"{name}: {'sent' if ok else 'NOT sent'}")
        return 0 if any(results.values()) else 1

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
