"""Read the link inside a highlight, for the accounts the daily pass cannot judge.

The daily reading can see whether a bio link exists and whether a highlight
exists. It cannot see what is *in* the highlight, and for a model whose whole
funnel is a highlight that is the only question that matters.

Two things make this a weekly pass on a short list rather than a nightly job:

**It costs a view.** Instagram gates both stories and highlights behind
*"<account> will be able to see that you viewed their story"*. There is no way
to read one without the creator seeing that the burner watched it. Sixty of
those a day would be strange behaviour from an account that follows nobody;
a dozen a week is not.

**It cannot be scripted.** Verified 2026-10-27: inside the viewer there are no
anchors, no link text and no media elements the DOM will admit to — a link
sticker is painted into the frame. So this screenshots each frame and runs the
repo's own OCR binary over it, the same Vision-framework tool `visual.py` uses
for post text. Nothing leaves the Mac.

    ./bin/funnel-deep            # the amber queue, printing what it finds
    ./bin/funnel-deep --apply    # and write the result back into the reading
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path

from . import config, funnel

MAX_FRAMES = 8
FRAME_WAIT_MS = 1400
GATE_WORDS = ("View story", "View as")
# A URL as OCR tends to hand it back: no scheme, sometimes a stray space.
URL_RE = re.compile(r"\b([a-z0-9][a-z0-9-]{1,40}(?:\.[a-z]{2,10}){1,3})(/[^\s]{0,60})?", re.I)


def _ocr(paths):
    """path -> text, using the repo's local OCR binary."""
    if not paths or not config.OCR_TEXT.exists():
        return {}
    try:
        result = subprocess.run([str(config.OCR_TEXT), *[str(p) for p in paths]],
                                capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return {}
    if result.returncode != 0:
        return {}
    found = {}
    for line in result.stdout.splitlines():
        path, _, text = line.partition("\t")
        if text.strip() and text not in ("ERR_LOAD", "ERR_VISION"):
            found[path] = text.strip()
    return found


def links_in(text: str, extra_hosts=()):
    """Every host-looking token OCR saw, kept only when it could be a funnel.

    OCR on a photograph is noisy — it reads jewellery as text — so a token is
    only believed when its host is one we already know sells, or when the
    account's own confirmed host list vouches for it.
    """
    out = []
    for match in URL_RE.finditer(text or ""):
        host = match.group(1).lower()
        if host in funnel.FUNNEL_HOSTS or host in {h.lower() for h in extra_hosts}:
            out.append(host + (match.group(2) or ""))
    return sorted(set(out))


def highlights_on(page, handle: str):
    """(id, title) for each highlight cover on the profile. No view is spent:
    the covers are ordinary links on the page."""
    page.goto("https://www.instagram.com/{}/".format(handle), wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    found = page.evaluate(
        """() => [...document.querySelectorAll('a[href*="/stories/highlights/"]')]
                 .map(a => ({href: a.getAttribute('href'), title: (a.innerText||'').trim()}))"""
    )
    out = []
    for item in found or []:
        parts = [p for p in (item.get("href") or "").split("/") if p]
        if parts and parts[-1].isdigit():
            out.append((parts[-1], (item.get("title") or "")[:40]))
    return out


def read_highlight(page, highlight_id: str, shots_dir: Path, extra_hosts=()):
    """Open one highlight and OCR its frames. **This spends a view.**"""
    page.goto("https://www.instagram.com/stories/highlights/{}/".format(highlight_id),
              wait_until="domcontentloaded")
    page.wait_for_timeout(2500)

    # The consent gate. Clicking it is the moment the creator can see the view.
    for word in GATE_WORDS:
        try:
            button = page.get_by_text(word, exact=False).first
            if button and button.is_visible():
                button.click()
                page.wait_for_timeout(FRAME_WAIT_MS)
                break
        except Exception:
            continue

    shots_dir.mkdir(parents=True, exist_ok=True)
    shots = []
    for index in range(MAX_FRAMES):
        shot = shots_dir / "{}-{}.png".format(highlight_id, index)
        try:
            page.screenshot(path=str(shot))
        except Exception:
            break
        shots.append(shot)
        try:
            page.keyboard.press("ArrowRight")
        except Exception:
            break
        page.wait_for_timeout(FRAME_WAIT_MS)
        if "/stories/" not in page.url:
            break  # the highlight ran out and Instagram moved on

    text = _ocr(shots)
    links, seen = [], []
    for shot in shots:
        body = text.get(str(shot), "")
        if body:
            seen.append(body[:160])
        links += links_in(body, extra_hosts)
    return {"highlight": highlight_id, "frames": len(shots),
            "links": sorted(set(links)), "ocr": seen}


def run(limit: int = 12, apply: bool = False, log=print) -> int:
    """Walk the amber queue, worst first, and look inside what it finds."""
    from . import scout, scout_browser

    root = config.DEFAULT_OUT_DIR
    records = funnel.latest(root)
    if not records:
        log("no funnel reading yet — run bin/funnel scan")
        return 1
    jar = scout._active_jar()
    if jar is None:
        log("the deep pass needs the burner session — see docs/SCOUT-SETUP.md")
        return 1

    known = funnel.confirmed_hosts(root)
    queue = [r for r in records if r.get("state") == funnel.AMBER]
    queue.sort(key=lambda r: -(r.get("followers") or 0))
    queue = queue[:limit]
    if not queue:
        log("nothing amber — nothing to look inside")
        return 0

    day = time.strftime("%Y-%m-%d")
    shots_root = root / "funnel" / "deep" / day
    log("{} account(s) to look at. Each highlight opened costs a view the "
        "creator can see.".format(len(queue)))

    results = {}
    reader = scout_browser.Reader(jar)
    page = reader.new_page()
    try:
        for record in queue:
            handle = record["handle"]
            try:
                covers = highlights_on(page, handle)
            except Exception as error:
                log("  ! @{}: {}".format(handle, str(error)[:110]))
                continue
            if not covers:
                log("  @{}: no highlights".format(handle))
                results[handle] = {"handle": handle, "highlights": [], "links": []}
                continue
            found, reads = [], []
            for highlight_id, title in covers[:3]:
                reading = read_highlight(page, highlight_id, shots_root / handle, known)
                reading["title"] = title
                reads.append(reading)
                found += reading["links"]
                if found:
                    break  # one working link is the whole question
            results[handle] = {"handle": handle, "highlights": reads, "links": sorted(set(found))}
            log("  @{}: {}".format(handle, ", ".join(found) if found
                                   else "no link found in {} highlight(s)".format(len(reads))))
    finally:
        try:
            page.close()
        finally:
            reader.close()

    out = root / "funnel" / "deep" / (day + ".json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(list(results.values()), indent=1), encoding="utf8")
    log("written to {}".format(out))

    if apply:
        changed = 0
        for record in records:
            result = results.get(record.get("handle"))
            if not result:
                continue
            if result["links"]:
                record["state"] = funnel.GREEN
                record["highlight_funnel"] = result["links"][0]
                changed += 1
            elif result.get("highlights") is not None and not record.get("bio_maybe"):
                # Looked inside and there was nothing. That is a real answer.
                record["state"] = funnel.RED
                record["checked_highlights"] = True
                changed += 1
        funnel.store(records, root)
        log("{} account(s) updated in the reading".format(changed))
    return 0


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="funnel-deep", description=__doc__.splitlines()[0])
    parser.add_argument("--limit", type=int, default=12,
                        help="how many accounts to look at (default 12)")
    parser.add_argument("--apply", action="store_true",
                        help="write what was found back into the reading")
    args = parser.parse_args(argv)
    return run(limit=args.limit, apply=args.apply)


if __name__ == "__main__":
    raise SystemExit(main())
