"""Write burner cookie jars — the main account's and any number of backups.

**Chrome on this Mac is not where these come from.** The burners live on an old
iPhone and nowhere else, because this Mac holds Geno's own signed-in accounts
and a mis-click there would hand Scout the wrong session. Safari on the Mac
remote-debugs Safari on the phone: Develop → the iPhone → instagram.com →
Storage → Cookies. Full steps in docs/SCOUT-SETUP.md.

Instagram's `sessionid` is http-only: no extension, no in-page script and no
browser agent can read it, which is why this cannot be automated away. When the
panel hides it, read it out of a request's `Cookie` header instead —
Network → reload → any instagram.com request.

The main jar is written by default; `--add` writes a numbered backup and
registers it, so an expired session is a failover instead of an outage:

    ./bin/scout-cookies --sessionid '…'                    # main jar (as before)
    ./bin/scout-cookies --add --label 'backup 1' --header '…'
    ./bin/scout-cookies --list                             # accounts + health
    ./bin/scout-cookies --activate backup-1                # switch manually

Writes a Netscape cookie file (what `MozillaCookieJar` and yt-dlp both read),
chmod 600, and never prints the value back.

    ./bin/scout-cookies --sessionid -        # read it from stdin instead
    ./bin/scout-cookies --header -           # read the whole Cookie line from stdin

Only `sessionid` is required; Instagram issues the rest on first use. Pass
`--csrftoken` when you have it — writes go out with it, and reads are happier
with it. A backup is proven as soon as it is added (one profile read) unless
`--no-check` is passed.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from . import config, scout_accounts

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


def _print_registry() -> None:
    reg = scout_accounts.load()
    print(f"{'':2} {'id':<12} {'label':<20} {'status':<10} jar")
    for account in reg["accounts"]:
        marker = "*" if account.get("id") == reg["active"] else " "
        status = account.get("last_status") or "unchecked"
        print(f" {marker} {account.get('id', '?'):<12} {account.get('label', ''):<20} "
              f"{status:<10} {account.get('jar', '')}")
    print("\n* = active. Switch with: ./bin/scout-cookies --activate <id>")


def _cookies_from_args(args) -> dict:
    if args.header is not None:
        raw_header = sys.stdin.read() if args.header == "-" else args.header
        found = from_header(raw_header)
        if "sessionid" not in found:
            sys.exit(
                "no sessionid in that. Paste the whole Cookie header — the long line of\n"
                "name=value pairs from Network → any instagram.com request → Request Headers."
            )
        return found
    if not args.sessionid:
        sys.exit("pass --sessionid, or --header to paste the whole Cookie line")
    session = sys.stdin.read().strip() if args.sessionid == "-" else args.sessionid.strip()
    session = session.strip("'\"")
    if not session or len(session) < 20:
        sys.exit("that does not look like a sessionid — copy the whole value from DevTools")
    return {
        "sessionid": session,
        "ds_user_id": args.ds_user_id.strip().strip("'\""),
        "csrftoken": args.csrftoken.strip().strip("'\""),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="scout-cookies",
        description="Write a Scout burner's Instagram cookie file from the phone's values.",
    )
    parser.add_argument("--sessionid", help="the sessionid cookie's value, or - to read stdin")
    parser.add_argument("--header", nargs="?", const="-", metavar="COOKIE",
                        help="paste the whole Cookie: header instead and let this pull the "
                             "values out of it; - or no value reads stdin")
    parser.add_argument("--ds-user-id", default="", help="optional; the ds_user_id cookie")
    parser.add_argument("--csrftoken", default="", help="optional but preferred; the csrftoken cookie")
    parser.add_argument("--path", default=None, help="where to write (default: scout.burner_cookies)")
    parser.add_argument("--add", action="store_true",
                        help="register this as a backup account instead of overwriting the main jar")
    parser.add_argument("--label", default="", help="with --add: a name, e.g. 'backup 1'")
    parser.add_argument("--no-check", action="store_true",
                        help="with --add: skip the one-page proof read")
    parser.add_argument("--list", action="store_true", help="show accounts and their last health")
    parser.add_argument("--activate", metavar="ID", help="make this account the one passes use")
    args = parser.parse_args(argv)

    if args.list:
        _print_registry()
        return 0

    if args.activate:
        entry = scout_accounts.set_active(args.activate)
        if entry is None:
            sys.exit(f"no account with id {args.activate!r} — see ./bin/scout-cookies --list")
        print(f"active account is now {entry['id']} ({entry['label']})")
        return 0

    cookies = _cookies_from_args(args)
    settings = config.load_user_config().get("scout") or {}

    if args.add:
        if not args.label.strip():
            sys.exit("--add needs --label, e.g. --label 'backup 1'")
        account_id = scout_accounts.slug(args.label)
        raw = args.path or f"secrets/{account_id}-cookies.txt"
        path = scout_accounts.resolve(raw)
        write(path, cookies)
        jar = path.relative_to(config.ROOT).as_posix() if config.ROOT in path.parents else str(path)
        entry = scout_accounts.add(args.label, jar)
        named = ", ".join(sorted(k for k in cookies if cookies[k]))
        print(f"added backup {entry['id']} ({entry['label']}) → {path} (0600) — {named}")
        if not args.no_check:
            # Prove it now: a backup that is already dead is worth knowing about
            # at the moment it is added, not at the next failover.
            from . import session_health  # the browser stack is heavy; only load it here
            status, why = session_health.check_account(entry)
            scout_accounts.mark(entry["id"], status, why)
            print(f"{entry['id']}: {status.upper()} — {why}")
            if status == "dead":
                from . import alerts
                alerts.send(
                    f"⚠️ New Scout backup {entry['id']} ({entry['label']}) is DEAD.\n{why}\n"
                    "Re-read its cookies from the phone and add it again.",
                    log=print,
                )
        print("Accounts: ./bin/scout-cookies --list")
        return 0

    raw = args.path or settings.get("burner_cookies") or DEFAULT_PATH
    path = scout_accounts.resolve(raw)
    write(path, cookies)
    named = ", ".join(sorted(k for k in cookies if cookies[k]))
    print(f"wrote {path} (0600) — {named}")
    print("Now prove it: ./bin/scout --session")
    return 0


if __name__ == "__main__":
    sys.exit(main())
