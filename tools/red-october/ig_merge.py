"""Attach the live Instagram reading to each row of the board's IG list.

The board has always carried two things about an account: what the team
recorded on the IG Link Coverage board, and what Geno saw when he opened it.
This adds a third that neither of those is - what Instagram served the burner
this morning - and keeps them in separate columns on purpose. When the record
and the reading disagree it is the record that is usually wrong, and that
disagreement is the most useful thing on the page.
"""

from __future__ import annotations

import json
import os

SCRATCH = os.path.dirname(os.path.abspath(__file__))
FUNNEL = os.path.expanduser("~/projects/social-transcriber/out/funnel")

# What the funnel's own states mean in the board's words.
WORDS = {
    "green": "link live",
    "amber": "unverified",
    "red": "nothing up",
    "unknown": "unread",
}


def latest() -> dict:
    """The newest funnel reading, by handle."""
    path = os.path.join(FUNNEL, "latest.json")
    if not os.path.exists(path):
        return {}
    return {r["handle"]: r for r in json.load(open(path))}


def previous() -> dict:
    days = sorted(f for f in os.listdir(FUNNEL)
                  if f[:2] == "20" and f.endswith(".json"))
    if len(days) < 2:
        return {}
    return {r["handle"]: r for r in json.load(open(os.path.join(FUNNEL, days[-2])))}


def live_block(rec: dict, before: dict) -> dict:
    """One account's reading, trimmed to what the board shows."""
    # Show the link the verdict was reached on. A bio can hold several and the
    # first one is often a shop or a Linktree-of-nothing, which would make the
    # cell disagree with the badge beside it.
    url = rec.get("bio_funnel") or rec.get("bio_maybe")
    if not url:
        for cand in rec.get("bio_links") or []:
            u = cand.get("url") if isinstance(cand, dict) else cand
            if u:
                url = u
                break

    out = {
        "st": rec.get("state"),
        "say": WORDS.get(rec.get("state"), rec.get("state")),
        "url": url,
        "story": bool(rec.get("has_story")),
        "hl": rec.get("highlights"),
        "fol": rec.get("followers"),
        "priv": bool(rec.get("is_private")),
        "at": rec.get("read_at"),
    }
    # A move out of `unknown` is the baseline filling in, not news. Every row
    # would carry one on the first real scan, which would bury the two that
    # actually changed.
    was = before.get(rec["handle"])
    if (was and was.get("state") not in (None, "unknown")
            and was.get("state") != rec.get("state")):
        out["moved"] = "{} → {}".format(was.get("state"), rec.get("state"))
    return out


def refresh_money(row: dict, creators: dict) -> dict:
    """Re-point the row's money columns at the new reading of her account.

    The IG list shows what each account has cost per week, and those figures
    come from the Infloww side. Leaving them at the previous sync would put a
    fresh link reading next to a stale dollar figure on the same row.
    """
    c = creators.get(row["cr"])
    if not c:
        return row
    wk = (c.get("TR") or {}).get("WK") or {}
    peak, nowv = wk.get("peak") or 0, wk.get("now") or 0
    out = dict(row)
    out["sepf"] = c["T"]["sepf"]
    out["tier_"] = c["T"]["tier"]
    if peak:
        out["wkNow"] = nowv
        out["wkPeak"] = peak
        out["wkPct"] = round((nowv - peak) / peak * 100, 1)
        out["loss"] = max(0, round((peak - nowv) / 100))
    return out


def merge(igr: list, creators: dict | None = None) -> tuple[list, dict]:
    now, before = latest(), previous()
    creators = creators or {}
    rows, hit = [], 0
    for row in igr:
        handle = row["h"].lstrip("@")
        rec = now.get(handle)
        new = refresh_money(row, creators)
        if rec:
            new["live"] = live_block(rec, before)
            hit += 1
        else:
            # Not on the funnel roster, so the scan says nothing about her.
            # Silence is not "no link" and must never render as one.
            new["live"] = {"st": None, "say": "not scanned", "url": None}
        rows.append(new)

    # One Instagram account can serve two Infloww accounts - a FREE page and a
    # VIP page share a handle - so the list has more rows than accounts. Count
    # accounts, or a shared handle's followers are reported twice.
    read = [r for r in rows if r["live"].get("st")]
    uniq = {}
    for r in read:
        uniq.setdefault(r["h"].lstrip("@"), r["live"])
    seen = list(uniq.values())

    def fol(states) -> int:
        return sum(L.get("fol") or 0 for L in seen if L["st"] in states)

    tally = {
        "scanned": len(uniq),
        "rows": hit,
        "total": len(rows),
        "green": sum(1 for L in seen if L["st"] == "green"),
        "amber": sum(1 for L in seen if L["st"] == "amber"),
        "red": sum(1 for L in seen if L["st"] == "red"),
        "unknown": sum(1 for L in seen if L["st"] == "unknown"),
        "stories": sum(1 for L in seen if L.get("story")),
        "moved": [{"h": r["h"], "m": r["live"]["moved"]}
                  for r in read if r["live"].get("moved")],
        # Audience sitting behind an account a fan cannot buy from.
        "dark_fol": fol(("red", "amber")),
        "lit_fol": fol(("green",)),
        # The single largest audience on the board, so the headline figure can
        # say how much of itself rests on one row.
        "top_dark": max(
            ({"h": "@" + h, "fol": L.get("fol") or 0}
             for h, L in uniq.items() if L["st"] in ("red", "amber")),
            key=lambda d: d["fol"], default={"h": None, "fol": 0}),
        "at": max((L.get("at") or "") for L in seen) if seen else None,
    }
    return rows, tally


def add_link_alerts(D: dict, rows: list) -> int:
    """Raise the board's `link` alert from the reading rather than the record.

    The action queue already weights `link` above everything else and nothing
    has ever produced one, because until now no field on the board knew whether
    a link was actually there. A dark account is the one alert worth outranking
    a $0 day: the $0 day is a symptom of it.
    """
    dark = {}
    for row in rows:
        live = row.get("live") or {}
        if live.get("st") == "red":
            dark.setdefault(row["cr"], []).append(row["h"])

    added = 0
    for c in D["creators"]:
        handles = dark.get(c["name"])
        if not handles:
            continue
        alerts = [a for a in c.get("alerts") or [] if a[0] != "link"]
        alerts.insert(0, ["link", "no link on Instagram right now ({})".format(
            ", ".join(handles[:3]))])
        c["alerts"] = alerts
        added += 1
    return added


if __name__ == "__main__":
    igr = json.load(open(os.path.join(SCRATCH, "igr.json")))
    D = json.load(open(os.path.join(SCRATCH, "D-new.json")))
    rows, tally = merge(igr, {c["name"]: c for c in D["creators"]})
    n = add_link_alerts(D, rows)
    json.dump(D, open(os.path.join(SCRATCH, "D-new.json"), "w"),
              separators=(",", ":"))
    print("link alerts raised on {} creators".format(n))
    json.dump(rows, open(os.path.join(SCRATCH, "igr-new.json"), "w"),
              separators=(",", ":"))
    json.dump(tally, open(os.path.join(SCRATCH, "ig-tally.json"), "w"), indent=1)
    print(json.dumps(tally, indent=1))
    print()
    for r in rows:
        L = r["live"]
        print("%-30s %-12s %-11s %s" % (
            r["h"], L.get("say"), r["cr"][:11],
            (L.get("url") or "")[:52] + ("  [story]" if L.get("story") else "")))
