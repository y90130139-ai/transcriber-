"""Red October money, computed from the Infloww mirror.

Every definition here is the board's, kept exactly as the skill states them:
net excludes `undo` and `pending_return` (and `loading` counts, because it
settles); days are Eastern and today is never counted, since a partial day
reads as a collapse.
"""

from __future__ import annotations

import glob
import json
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

ET = timezone(timedelta(hours=-4))  # EDT; October is all EDT
DEAD = {"undo", "pending_return"}
LEFT = {"Livi Blossom FS", "Maeva FS"}  # left the agency, Oct 2026

STATE = os.path.expanduser("~/gosian-bot/state")


def day_of(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, ET).strftime("%Y-%m-%d")


def load_month(month: str) -> dict:
    """{creator_id: [row, ...]} for one YYYY-MM."""
    out = {}
    for path in glob.glob(os.path.join(STATE, "revenue", "*-{}.json".format(month))):
        blob = json.load(open(path))
        out[blob["creator"]] = list(blob["rows"].values())
    return out


def roster() -> tuple[dict, set]:
    """Names by creator id, and the ids Infloww no longer returns."""
    sync = json.load(open(os.path.join(STATE, "revenue-sync.json")))
    names, gone = {}, set()
    for cid, meta in (sync.get("creators") or {}).items():
        names[cid] = meta.get("name") or cid
        if meta.get("vanishedAt"):
            gone.add(cid)
    return names, gone


def live(row) -> bool:
    return row.get("s") not in DEAD


def net(rows) -> int:
    return sum(r.get("e") or 0 for r in rows if live(r))


def by_day(rows) -> dict:
    days = defaultdict(int)
    for r in rows:
        if live(r):
            days[day_of(r["t"])] += r.get("e") or 0
    return days


def avg_ppv(rows) -> float:
    msgs = [r.get("a") or 0 for r in rows if live(r) and r.get("k") == "Messages"]
    return (sum(msgs) / len(msgs) / 100) if msgs else 0.0


def fans(rows) -> set:
    return {r["f"] for r in rows if live(r) and r.get("f")}


def kind_net(rows, kind) -> int:
    return sum(r.get("e") or 0 for r in rows if live(r) and r.get("k") == kind)


def count_kind(rows, kind) -> int:
    return sum(1 for r in rows if live(r) and r.get("k") == kind)


def through(rows, last_day: str, first_day: str = "") -> list:
    """Rows on or before `last_day` (and on or after `first_day`)."""
    return [r for r in rows
            if day_of(r["t"]) <= last_day and (not first_day or day_of(r["t"]) >= first_day)]


def pace_of(days: dict, upto: str, window: int) -> float:
    """Average daily net over the last `window` settled days."""
    end = datetime.strptime(upto, "%Y-%m-%d")
    picks = [(end - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(window)]
    return sum(days.get(d, 0) for d in picks) / float(window)


def tier_of(oct_so_far: int, sep_full: int, pace: float, best: float, days_left: int,
            red_same_days: bool) -> tuple[str, float, float]:
    """Her Oct 31 outlook against her own September.

    `safe` is on course. `hold` is behind on the same days but still on course
    to finish ahead — the distinction matters because a creator who is down
    today and fine by the 31st does not need a message today.
    """
    projected = oct_so_far + pace * days_left
    # The ratio is reported whatever the tier: for a creator who is already on
    # course it reads negative or small, and that is information, not a flag.
    needed = ((sep_full - oct_so_far) / float(days_left)) if days_left else 0.0
    ratio = (needed / best) if best > 0 else 99.0

    if projected >= sep_full:
        return ("hold" if red_same_days else "safe"), ratio, projected
    if days_left <= 0 or best <= 0:
        return "out", 99.0, projected
    if ratio <= 1.5:
        tier = "push"
    elif ratio <= 2.0:
        tier = "stretch"
    else:
        tier = "out"
    return tier, ratio, projected


def creator_view(rows_oct, rows_sep, last_day: str, days_left: int) -> dict:
    """One creator's October against her own September, on the board's rules."""
    day = last_day[-2:]
    oct_rows = through(rows_oct, last_day)
    sep_same = through(rows_sep, "2026-09-" + day)

    days = by_day(oct_rows)
    oct_net, sep_net, sep_full = net(oct_rows), net(sep_same), net(rows_sep)
    settled = int(day)
    avg_pace = oct_net / float(settled) if settled else 0.0
    last4 = pace_of(days, last_day, 4)
    best = max(avg_pace, last4)

    behind = oct_net < sep_net
    tier, ratio, projected = tier_of(oct_net, sep_full, last4, best, days_left, behind)
    needed = ((sep_full - oct_net) / float(days_left)) if days_left else 0.0
    proj_red = int(projected) < sep_full

    return {
        "tier": tier, "ratio": round(ratio, 2), "need": round(needed),
        "pace": round(avg_pace), "rec": round(last4), "best": round(best),
        # `gap` is what she still has to earn to match her own September, so a
        # positive number is ground to make up and a negative one is her
        # already being ahead. The board renders it both ways round.
        "proj": proj_red, "gap": sep_full - oct_net,
        "oct": oct_net, "sep": sep_net, "sepf": sep_full,
        # `red` is the Oct 31 outlook, not today's standing - the board has
        # always counted "in the red" as projected to finish below her own
        # September. `behind` is the same-days comparison, which only decides
        # whether an on-course creator reads `hold` instead of `safe`.
        "red": proj_red, "behind": behind,
    }


def fans_of(rows, kind) -> set:
    """Distinct fans who bought one kind of thing."""
    return {r["f"] for r in rows
            if live(r) and r.get("f") and r.get("k") == kind}


def stats(rows) -> dict:
    """Her month in the board's own terms.

    `buyers` is fans who bought a PPV, not every fan who appears - a
    subscription row is not a purchase decision a chatter made, and the board
    labels this column "PPV buyers". `ntips` counts tippers rather than tips,
    so one generous fan tipping four times reads as one.
    """
    return {
        "net": net(rows),
        "buyers": len(fans_of(rows, "Messages")),
        "sales": count_kind(rows, "Messages"),
        "avg": round(avg_ppv(rows), 1),
        "tips": kind_net(rows, "Tips"),
        "ntips": len(fans_of(rows, "Tips")),
        "subs": count_kind(rows, "Subscription"),
        "ren": count_kind(rows, "RecurringSubscription"),
    }


def idle_spenders(rows_oct, rows_sep, last_day: str = "") -> list:
    """Fans who spent $75+ in September and nothing at all this month.

    "Nothing this month" is judged across the whole of October rather than the
    settled days: a fan who bought something yesterday has not gone quiet, and
    truncating the window would put her on a win-back list she does not belong
    on. `last_day` is accepted and ignored for that reason.
    """
    sep_by_fan = defaultdict(int)
    for r in rows_sep:
        if live(r) and r.get("f"):
            sep_by_fan[r["f"]] += r.get("e") or 0
    active = fans(rows_oct)
    out = [(f, cents) for f, cents in sep_by_fan.items()
           if cents >= 7500 and f not in active]
    out.sort(key=lambda p: -p[1])
    return out
