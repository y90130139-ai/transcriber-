"""Who to contact and what to ask for, rebuilt from the live reading.

The old list asked about a link because the coverage board recorded a problem.
This one asks because the burner looked this morning and there was no way
through, which is a different and much better reason: it cannot be out of date,
and it names the account rather than the record.

Nothing here sends anything. It is the list, not the messages.
"""

from __future__ import annotations

import json
import os

SCRATCH = os.path.dirname(os.path.abspath(__file__))

# A creator is worth an ask when real money is behind her. Below this the ask
# costs more attention than it can return.
LOSS_FLOOR = 250


def build(igr: list, creators: dict) -> list:
    asks, seen = [], set()

    def add(row, ask, route):
        key = (row["cr"], ask)
        if key in seen:
            return
        seen.add(key)
        # IGR rows carry no chat flag of their own; it belongs to the Infloww
        # creator and decides whether the row renders as a creator ask or a
        # Patricia one, so it is looked up rather than assumed.
        owner = creators.get(row["cr"]) or {}
        asks.append({
            "cr": row["cr"], "chat": bool(owner.get("chat")),
            "ask": ask, "route": route,
            "loss": row.get("loss") or 0, "tgt": row.get("tgt"),
            "tier": row.get("tier_"), "wk": row.get("wkPct"),
            "sepf": row.get("sepf") or 0,
        })

    # A creator with three dark accounts is one conversation, not three rows,
    # and Nina Dolci's handles are shared by two Infloww accounts besides. So
    # the handles are gathered per creator first and named together.
    dark, vague = {}, {}
    for row in igr:
        st = (row.get("live") or {}).get("st")
        bucket = dark if st == "red" else (vague if st == "amber" else None)
        if bucket is None:
            continue
        bucket.setdefault(row["cr"], {"row": row, "hs": []})
        if row["h"] not in bucket[row["cr"]]["hs"]:
            bucket[row["cr"]]["hs"].append(row["h"])

    def route_for(row):
        if row.get("places") == "us":
            return "Iona"
        return "Her group" if row.get("tgt") else "Patricia"

    for cr, got in dark.items():
        add(got["row"],
            "Instagram shows no link at all right now — {}".format(
                ", ".join(got["hs"])),
            route_for(got["row"]))
    for cr, got in vague.items():
        if cr in dark:
            continue  # the dark ask already covers her
        add(got["row"],
            "Her only link is unverified, one look settles it — {}".format(
                ", ".join(got["hs"])),
            route_for(got["row"]))

    for row in igr:
        loss = row.get("loss") or 0
        # The story reminder cannot reach a group on the skip list, so a story
        # ask for her is a bot setting, not a message.
        if row.get("tgs") is False and loss >= LOSS_FLOOR:
            add(row, "Her group gets no story reminder (skip list)",
                "Geno — bot setting")

        if row.get("poster") is None and row.get("ppd") is None and loss >= LOSS_FLOOR:
            add(row, "No Autoposter workspace at all", "No owner — Geno assigns")

    # Chat clients run their own marketing, so the only honest ask is a
    # question through Patricia about what changed on her side.
    for name, c in creators.items():
        if not c.get("chat"):
            continue
        peak = (c.get("TR") or {}).get("WK", {}).get("peak") or 0
        now = (c.get("TR") or {}).get("WK", {}).get("now") or 0
        lost = round((peak - now) / 100)
        if peak and lost >= 500:
            asks.append({
                "cr": name, "chat": True,
                "ask": "Her own marketing has stopped working — ask what changed",
                "route": "Patricia", "loss": lost, "tgt": None,
                "tier": c["T"]["tier"],
                "wk": round((now - peak) / peak * 100, 1),
                "sepf": c["T"]["sepf"],
            })

    asks.sort(key=lambda a: -(a["loss"] or 0))
    return asks


if __name__ == "__main__":
    igr = json.load(open(os.path.join(SCRATCH, "igr-new.json")))
    D = json.load(open(os.path.join(SCRATCH, "D-new.json")))
    creators = {c["name"]: c for c in D["creators"]}
    out = build(igr, creators)
    json.dump(out, open(os.path.join(SCRATCH, "asks-new.json"), "w"),
              separators=(",", ":"))
    print("{} asks".format(len(out)))
    for a in out[:18]:
        print("  %-26s %-9s %-22s %s" % (
            a["cr"][:26], "-$%d" % (a["loss"] or 0), a["route"], a["ask"][:58]))
