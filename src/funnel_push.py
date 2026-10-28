"""Send the day's funnel reading, and the money beside it, to the cloud.

The scan has to run on this machine: Instagram refuses a logged-in session
from a datacenter IP, and the burner has been trusted from one residential
address for weeks. Nothing else does. So the Mac is the eyes and the cloud is
the memory — the history that answers "do deep links die faster than a plain
profile link" only exists once it is up there, and today it lives in a folder
on one laptop.

The money summary rides along because the page ranks what to do by what it is
worth, and the Infloww mirror is on this machine too. Only the summary
travels: sixty-five rows of small integers, no fan ids, no names.
"""

from __future__ import annotations

import json
import os
import sys
import time

from . import config, funnel, scout

# Her last seven settled days against the roster's peak week is what the page
# shows as "lost per week", and the peak is a fixed point, not a rolling one.
PEAK_WEEK = ("2026-09-14", "2026-09-20")


def _money_rows(day: str) -> list:
    """One row per creator from the Infloww mirror, if it is readable here.

    Returns [] rather than raising: a scan that ran on a day the mirror could
    not be reached should still store its reading.
    """
    tools = os.path.expanduser("~/projects/social-transcriber/tools/red-october")
    if tools not in sys.path:
        sys.path.insert(0, tools)
    try:
        import money as mm  # noqa: WPS433 - optional, local to this machine
    except Exception:
        return []

    try:
        names, gone = mm.roster()
        oct_m, sep_m = mm.load_month("2026-10"), mm.load_month("2026-09")
    except Exception:
        return []

    settled = day
    rows = []
    for cid, name in names.items():
        if cid in gone or name in mm.LEFT:
            continue
        ro, rs = oct_m.get(cid, []), sep_m.get(cid, [])
        oct_rows = mm.through(ro, settled)
        days = mm.by_day(oct_rows)
        week_now = sum(
            v for d, v in days.items()
            if d > _shift(settled, 7)
        )
        week_peak = sum(
            v for d, v in mm.by_day(rs).items()
            if PEAK_WEEK[0] <= d <= PEAK_WEEK[1]
        )
        sep_full = mm.net(rs)
        oct_net = mm.net(oct_rows)
        rows.append({
            "creator": name,
            "chat": "CHAT" in name.upper() or name.endswith(" Chat"),
            "tier": None,
            "sep_full": sep_full,
            "oct_net": oct_net,
            "gap": sep_full - oct_net,
            "week_now": week_now,
            "week_peak": week_peak,
        })
    return rows


def _shift(day: str, back: int) -> str:
    from datetime import datetime, timedelta
    return (datetime.strptime(day, "%Y-%m-%d") - timedelta(days=back)).strftime("%Y-%m-%d")


def push(day: str = "", log=print) -> int:
    root = config.DEFAULT_OUT_DIR
    records = funnel.latest(root)
    if not records:
        log("no reading to push — run bin/funnel scan first")
        return 1

    day = day or max(
        (r.get("read_at") or "")[:10] for r in records
    ) or time.strftime("%Y-%m-%d")

    # Join on the Infloww account name, not the IG board's label for her. The
    # reading calls her "Milkysins" and the money calls her "Milky Sins FS";
    # sending the first leaves every row on the page without a dollar figure,
    # which is the one thing the list is ranked by. The roster carries both.
    entries = {e["handle"]: e for e in funnel.roster(root)}
    accounts = {h: e.get("account") for h, e in entries.items()}

    payload = {
        "day": day,
        "records": [
            {
                "handle": r["handle"], "state": r["state"],
                "bio_funnel": r.get("bio_funnel"), "bio_maybe": r.get("bio_maybe"),
                "has_story": bool(r.get("has_story")),
                "highlights": r.get("highlights"), "followers": r.get("followers"),
                "is_private": bool(r.get("is_private")),
                "creator": accounts.get(r["handle"]) or r.get("creator"),
                # `us` or `model`: whether the page reads as an Iona task or a
                # question for her.
                "places": (entries.get(r["handle"]) or {}).get("places"),
                "read_at": r.get("read_at"),
            }
            for r in records
        ],
        "money": _money_rows(day),
    }

    # The app runs in two places behind two secrets — Railway on
    # plan.gosianmedia.com, Vercel on transcriber-ten-zeta — and they share one
    # Neon database, so a reading posted to either is visible from both. The
    # override exists for the days one of them is mid-deploy.
    cloud, _ = scout._settings()
    base = os.environ.get("FUNNEL_CLOUD_URL")
    secret = os.environ.get("FUNNEL_WORKER_SECRET")
    if base and secret:
        cloud = scout.Cloud(base, secret)
        log("posting to {} (override)".format(base))
    try:
        out = cloud.post("/api/funnel", payload)
    except Exception as error:
        log("not pushed — {}".format(str(error)[:200]))
        return 1
    log("pushed {} readings and {} money rows for {}".format(
        out.get("stored"), out.get("money"), out.get("day")))
    if out.get("refused"):
        log("refused: {}".format(", ".join(out["refused"])[:200]))
    return 0


def main(argv=None) -> int:
    import argparse
    parser = argparse.ArgumentParser(prog="funnel-push", description=__doc__.splitlines()[0])
    parser.add_argument("--day", default="", help="override the day (YYYY-MM-DD)")
    args = parser.parse_args(argv)
    return push(args.day)


if __name__ == "__main__":
    raise SystemExit(main())
