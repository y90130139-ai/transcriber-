"""One-shot Railway cron entry point for the two-hour Scout watchdog."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


def main() -> None:
    base = os.environ.get("CLOUD_URL", "").strip().rstrip("/")
    secret = os.environ.get("WORKER_SECRET", "").strip()
    if not base or not secret:
        raise SystemExit("Railway watchdog requires CLOUD_URL and WORKER_SECRET")
    request = urllib.request.Request(
        f"{base}/api/scout/monitor",
        data=json.dumps({
            "scraping_enabled": os.environ.get("ENABLE_INSTAGRAM_SCRAPING", "false").lower() == "true",
        }).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "User-Agent": "social-transcriber-railway-watchdog/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.loads(response.read() or b"{}")
    except (urllib.error.URLError, OSError, ValueError) as error:
        _alert(f"⚠️ Instagram watchdog could not reach the app health endpoint.\n{str(error)[:240]}")
        raise
    if not result.get("healthy"):
        problems = result.get("problems") or ["health check returned an unhealthy state"]
        _alert("⚠️ Instagram scraping health check failed\n• " + "\n• ".join(problems) +
               "\nRailway will check again in 2 hours.")
    print(json.dumps(result), flush=True)


def _alert(message: str) -> None:
    webhook = os.environ.get("DISCORD_WEBHOOK", "").strip()
    if not webhook:
        print("DISCORD_WEBHOOK is not configured; alert was not sent.", flush=True)
        return
    request = urllib.request.Request(
        webhook,
        data=json.dumps({"content": message[:1900]}).encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "social-transcriber-railway-watchdog/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20):
            print("Discord health alert sent.", flush=True)
    except (urllib.error.URLError, OSError) as error:
        # Never print the webhook URL; Railway's platform log still exposes
        # standard process errors, so keep the message limited.
        print(f"Discord alert failed: {str(error)[:160]}", flush=True)


if __name__ == "__main__":
    main()
