"""Rebuild the Red October data blocks from the Infloww mirror.

What this recomputes and what it carries over matters, so it is stated once
here: every money field is recomputed from the mirror, and the blocks that
come from sources this script cannot see - Autoposter posting counts, trial
link tracking, the chatter briefs written against them - are carried over from
the previous board unchanged. The IG section gains a live reading from the
funnel scan, which is new and is the only thing on the board that says what
Instagram shows rather than what someone recorded.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta

import money

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OLD = os.path.join(SCRATCH, "D-old.json")
IGR_OLD = os.path.join(SCRATCH, "igr.json")
FUNNEL = os.path.expanduser("~/projects/social-transcriber/out/funnel")

GOAL = 20  # creators allowed to finish below their own September


def month_days(last_day: str) -> list:
    return ["2026-10-%02d" % d for d in range(1, int(last_day[-2:]) + 1)]


def dark_days(days: dict, last_day: str) -> list:
    return [int(d[-2:]) for d in month_days(last_day) if days.get(d, 0) == 0]


def quiet_hours(rows, last_day: str) -> list:
    """Clock hours that never take money. Chatting cover, not a money fact."""
    seen = set()
    for r in rows:
        if money.live(r) and money.day_of(r["t"]) <= last_day:
            seen.add(datetime.fromtimestamp(r["t"] / 1000, money.ET).hour)
    out = []
    for h in range(24):
        if h not in seen:
            out.append("%d%s" % (h % 12 or 12, "am" if h < 12 else "pm"))
    return out


def window_net(days: dict, upto: str, span: int, back: int = 0) -> int:
    end = datetime.strptime(upto, "%Y-%m-%d") - timedelta(days=back)
    return sum(days.get((end - timedelta(days=i)).strftime("%Y-%m-%d"), 0)
               for i in range(span))


def cooled(rows_oct, rows_sep, last_day: str) -> list:
    """Fans who spent well in September and have nearly stopped, not stopped."""
    sep = defaultdict(int)
    for r in rows_sep:
        if money.live(r) and r.get("f"):
            sep[r["f"]] += r.get("e") or 0
    now = defaultdict(int)
    for r in money.through(rows_oct, last_day):
        if money.live(r) and r.get("f"):
            now[r["f"]] += r.get("e") or 0
    out = []
    for fan, was in sep.items():
        has = now.get(fan, 0)
        if was >= 50000 and 0 < has < was * 0.25:
            out.append([fan, round(was / 100), round(has / 100)])
    out.sort(key=lambda t: -t[1])
    return out[:3]


def median_ppv(rows) -> int:
    vals = [r.get("a") or 0 for r in rows
            if money.live(r) and r.get("k") == "Messages"]
    return round(statistics.median(vals) / 100) if vals else 0


def alerts_for(cur: dict, prev: dict, days: dict, last_day: str, dark: list) -> list:
    """What changed about her that is worth a line at the top of the board."""
    out = []
    order = ["safe", "hold", "push", "stretch", "out"]
    if cur["tier"] != prev["tier"]:
        worse = order.index(cur["tier"]) > order.index(prev["tier"])
        out.append(["up" if worse else "down",
                    "{} -> {}".format(prev["tier"], cur["tier"])])

    recent = [d for d in dark if d >= int(last_day[-2:]) - 2]
    if recent:
        names = ", ".join("Oct %d" % d for d in recent)
        out.append(["dark", "took $0 on {}".format(names)])

    last2 = window_net(days, last_day, 2) / 2.0
    prior4 = window_net(days, last_day, 4, back=2) / 4.0
    if prior4 > 0 and last2 < prior4 * 0.5:
        out.append(["drop", "${:,.0f}/day last 2 days vs ${:,.0f}/day before".format(
            last2 / 100, prior4 / 100)])
    elif prior4 > 0 and last2 > prior4 * 2:
        out.append(["surge", "${:,.0f}/day last 2 days vs ${:,.0f}/day before".format(
            last2 / 100, prior4 / 100)])
    return out


def week_vs_peak(days: dict, last_day: str) -> dict:
    """Her last seven days against the roster's peak week, Sep 14-20."""
    now = window_net(days, last_day, 7)
    return {"now": now}


def build(last_day: str) -> dict:
    names, gone = money.roster()
    oct_m, sep_m = money.load_month("2026-10"), money.load_month("2026-09")
    settled = int(last_day[-2:])
    days_left = 31 - settled
    prev_day = "2026-10-%02d" % (settled - 2)

    old = json.load(open(OLD))
    carry = {c["name"]: c for c in old["creators"]}

    keep = [c for c in names
            if c not in gone and names[c] not in money.LEFT]

    creators, tiers = [], defaultdict(int)
    agg_days = defaultdict(int)
    for cid in keep:
        name = names[cid]
        ro, rs = oct_m.get(cid, []), sep_m.get(cid, [])
        oct_rows = money.through(ro, last_day)
        days = money.by_day(oct_rows)
        for d, v in days.items():
            agg_days[d] += v

        cur = money.creator_view(ro, rs, last_day, days_left)
        prev = money.creator_view(ro, rs, prev_day, 31 - (settled - 2))
        dark = dark_days(days, last_day)
        was = carry.get(name, {})

        rec = {
            "id": cid, "name": name,
            "chat": was.get("chat", "CHAT" in name.upper() or "Chat" in name),
            "T": cur, "P": prev,
            "O": money.stats(oct_rows),
            "S": money.stats(money.through(rs, "2026-09-%02d" % settled)),
            "dark": dark,
            "last2": round(window_net(days, last_day, 2) / 2),
            "prior4": round(window_net(days, last_day, 4, back=2) / 4),
            "l7": window_net(days, last_day, 7),
            "p7": window_net(days, last_day, 7, back=7),
            "med": median_ppv(rs),
            "quiet": quiet_hours(ro, last_day),
            "cooled": cooled(ro, rs, last_day),
        }
        idle = money.idle_spenders(ro, rs, last_day)
        rec["idle"] = [[f, round(c / 100)] for f, c in idle[:5]]
        rec["idleN"] = len(idle)
        # Each fan's dollars are rounded before they are added, which is
        # how the figure is quoted back in the chatter brief.
        rec["idleD"] = sum(round(c / 100) for _, c in idle)
        rec["alerts"] = alerts_for(cur, prev, days, last_day, dark)

        # A creator who was not on the previous board has none of the blocks
        # that come from outside the Infloww mirror. The page reads several of
        # them without guarding - the traffic panel does `c.TR.WK` straight
        # out - so she gets empty ones rather than nothing, and reads as new.
        rec.update({
            "TR": {"dipA": 0, "dipB": 0, "dipPct": None, "newD": 0, "newB": 0,
                   "retD": 0, "retB": 0, "newPct": None, "retPct": None,
                   "subsD": 0, "subsB": 0, "links": {}, "post": None,
                   "driver": "no reading yet", "bucket": "—",
                   "owner": "unassigned", "WK": {}},
            "acts": [], "ig": [], "igsev": -1, "igmodel": None,
            "igunsure": False, "isnew": True,
        })
        for key in ("TR", "acts", "ig", "igsev", "igmodel", "igunsure", "isnew"):
            if key in was:
                rec[key] = was[key]
        if "TR" in rec and isinstance(rec["TR"], dict) and "WK" in rec["TR"]:
            wk = dict(rec["TR"]["WK"])
            peak = wk.get("peak") or 0
            wk["now"] = rec["l7"]
            wk["pct"] = round((rec["l7"] - peak) / peak * 100, 1) if peak else None
            rec["TR"] = dict(rec["TR"], WK=wk)

        tiers[cur["tier"]] += 1
        creators.append(rec)

    creators.sort(key=lambda c: -c["T"]["sepf"])

    oct_net = sum(c["T"]["oct"] for c in creators)
    sep_same = sum(c["T"]["sep"] for c in creators)
    sep_full = sum(c["T"]["sepf"] for c in creators)
    red = sum(1 for c in creators if c["T"]["red"])
    proj = sum(1 for c in creators if c["T"]["proj"])
    proj_prev = sum(1 for c in creators if c["P"]["proj"])

    pace = money.pace_of(agg_days, last_day, 4)
    best = max(oct_net / float(settled), pace)
    tie = (sep_full - oct_net) / float(days_left) if days_left else 0

    def shift(day: str, back: int) -> str:
        return (datetime.strptime(day, "%Y-%m-%d")
                - timedelta(days=back)).strftime("%Y-%m-%d")

    def band(upto, span):
        rows = []
        for cid in keep:
            rows += [r for r in money.through(oct_m.get(cid, []), upto)
                     if money.day_of(r["t"]) > (
                         datetime.strptime(upto, "%Y-%m-%d") - timedelta(days=span)
                     ).strftime("%Y-%m-%d")]
        return {"net": money.net(rows), "buyers": len(money.fans(rows)),
                "sales": money.count_kind(rows, "Messages"),
                "avg": round(money.avg_ppv(rows), 1)}

    def sep_band(upto, span):
        rows = []
        for cid in keep:
            rows += [r for r in sep_m.get(cid, [])
                     if (datetime.strptime(upto, "%Y-%m-%d")
                         - timedelta(days=span)).strftime("%Y-%m-%d")
                     < money.day_of(r["t"]) <= upto]
        return {"net": money.net(rows), "buyers": len(money.fans(rows)),
                "sales": money.count_kind(rows, "Messages"),
                "avg": round(money.avg_ppv(rows), 1)}

    day_pairs = []
    sep_days = defaultdict(int)
    for cid in keep:
        for d, v in money.by_day(sep_m.get(cid, [])).items():
            sep_days[d] += v
    for d in range(1, settled + 1):
        day_pairs.append([d, agg_days.get("2026-10-%02d" % d, 0),
                          sep_days.get("2026-09-%02d" % d, 0)])

    agency = {
        # `left` is days left in October - the bar renders it as "Days left"
        # and the briefs count her remaining days from it.
        "active": len(creators), "od": settled, "left": days_left,
        "synced": json.load(open(os.path.join(money.STATE, "revenue-sync.json")))
                      .get("lastRunAt"),
        "gone": [{"name": names.get(c, c), "sepf": money.net(sep_m.get(c, []))}
                 for c in sorted(gone)],
        "oct": oct_net, "sep": sep_same, "sepf": sep_full,
        "red": red, "proj": proj, "projPrev": proj_prev,
        "tiers": dict(tiers),
        # `wk` is the SAME THREE WEEKDAYS a week earlier, not the last seven
        # days - the alarm divides last3 by it and calls the result "against
        # the same weekdays a week earlier", so a 7-day total here would read
        # as a 60% collapse every single morning.
        "last3": band(last_day, 3), "wk": band(shift(last_day, 7), 3),
        "sep3": sep_band("2026-09-%02d" % settled, 3),
        "days": day_pairs, "goal": GOAL,
        "pace": int(pace), "tie": int(tie),
        "best_case": sum(1 for c in creators
                         if c["T"]["oct"] + c["T"]["best"] * days_left < c["T"]["sepf"]),
        "TRAF": old["agency"].get("TRAF", {}),
    }
    return {"agency": agency, "creators": creators}


if __name__ == "__main__":
    last = sys.argv[1] if len(sys.argv) > 1 else "2026-10-27"
    data = build(last)
    out = os.path.join(SCRATCH, "D-new.json")
    json.dump(data, open(out, "w"), separators=(",", ":"))
    a = data["agency"]
    print("settled through {} · {} creators".format(last, a["active"]))
    print("oct ${:,.0f} · sep same ${:,.0f} · sep full ${:,.0f}".format(
        a["oct"] / 100, a["sep"] / 100, a["sepf"] / 100))
    print("red {} · projected red {} (was {}) · goal {}".format(
        a["red"], a["proj"], a["projPrev"], a["goal"]))
    print("tiers:", dict(a["tiers"]))
    print("wrote", out)
