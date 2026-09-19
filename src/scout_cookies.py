"""Write the burner's cookie jar from values copied out of Chrome.

Instagram's `sessionid` is http-only: no extension, no in-page script and no
browser agent can read it, which is why this cannot be automated away. What it
*can* be is three seconds of copying instead of installing a cookie exporter —
Chrome → DevTools → Application → Cookies → instagram.com → copy `sessionid`.

Writes a Netscape cookie file (what `MozillaCookieJar` and yt-dlp both read) to
`scout.burner_cookies`, chmod 600, and never prints the value back.

    ./bin/scout-cookies --sessionid '…' [--ds-user-id '…'] [--csrftoken '…']
    ./bin/scout-cookies --sessionid -        # read it from stdin instead

Only `sessionid` is required; Instagram issues the rest on first use. Pass
`--csrftoken` when you have it — writes go out with it, and reads are happier
with it.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from . import config

HEADER = """# Netscape HTTP Cookie File
# Written by bin/scout-cookies for the Scout burner session.
# This is a throwaway account's session — never Geno's, never a model's.
"""
YEAR_SEC = 365 * 24 * 3600
DEFAULT_PATH = "secrets/scout-cookies.txt"


def _line(name: str, value: str, expiry: int) -> str:
    # domain, include-subdomains, path, secure, expiry, name, value
    return "\t".join([".instagram.com", "TRUE", "/", "TRUE", str(expiry), name, value])


def write(path: Path, cookies: dict) -> Path:
    expiry = int(time.time()) + YEAR_SEC
    body = HEADER + "\n".join(_line(k, v, expiry) for k, v in cookies.items() if v) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    # Create private, then write: never leave a session readable even briefly.
    handle = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(handle, "w") as file:
        file.write(body)
    os.chmod(path, 0o600)
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="scout-cookies",
        description="Write the Scout burner's Instagram cookie file from Chrome values.",
    )
    parser.add_argument("--sessionid", required=True, help="the sessionid cookie's value, or - to read stdin")
    parser.add_argument("--ds-user-id", default="", help="optional; the ds_user_id cookie")
    parser.add_argument("--csrftoken", default="", help="optional but preferred; the csrftoken cookie")
    parser.add_argument("--path", default=None, help="where to write (default: scout.burner_cookies)")
    args = parser.parse_args(argv)

    session = sys.stdin.read().strip() if args.sessionid == "-" else args.sessionid.strip()
    session = session.strip("'\"")
    if not session or len(session) < 20:
        sys.exit("that does not look like a sessionid — copy the whole value from DevTools")

    settings = config.load_user_config().get("scout") or {}
    raw = args.path or settings.get("burner_cookies") or DEFAULT_PATH
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = config.ROOT / path

    write(path, {
        "sessionid": session,
        "ds_user_id": args.ds_user_id.strip().strip("'\""),
        "csrftoken": args.csrftoken.strip().strip("'\""),
    })
    print(f"wrote {path} (0600). Now: ./bin/scout --check-burner <a gated handle>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
