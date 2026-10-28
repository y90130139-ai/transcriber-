"""Whether each model's traffic has somewhere to land, read once a day.

Three surfaces can carry a funnel link and only one of them has to work: the
bio, a highlight, a live story. A model with none of the three is posting into
a dead end — the views happen, the fans arrive at her profile, and there is no
way through to the page they would have paid for. In October 2026 that was 52
of 60 accounts and 95% of the roster's 4.7M followers, which is the whole of
the month's acquisition collapse in one sentence.

Nobody can hold sixty profiles in their head. Two people tried and the gaps
only surfaced when revenue had already fallen for six weeks. So this runs on
the daily pass that is already reading every profile header for stories, reads
three more fields out of the same response, and says which accounts are dark.

**The Threads trap.** Instagram adds a Threads link to the profile header by
itself for anyone who has a Threads account. It looks exactly like a bio link
in the markup and it is not one — the model placed nothing, and a fan clicking
it lands on Threads, not on her page. Eleven of the sixty accounts read on
2026-10-27 were "linked" this way and every one of them was dark. A badge
whose handle matches the account is never a placement, and that single rule is
the difference between this file being useful and it being a liar.

Nothing here opens a story or a highlight. That costs a view the creator can
see, attributed to whichever account ran it, so it belongs in a deliberate
weekly pass and not in a daily robot. What a daily reading *can* say without
touching anything is whether a story is up at all and whether any highlight
exists — and combined with the bio that is enough to tell a dark account from
a lit one.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Destinations that exist to sell the page. A link to one of these is a funnel.
FUNNEL_HOSTS = {
    "link.me", "linktr.ee", "linktree.com", "beacons.ai", "beacons.page",
    "grabme.bio", "allmylinks.com", "linkylo.co", "fanslink.co", "fanslink.vip",
    "onlyfans.com", "fansly.com", "hoo.be", "snipfeed.co", "stan.store",
    "withkoji.com", "milkshake.app", "campsite.bio", "solo.to", "carrd.co",
}

# A link, but not a funnel: it moves the fan sideways onto another feed.
SOCIAL_HOSTS = {
    "threads.com", "threads.net", "x.com", "twitter.com", "tiktok.com",
    "youtube.com", "m.youtube.com", "youtu.be", "facebook.com", "snapchat.com",
    "poshmark.com", "posh.mk", "amazon.com", "amzn.to",
}

TIMEOUT_SEC = 12.0
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"

GREEN, AMBER, RED, UNKNOWN = "green", "amber", "red", "unknown"


def host(url: str) -> str:
    """The bare hostname, lowercased, with any www. dropped."""
    if not url:
        return ""
    if "://" not in url:
        url = "https://" + url
    try:
        name = (urllib.parse.urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return name[4:] if name.startswith("www.") else name


def is_threads_badge(url: str, handle: str) -> bool:
    """Instagram's own Threads link, which the model did not place.

    It is the same handle on threads.com. A model who deliberately links her
    Threads profile from her bio writes the same URL, so this will call that a
    badge too — and it is right to, because either way there is no funnel.
    """
    if host(url) not in ("threads.com", "threads.net"):
        return False
    path = urllib.parse.urlparse(url if "://" in url else "https://" + url).path
    return path.strip("/").lstrip("@").lower() == (handle or "").lstrip("@").lower()


def kind(url: str, handle: str = "", extra_funnel_hosts=()) -> str:
    """What a link on a profile actually is: funnel, badge, other, or none."""
    if not url:
        return "none"
    if is_threads_badge(url, handle):
        return "badge"
    name = host(url)
    if name in FUNNEL_HOSTS or name in {h.lower() for h in extra_funnel_hosts}:
        return "funnel"
    if name in SOCIAL_HOSTS:
        return "other"
    # An unrecognised domain is often the model's own landing page — the most
    # valuable funnel she can have — and just as often something else entirely.
    # On 2026-10-27 the bio of a 348K account held a press article about a
    # jeweller, which this would happily have called a working funnel. So it
    # says "maybe", which reads as amber and asks for one human confirmation;
    # confirm it once and `confirmed_hosts` makes it green from then on.
    return "maybe"


def bio_links(snapshot: dict):
    """Every URL the profile header carries, newest field first.

    Instagram moved from one `external_url` to a `bio_links` list; accounts
    answer with either, and some with both.
    """
    found = []
    for entry in (snapshot.get("bio_links") or []):
        url = entry.get("url") if isinstance(entry, dict) else entry
        if url:
            found.append(url)
    single = snapshot.get("external_url")
    if single and single not in found:
        found.append(single)
    return found


def assess(snapshot: dict, extra_funnel_hosts=()) -> dict:
    """One account's funnel, as the daily header reading sees it."""
    handle = (snapshot.get("handle") or "").lstrip("@")
    links = bio_links(snapshot)
    kinds = [kind(u, handle, extra_funnel_hosts) for u in links]
    funnels = [u for u, k in zip(links, kinds) if k == "funnel"]
    maybes = [u for u, k in zip(links, kinds) if k == "maybe"]

    has_bio_funnel = bool(funnels)
    has_story = bool(snapshot.get("has_story"))
    highlights = snapshot.get("highlights")
    has_highlight = bool(highlights)

    # `external_url` absent from the payload is not the same as a bio with no
    # link in it. Saying "no link" when the field was never read is how a board
    # starts lying to the person reading it.
    read_bio = ("bio_links" in snapshot) or ("external_url" in snapshot)

    if not read_bio:
        state = UNKNOWN
    elif has_bio_funnel:
        state = GREEN
    elif maybes or has_story or has_highlight:
        # Something *might* carry a link — an unrecognised domain, a highlight,
        # a live story — but only a human look can prove it. Amber is the queue
        # for the weekly deep pass, not a pass mark.
        state = AMBER
    else:
        state = RED

    return {
        "handle": handle,
        "state": state,
        "bio_links": links,
        "bio_kinds": kinds,
        "bio_funnel": funnels[0] if funnels else None,
        "bio_maybe": maybes[0] if maybes else None,
        "has_story": has_story,
        "highlights": highlights,
        "followers": snapshot.get("followers"),
        "is_private": snapshot.get("is_private"),
        "read_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def probe(url: str, timeout: float = TIMEOUT_SEC) -> dict:
    """Does the destination still answer? A link in a bio proves nothing if the
    page behind it is suspended, and that is the flagging case Geno asks about:
    the model did her part, the host took it down, and nobody saw."""
    target = url if "://" in url else "https://" + url
    request = urllib.request.Request(target, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return {
                "url": url,
                "ok": 200 <= response.status < 400,
                "status": response.status,
                "final_host": host(response.geturl()),
            }
    except urllib.error.HTTPError as error:
        return {"url": url, "ok": False, "status": error.code, "final_host": host(target)}
    except Exception as error:  # DNS gone, TLS dead, timeout — all mean "not reachable"
        return {"url": url, "ok": False, "status": None, "error": str(error)[:120],
                "final_host": host(target)}


def transitions(before, after):
    """What changed overnight. A link that disappeared yesterday is worth more
    than a list of everyone who is dark, because it is still fresh enough to ask
    about and the model remembers doing it."""
    was = {r["handle"]: r for r in (before or [])}
    events = []
    for record in after or []:
        old = was.get(record["handle"])
        if not old:
            events.append({"handle": record["handle"], "event": "new", "to": record["state"]})
            continue
        if old.get("state") == record.get("state"):
            continue
        if old.get("state") == GREEN and record.get("state") in (AMBER, RED):
            events.append({"handle": record["handle"], "event": "went_dark",
                           "from": old.get("state"), "to": record["state"],
                           "lost": old.get("bio_funnel")})
        elif record.get("state") == GREEN:
            events.append({"handle": record["handle"], "event": "lit",
                           "from": old.get("state"), "to": GREEN,
                           "gained": record.get("bio_funnel")})
        else:
            events.append({"handle": record["handle"], "event": "changed",
                           "from": old.get("state"), "to": record["state"]})
    return events


def store(records, root: Path, day: str = "") -> Path:
    """Today's reading, kept so tomorrow can diff against it and so the domain
    ledger has a history to answer 'which hosts keep dying' from."""
    day = day or time.strftime("%Y-%m-%d")
    folder = Path(root) / "funnel"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (day + ".json")
    path.write_text(json.dumps(records, indent=1), encoding="utf8")
    (folder / "latest.json").write_text(json.dumps(records, indent=1), encoding="utf8")
    return path


def previous(root: Path, before_day: str = ""):
    """The most recent reading older than `before_day`, or an empty list."""
    folder = Path(root) / "funnel"
    if not folder.is_dir():
        return []
    before_day = before_day or time.strftime("%Y-%m-%d")
    days = sorted(p for p in folder.glob("20*.json") if p.stem < before_day)
    if not days:
        return []
    try:
        return json.loads(days[-1].read_text(encoding="utf8"))
    except (ValueError, OSError):
        return []


def digest(records, events=()) -> str:
    """The morning message. Counts first, then what changed, then the dark list
    ordered by followers — the biggest wasted audience at the top."""
    dark = [r for r in records if r.get("state") == RED]
    amber = [r for r in records if r.get("state") == AMBER]
    lit = [r for r in records if r.get("state") == GREEN]
    unknown = [r for r in records if r.get("state") == UNKNOWN]

    reach_dark = sum(r.get("followers") or 0 for r in dark + amber)
    lines = [
        "FUNNEL — {}".format(time.strftime("%a %d %b")),
        "{} lit · {} unverified · {} dark · {} unread".format(
            len(lit), len(amber), len(dark), len(unknown)),
        "{:,} followers with no bio link".format(reach_dark),
    ]

    went_dark = [e for e in events if e.get("event") == "went_dark"]
    if went_dark:
        lines.append("")
        lines.append("Lost a link since the last reading:")
        for event in went_dark:
            lines.append("  @{} — was {}".format(event["handle"], event.get("lost") or "linked"))

    newly_lit = [e for e in events if e.get("event") == "lit"]
    if newly_lit:
        lines.append("")
        lines.append("Back up:")
        for event in newly_lit:
            lines.append("  @{} — {}".format(event["handle"], event.get("gained") or "linked"))

    if dark:
        lines.append("")
        lines.append("Dark, biggest audience first:")
        for record in sorted(dark, key=lambda r: -(r.get("followers") or 0))[:15]:
            lines.append("  @{} — {:,} followers, no story, no highlight".format(
                record["handle"], record.get("followers") or 0))
    return "\n".join(lines)


def ledger(root: Path):
    """Which link hosts survive on a profile, and which keep disappearing.

    Geno's standing question is whether deep links get flagged faster than a
    plain x.com profile — he is running that test on Rae's backup now. A hunch
    cannot answer it and neither can one morning's reading; only the run of
    daily files can, which is why every day is kept rather than overwritten.

    `placed` counts the account-days a host was visible, `lost` the number of
    times it was there one reading and gone the next. A host with a high lost
    count against few placements is dying young.
    """
    folder = Path(root) / "funnel"
    days = sorted(folder.glob("20*.json")) if folder.is_dir() else []
    seen = {}
    previous_by_handle = {}
    for path in days:
        try:
            records = json.loads(path.read_text(encoding="utf8"))
        except (ValueError, OSError):
            continue
        today_by_handle = {}
        for record in records:
            url = record.get("bio_funnel") or record.get("bio_maybe")
            name = host(url) if url else ""
            today_by_handle[record.get("handle")] = name
            if not name:
                continue
            row = seen.setdefault(name, {"host": name, "placed": 0, "lost": 0, "last_seen": ""})
            row["placed"] += 1
            row["last_seen"] = path.stem
        for handle, was in previous_by_handle.items():
            now = today_by_handle.get(handle, "")
            if was and was != now:
                seen.setdefault(was, {"host": was, "placed": 0, "lost": 0, "last_seen": ""})
                seen[was]["lost"] += 1
        previous_by_handle = today_by_handle
    return sorted(seen.values(), key=lambda r: (-r["lost"], -r["placed"]))


def confirmed_hosts(root: Path):
    """Domains a human has confirmed really are a model's own funnel.

    `funnel/confirmed.json` is a plain list of hostnames. It exists so that
    confirming kieraleex.com once makes it green forever, instead of the board
    asking the same question every morning until everyone stops reading it.
    """
    path = Path(root) / "funnel" / "confirmed.json"
    if not path.is_file():
        return []
    try:
        value = json.loads(path.read_text(encoding="utf8"))
    except (ValueError, OSError):
        return []
    return [str(h).lower() for h in value] if isinstance(value, list) else []


def latest(root: Path):
    """The most recent reading on disk, or an empty list."""
    path = Path(root) / "funnel" / "latest.json"
    if not path.is_file():
        return []
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except (ValueError, OSError):
        return []


def roster(root: Path):
    """Our own accounts, the only ones this watches.

    Deliberately not the scout watchlist: a competitor's missing link is not a
    problem, it is an opportunity, and it must never show up in a morning
    message that is meant to be a to-do list.
    """
    path = Path(root) / "funnel" / "roster.json"
    try:
        value = json.loads(path.read_text(encoding="utf8"))
    except (OSError, ValueError):
        return []
    return [r for r in value if isinstance(r, dict) and r.get("handle")]


def scan(root: Path, jar, log=print):
    """Read every roster account's header once, on the burner, and judge it.

    One profile load each with the sweep's own pacing. This is a separate pass
    from `bin/scout daily` on purpose: that job also reads a 190-account
    watchlist, and the funnel has to be readable on its own schedule without
    waiting for competitor research to finish.
    """
    from . import scout_browser

    entries = roster(root)
    if not entries:
        log("no roster — write out/funnel/roster.json first")
        return [], None
    handles = [e["handle"] for e in entries]
    names = {e["handle"]: e.get("creator") for e in entries}
    log("reading {} accounts".format(len(handles)))
    snapshots, stopped = scout_browser.light_sweep(handles, jar, log=log)
    known = confirmed_hosts(root)
    records = []
    for snap in snapshots:
        carried = snap.pop("_funnel", None) or {}
        merged = dict(snap)
        merged.update(carried)
        record = assess(merged, known)
        record["creator"] = names.get(record["handle"])
        records.append(record)
    return records, stopped


def main(argv=None) -> int:
    """Read the roster's funnels, or report on the last reading."""
    import argparse

    from . import config

    parser = argparse.ArgumentParser(prog="funnel", description=__doc__.splitlines()[0])
    parser.add_argument("command", nargs="?", default="report",
                        choices=("report", "dark", "links", "scan", "hosts"),
                        help="scan: read every roster account now · report: the morning "
                             "digest · dark: accounts with no funnel · links: probe each "
                             "live funnel for a dead destination · hosts: which link "
                             "hosts survive")
    args = parser.parse_args(argv)

    root = config.DEFAULT_OUT_DIR

    if args.command == "scan":
        from . import scout
        jar = scout._active_jar()
        if jar is None:
            print("the scan needs the burner session — see docs/SCOUT-SETUP.md")
            return 1
        records, stopped = scan(root, jar)
        if not records:
            return 1
        before = previous(root)
        store(records, root)
        events = transitions(before, records)
        print(digest(records, events))
        if stopped:
            print("\nstopped early: {}".format(stopped))
        return 0

    if args.command == "hosts":
        for row in ledger(root):
            print("{:<22} {:>3} placed  {:>3} lost  {}".format(
                row["host"], row["placed"], row["lost"],
                "last seen " + row["last_seen"] if row["last_seen"] else ""))
        return 0

    records = latest(root)
    if not records:
        print("No funnel reading yet — it is written by the daily pass (bin/scout daily).")
        return 1

    if args.command == "report":
        print(digest(records, transitions(previous(root), records)))
        return 0

    if args.command == "dark":
        dark = [r for r in records if r.get("state") in (RED, AMBER)]
        for record in sorted(dark, key=lambda r: -(r.get("followers") or 0)):
            print("{:<28} {:>9,}  {}".format(
                "@" + record["handle"], record.get("followers") or 0, record["state"]))
        print("\n{} of {} accounts have no proven funnel.".format(len(dark), len(records)))
        return 0

    dead = 0
    for record in records:
        url = record.get("bio_funnel")
        if not url:
            continue
        result = probe(url)
        if not result["ok"]:
            dead += 1
            print("DEAD  @{:<24} {}  ({})".format(
                record["handle"], url, result.get("status") or result.get("error")))
    print("\n{} dead destination(s).".format(dead))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
