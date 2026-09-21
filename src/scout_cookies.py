"""Write the burner's cookie jar from values copied off the tethered phone.

**Chrome on this Mac is not where these come from.** The burner lives on an
old iPhone and nowhere else, because this Mac holds Geno's own signed-in
accounts and a mis-click there would hand Scout the wrong session. Safari on
the Mac remote-debugs Safari on the phone: Develop → the iPhone →
instagram.com → Storage → Cookies. Full steps in docs/SCOUT-SETUP.md.

Instagram's `sessionid` is http-only: no extension, no in-page script and no
browser agent can read it, which is why this cannot be automated away. When
the panel hides it, read it out of a request's `Cookie` header instead —
Network → reload → any instagram.com request.

After writing, prove it with `./bin/scout --session`.

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


# Cookies worth keeping out of a pasted header. `sessionid` is the one that
# authenticates; the rest travel with it and a session that arrives without
# them looks more like a script than a browser.
WANTED = ("sessionid", "csrftoken", "ds_user_id", "mid", "ig_did", "datr", "rur", "shbid", "shbts")


def from_header(raw: str) -> dict:
    """Pull the cookies we want out of a pasted `Cookie:` header.

    Written because the alternative is asking a person to find one value in a
    table of nine columns at 2am, which is exactly the step that gets pasted
    wrong. Accepts the line with or without the leading `Cookie:`, with or
    without quotes, split on `;` the way the header itself is.
    """
    text = raw.strip().strip("'\"")
    if text.lower().startswith("cookie:"):
        text = text.split(":", 1)[1]
    found = {}
    for part in text.split(";"):
        if "=" not in part:
            continue
        name, _, value = part.partition("=")
        name = name.strip()
        value = value.strip().strip("'\"")
        if name in WANTED and value:
            found[name] = value
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="scout-cookies",
        description="Write the Scout burner's Instagram cookie file from the phone's values.",
    )
    parser.add_argument("--sessionid", help="the sessionid cookie's value, or - to read stdin")
    parser.add_argument("--header", nargs="?", const="-", metavar="COOKIE",
                        help="paste the whole Cookie: header instead and let this pull the "
                             "values out of it; - or no value reads stdin")
    parser.add_argument("--ds-user-id", default="", help="optional; the ds_user_id cookie")
    parser.add_argument("--csrftoken", default="", help="optional but preferred; the csrftoken cookie")
    parser.add_argument("--path", default=None, help="where to write (default: scout.burner_cookies)")
    args = parser.parse_args(argv)

    if args.header is not None:
        raw_header = sys.stdin.read() if args.header == "-" else args.header
        found = from_header(raw_header)
        if "sessionid" not in found:
            sys.exit(
                "no sessionid in that. Paste the whole Cookie header — the long line of\n"
                "name=value pairs from Network → any instagram.com request → Request Headers."
            )
        cookies = found
    else:
        if not args.sessionid:
            sys.exit("pass --sessionid, or --header to paste the whole Cookie line")
        session = sys.stdin.read().strip() if args.sessionid == "-" else args.sessionid.strip()
        session = session.strip("'\"")
        if not session or len(session) < 20:
            sys.exit("that does not look like a sessionid — copy the whole value from DevTools")
        cookies = {
            "sessionid": session,
            "ds_user_id": args.ds_user_id.strip().strip("'\""),
            "csrftoken": args.csrftoken.strip().strip("'\""),
        }

    settings = config.load_user_config().get("scout") or {}
    raw = args.path or settings.get("burner_cookies") or DEFAULT_PATH
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = config.ROOT / path

    write(path, cookies)
    named = ", ".join(sorted(k for k in cookies if cookies[k]))
    print(f"wrote {path} (0600) — {named}")
    print("Now prove it: ./bin/scout --session")
    return 0


if __name__ == "__main__":
    sys.exit(main())
