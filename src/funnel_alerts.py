"""The funnel reading, delivered to Geno's DM and nowhere else.

The creator groups already carry a brief, a story reminder and an invoice
chase; the staff group carries nine lanes. Neither of them needed a sixtieth
daily message about a link, so this goes to one person who can act on it.

**It will not post to a group.** The chat id is read from `funnel_chat_id`,
then `FUNNEL_CHAT_ID`, then `OWNER_CHAT_ID`, and a negative id — Telegram's
shape for a group or channel — is refused outright. `alerts.py` already holds
a `telegram_chat_id` pointing at the ops group and it would be an easy and
very loud mistake to fall back to it, so there is no fallback at all.

Nothing sends unless `--send` is passed. This bot has form: a same-day message
with a catch-up window once fired a two-day-old invoice reminder into 22
groups, which is why `bin/revenue-preview` exists and why this does the same.

The buttons are answered by the gosian-bot service on Railway, because
Telegram allows exactly one `getUpdates` consumer per token and that service
is it. Sending from here and handling the tap there is deliberate: no HTTP
endpoint, no shared disk, no second poller.
"""

from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

from . import alerts, config, funnel

TIMEOUT_SEC = 20
# Telegram caps callback_data at 64 bytes; "fn:ask:" plus a handle fits inside.
CB_PREFIX = "fn"
SNOOZE_DAYS = 7
DARK_SHOWN = 12


def dm_only(raw):
    """A chat id if it is a direct message, otherwise None.

    Telegram writes groups and channels as negative ids. Posting this digest
    into a group is the one mistake that cannot be taken back, so the check is
    its own function and is tested on its own.
    """
    if raw in (None, ""):
        return None
    text = str(raw).strip()
    return None if text.startswith("-") else text


def chat_id():
    """Geno's DM, or nothing. Never the ops group — see the module docstring."""
    import os

    raw = None
    try:
        settings = json.loads((config.ROOT / "secrets" / "alerts.json").read_text())
        raw = settings.get("funnel_chat_id")
    except (OSError, ValueError):
        pass
    raw = raw or os.environ.get("FUNNEL_CHAT_ID") or os.environ.get("OWNER_CHAT_ID")
    return dm_only(raw)


def _token():
    try:
        settings = json.loads((config.ROOT / "secrets" / "alerts.json").read_text())
    except (OSError, ValueError):
        return None
    return settings.get("telegram_bot_token")


def _state_path() -> Path:
    return config.DEFAULT_OUT_DIR / "funnel" / "alert-state.json"


def load_state() -> dict:
    try:
        value = json.loads(_state_path().read_text(encoding="utf8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=1), encoding="utf8")


def snoozed(state: dict, today: str = "") -> set:
    """Handles Geno has told it to stop mentioning, until their date passes."""
    today = today or time.strftime("%Y-%m-%d")
    return {h for h, until in (state.get("snooze") or {}).items() if str(until) > today}


def compose(records, events, state=None, today: str = "") -> str:
    """The message itself: what changed first, then the worst of what is dark.

    A digest that opens with the same sixty names every morning gets muted by
    Friday, so the top of it is only ever the overnight delta.
    """
    state = state or {}
    today = today or time.strftime("%Y-%m-%d")
    quiet = snoozed(state, today)

    lit = [r for r in records if r.get("state") == funnel.GREEN]
    # Snoozed means quiet everywhere, not just off the dark list - an account
    # that keeps showing up under a different heading has not been snoozed.
    amber = [r for r in records if r.get("state") == funnel.AMBER and r["handle"] not in quiet]
    dark = [r for r in records if r.get("state") == funnel.RED and r["handle"] not in quiet]
    unread = [r for r in records if r.get("state") == funnel.UNKNOWN]

    wasted = sum(r.get("followers") or 0 for r in dark + amber)
    lines = ["FUNNEL · " + time.strftime("%a %d %b"),
             "{} lit · {} unverified · {} dark".format(len(lit), len(amber), len(dark))]
    if unread:
        lines[-1] += " · {} unread".format(len(unread))
    lines.append("{:,} followers with no way through".format(wasted))

    lost = [e for e in events or [] if e.get("event") == "went_dark"]
    if lost:
        lines += ["", "LOST A LINK SINCE YESTERDAY"]
        for event in lost:
            lines.append("@{} — {} was there, gone now".format(
                event["handle"], event.get("lost") or "a link"))

    back = [e for e in events or [] if e.get("event") == "lit"]
    if back:
        lines += ["", "BACK UP"]
        for event in back:
            lines.append("@{} — {}".format(event["handle"], event.get("gained") or "linked"))

    if dark:
        lines += ["", "DARK, biggest audience first"]
        for record in sorted(dark, key=lambda r: -(r.get("followers") or 0))[:DARK_SHOWN]:
            lines.append("@{}  {:,}".format(record["handle"], record.get("followers") or 0))
        if len(dark) > DARK_SHOWN:
            lines.append("…{} more".format(len(dark) - DARK_SHOWN))

    if amber:
        lines += ["", "NEEDS ONE LOOK"]
        for record in sorted(amber, key=lambda r: -(r.get("followers") or 0))[:5]:
            why = record.get("bio_maybe") or "highlight or story may carry it"
            lines.append("@{} — {}".format(record["handle"], why))

    if quiet:
        lines += ["", "({} snoozed)".format(len(quiet))]
    return "\n".join(lines)


def keyboard(records, events, state=None, today: str = ""):
    """One row of digest-level buttons, then an Ask row per lost link.

    Only accounts that lost a link overnight get an ask button. A model who has
    been dark for a month does not need a nudge, she needs a decision, and a
    button makes that too easy to skip.

    **There is no snooze button on purpose.** The taps are answered by the bot
    on Railway and this digest is composed here on the Mac; the two share no
    disk, so a snooze recorded over there could never reach the message that
    names her. Snoozing is `bin/funnel snooze <handle>` instead, which writes
    the file this module actually reads.
    """
    rows = [[
        {"text": "👍 Got it", "callback_data": "{}:ack:{}".format(CB_PREFIX, today or time.strftime("%Y%m%d"))},
    ]]
    for event in (events or [])[:5]:
        if event.get("event") != "went_dark":
            continue
        handle = event["handle"][:40]
        rows.append([
            {"text": "📨 Ask @{}".format(handle), "callback_data": "{}:ask:{}".format(CB_PREFIX, handle)},
        ])
    return {"inline_keyboard": rows}


def deliver(text: str, markup=None, log=print) -> bool:
    """Send to the DM. Returns False and says why rather than raising."""
    token, chat = _token(), chat_id()
    if not token:
        log("not sent — no telegram_bot_token in secrets/alerts.json")
        return False
    if not chat:
        log("not sent — no DM chat id (set funnel_chat_id, FUNNEL_CHAT_ID or "
            "OWNER_CHAT_ID; a group id is refused on purpose)")
        return False
    payload = {"chat_id": chat, "text": text, "disable_web_page_preview": True}
    if markup:
        payload["reply_markup"] = markup
    request = urllib.request.Request(
        "https://api.telegram.org/bot{}/sendMessage".format(token),
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
            return json.loads(response.read()).get("ok") is True
    except Exception as error:  # the token never appears in what is logged
        log("not sent — Telegram said: {}".format(str(error)[:160]))
        return False


def daily(send: bool = False, log=print) -> int:
    """The morning message. Reads what the last daily pass wrote; sends nothing
    unless asked to."""
    root = config.DEFAULT_OUT_DIR
    records = funnel.latest(root)
    if not records:
        log("no funnel reading yet — run bin/scout daily")
        return 1
    state = load_state()
    events = funnel.transitions(funnel.previous(root), records)
    today = time.strftime("%Y-%m-%d")
    text = compose(records, events, state, today)
    markup = keyboard(records, events, state, today)

    if not send:
        log("--- would send to DM {} ---".format(chat_id() or "(unset)"))
        log(text)
        log("--- buttons: {} ---".format(
            " | ".join(b["text"] for row in markup["inline_keyboard"] for b in row)))
        return 0

    ok = deliver(text, markup, log=log)
    if ok:
        state["last_sent"] = today
        save_state(state)
        log("sent")
    return 0 if ok else 1


def snooze(handle: str, days: int = SNOOZE_DAYS, log=print) -> int:
    """Stop naming her in the digest for a while.

    This lives here rather than on a button because the buttons are answered by
    the bot on Railway and the digest is composed on this machine - a snooze
    recorded over there could never reach the message that names her.
    """
    handle = (handle or "").lstrip("@")
    if not handle:
        log("which handle?")
        return 1
    state = load_state()
    until = time.strftime("%Y-%m-%d", time.localtime(time.time() + days * 86400))
    state.setdefault("snooze", {})[handle] = until
    save_state(state)
    log("@{} will not be named until {}".format(handle, until))
    return 0


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="funnel-alerts", description=__doc__.splitlines()[0])
    parser.add_argument("--send", action="store_true",
                        help="actually deliver it (otherwise it only prints)")
    parser.add_argument("--snooze", metavar="HANDLE",
                        help="stop naming this account in the digest for {} days".format(SNOOZE_DAYS))
    parser.add_argument("--days", type=int, default=SNOOZE_DAYS,
                        help="how long a --snooze lasts")
    args = parser.parse_args(argv)
    if args.snooze:
        return snooze(args.snooze, args.days)
    return daily(send=args.send)


if __name__ == "__main__":
    raise SystemExit(main())
