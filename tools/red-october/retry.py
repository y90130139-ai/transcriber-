"""Read the handful of accounts a DNS failure cost us, and fold them in.

Three of sixty did not resolve on the first pass. The scan was right to drop
them rather than record a guess, but leaving them out means the board shows
"not scanned" for two of Snow's accounts and one of Tammy's - so they are
read again on their own instead of repeating all sixty.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.expanduser("~/projects/social-transcriber"))

from src import config, funnel, scout, scout_browser  # noqa: E402

MISSED = ["voodoo.hoochietv", "voodoo.hoochiex", "xo.tammylee"]


def main() -> int:
    root = config.DEFAULT_OUT_DIR
    jar = scout._active_jar()
    if jar is None:
        print("no burner session")
        return 1

    entries = {e["handle"]: e for e in funnel.roster(root)}
    todo = [h for h in MISSED if h in entries]
    print("re-reading {}".format(", ".join("@" + h for h in todo)))

    snaps, _ = scout_browser.light_sweep(todo, jar, log=print)
    known = funnel.confirmed_hosts(root)
    fresh = []
    for snap in snaps:
        carried = snap.pop("_funnel", None) or {}
        merged = dict(snap)
        merged.update(carried)
        rec = funnel.assess(merged, known)
        rec["creator"] = entries[rec["handle"]].get("creator")
        fresh.append(rec)

    if not fresh:
        print("still unreadable - leaving them unread rather than guessing")
        return 1

    day = os.path.join(root, "funnel", "2026-10-28.json")
    have = json.load(open(day))
    seen = {r["handle"] for r in have}
    added = [r for r in fresh if r["handle"] not in seen]
    have += added
    have.sort(key=lambda r: r["handle"])
    for path in (day, os.path.join(root, "funnel", "latest.json")):
        json.dump(have, open(path, "w"), indent=1)

    for r in added:
        print("  @{:<26} {:<8} {}".format(
            r["handle"], r["state"],
            (r.get("bio_funnel") or r.get("bio_maybe") or "no link")))
    print("{} records in the day's reading".format(len(have)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
