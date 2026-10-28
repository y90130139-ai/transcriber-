"""Write the refreshed data into the Red October page.

The page is edited rather than regenerated because most of it is written
analysis, not output: the verdict, the flags and the gameplan are arguments
someone has to stand behind, and regenerating them from a template would
quietly replace reasoning with filler. So this replaces the three data lines,
adds the live Instagram column, and corrects the handful of figures that are
written into the prose and have actually moved.
"""

from __future__ import annotations

import json
import os
import re
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
# The page this refresh starts from: normally the one published last time,
# kept beside this script. Set RO_SOURCE to the file an `Artifact read` saved
# if the board has been edited anywhere else since.
SRC = os.environ.get("RO_SOURCE") or os.path.join(SCRATCH, "board-source.html")
OUT = os.path.join(SCRATCH, "red-october.html")


def money(cents) -> str:
    return "${:,.0f}".format(round(cents / 100))


def read_at(iso) -> str:
    """The scan time as the rest of the page states times: Eastern, in words."""
    if not iso:
        return "the scan"
    from datetime import datetime, timedelta, timezone
    try:
        when = datetime.strptime(iso.replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S%z")
    except ValueError:
        return str(iso)
    et = when.astimezone(timezone(timedelta(hours=-4)))
    return et.strftime("%b %-d, %-I:%M %p ET")


def swap(text: str, old: str, new: str, what: str) -> str:
    """Replace exactly once.

    Each refresh starts from the page published last time, so a repair applied
    then is already in place. When `old` has gone and `new` is already there
    the edit is a no-op; anything else is a real mismatch and stops the run
    rather than publishing a half-patched board.
    """
    # Checked before the anchor, because an insert keeps its own anchor: the
    # liveCell block ends with the `function postCell` line it was placed
    # above, so matching the anchor again would add a second copy.
    if new in text:
        return text
    n = text.count(old)
    if n == 1:
        return text.replace(old, new)
    raise SystemExit("patch '{}' matched {} times, expected 1".format(what, n))


def swap_rx(text: str, pattern: str, new: str, what: str) -> str:
    """Replace a block that carries figures, so its own text changes daily."""
    if len(re.findall(pattern, text, re.S)) != 1:
        raise SystemExit("patch '{}' did not match once".format(what))
    return re.sub(pattern, lambda _: new, text, count=1, flags=re.S)


def main() -> None:
    html = open(SRC, encoding="utf8").read()
    # Strip the read wrapper: the file begins with the <cowritten-artifact-html>
    # envelope the read tool added, which is not part of the page.
    start = html.find("<!doctype html>")
    if start > 0:
        html = html[start:]
    end = html.rfind("</cowritten-artifact-html>")
    if end > 0:
        html = html[:end]
    html = html.rstrip()

    D = json.load(open(os.path.join(SCRATCH, "D-new.json")))
    IGR = json.load(open(os.path.join(SCRATCH, "igr-new.json")))
    ASKS = json.load(open(os.path.join(SCRATCH, "asks-new.json")))
    tally = json.load(open(os.path.join(SCRATCH, "ig-tally.json")))
    A = D["agency"]

    lines = html.split("\n")
    done = set()
    for i, line in enumerate(lines):
        if line.startswith("const D = {") and "D" not in done:
            lines[i] = "const D = " + json.dumps(D, separators=(",", ":")) + ";"
            done.add("D")
        elif line.startswith("const IGR = [") and "IGR" not in done:
            lines[i] = "const IGR = " + json.dumps(IGR, separators=(",", ":")) + ";"
            done.add("IGR")
        elif line.startswith("const ASKS = [") and "ASKS" not in done:
            lines[i] = "const ASKS = " + json.dumps(ASKS, separators=(",", ":")) + ";"
            done.add("ASKS")
        elif line.startswith("const IGLIVE = ") and "IGLIVE" not in done:
            lines[i] = "const IGLIVE = " + json.dumps(tally, separators=(",", ":")) + ";"
            done.add("IGLIVE")
    # IGLIVE belongs beside D, because the header's "read on the burner" line
    # uses it and a `const` read before its declaration is a ReferenceError
    # that kills the whole script. On a page that has not carried it before,
    # it is introduced here; afterwards the loop above just refreshes it.
    if "IGLIVE" not in done:
        for i, line in enumerate(lines):
            if line.startswith("const A = D.agency"):
                lines[i] = (line + "\nconst IGLIVE = "
                            + json.dumps(tally, separators=(",", ":")) + ";")
                done.add("IGLIVE")
                break
    html = "\n".join(lines)
    missing = {"D", "IGR", "ASKS", "IGLIVE"} - done
    if missing:
        raise SystemExit("data line not found: " + ", ".join(sorted(missing)))

    # ---- the live Instagram column -------------------------------------
    html = swap(
        html,
        '<th>Handle</th><th>Creator</th><th class="r">Week vs peak</th>'
        '<th class="r">Lost / wk</th>\n      <th>Our board</th>',
        '<th>Handle</th><th>Creator</th><th class="r">Week vs peak</th>'
        '<th class="r">Lost / wk</th>\n      <th>Instagram now</th><th>Our board</th>',
        "ig th",
    )
    html = swap(
        html,
        '      <td><span class="st ${sevCls(r.sev)}">${esc(r.state)}</span></td>',
        '      <td>${liveCell(r)}</td>\n'
        '      <td><span class="st ${sevCls(r.sev)}">${esc(r.state)}</span></td>',
        "ig td",
    )
    html = swap(html, "colspan=\"12\" style=\"padding:16px;color:var(--ink-3)\">Nothing matches that filter.",
                "colspan=\"13\" style=\"padding:16px;color:var(--ink-3)\">Nothing matches that filter.",
                "ig colspan")

    live_js = """
/* What Instagram served the burner on the morning of the scan.
   This is the only column on the page that is a reading rather than a record,
   so it never borrows a value from the board: an account the scan did not
   cover says so, because silence is not the same as "no link". */
const LIVEC = {green:'s0', amber:'s1', red:'s3', unknown:'s2'};
function liveCell(r){
  const L = r.live || {};
  if (!L.st) return '<span class="none">not scanned</span>';
  const host = L.url ? String(L.url).replace(/^https?:\\/\\//,'').replace(/\\/$/,'') : '';
  const bits = [];
  if (L.story) bits.push('story up');
  if (L.hl) bits.push(L.hl + ' highlight' + (L.hl===1?'':'s'));
  if (L.priv) bits.push('private');
  if (L.fol) bits.push((L.fol>=1e6?(L.fol/1e6).toFixed(1)+'M':Math.round(L.fol/1000)+'k') + ' followers');
  return `<span class="st ${LIVEC[L.st]||'s2'}">${esc(L.say)}</span>`
    + (L.moved ? ` <span class="st s1">${esc(L.moved)}</span>` : '')
    + (host ? `<span class="sub2"><a class="hl" href="${esc(L.url)}" target="_blank" rel="noopener">${esc(host.slice(0,38))}</a></span>` : '')
    + (bits.length ? `<span class="sub2">${esc(bits.join(' · '))}</span>` : '');
}
"""
    html = swap(html, "function postCell(r){", live_js.strip() + "\nfunction postCell(r){",
                "liveCell")

    # ---- a filter for what is dark right now ---------------------------
    html = swap(
        html,
        '    <button data-f="bad" aria-pressed="false">Link problem (45)</button>',
        '    <button data-f="darknow" aria-pressed="false">Dark on Instagram now'
        ' (<span id="ndark">0</span>)</button>\n'
        '    <button data-f="litnow" aria-pressed="false">Link live now'
        ' (<span id="nlit">0</span>)</button>\n'
        '    <button data-f="bad" aria-pressed="false">Our board flags a problem</button>',
        "ig filters",
    )
    html = swap(
        html,
        "    if (igF === 'bad' && r.sev < 2) return false;",
        "    if (igF === 'bad' && r.sev < 2) return false;\n"
        "    if (igF === 'darknow' && !(r.live && ['red','amber'].includes(r.live.st))) return false;\n"
        "    if (igF === 'litnow' && !(r.live && r.live.st === 'green')) return false;",
        "ig filter logic",
    )

    # ---- the progress strip leads with the reading ---------------------
    html = swap(
        html,
        "  document.getElementById('igprog').innerHTML =\n"
        "     `<div><span class=\"k\">Checked</span><b>${done} / ${tot}</b>"
        "<i>${shown} shown on this filter</i></div>`",
        "  const dk = IGR.filter(r => r.live && ['red','amber'].includes(r.live.st)).length;\n"
        "  const lt = IGR.filter(r => r.live && r.live.st === 'green').length;\n"
        "  const nd = document.getElementById('ndark'); if (nd) nd.textContent = dk;\n"
        "  const nl = document.getElementById('nlit'); if (nl) nl.textContent = lt;\n"
        "  document.getElementById('igprog').innerHTML =\n"
        "     `<div><span class=\"k\">Link live on Instagram now</span>"
        "<b class=\"${lt?'up':'down'}\">${lt} / ${IGLIVE.scanned}</b>"
        "<i>read on the burner, not recorded by hand</i></div>`\n"
        "   + `<div><span class=\"k\">No way through right now</span>"
        "<b class=\"${dk?'down':''}\">${dk}</b>"
        "<i>${(IGLIVE.dark_fol||0).toLocaleString('en-US')} followers behind them</i></div>`\n"
        "   + `<div><span class=\"k\">Checked by you</span><b>${done} / ${tot}</b>"
        "<i>${shown} shown on this filter</i></div>`",
        "igprog",
    )

    # ---- the section's own words --------------------------------------
    html = swap(
        html,
        "Tap a handle to open it in a new tab, then mark what you see.",
        "<b>The <i>Instagram now</i> column is what the burner actually saw this"
        " morning</b>, bio link and all — so the list is no longer a record of"
        " what someone remembered placing. Tap a handle to open it, then mark what"
        " you see.",
        "ig lede",
    )

    cav = ("<b>What the board says vs what Instagram shows.</b> The <i>our board</i>"
           " column is what the team recorded on Oct 20. The <i>Instagram now</i>"
           " column is a reading taken on the burner at <b>{at}</b>, and where the"
           " two disagree it is almost always the record that is stale."
           " Of <b>{scanned} accounts read, {green} have a link live, {amber} carry"
           " something unverified and {red} have no way through at all</b> —"
           " <b>{darkfol:,} followers</b> sitting behind an account a fan cannot buy"
           " from. {storyline} <b>29 accounts are ours to place and 37 are hers</b>"
           " — the <i>places</i> column decides whether a fix is an Iona task or"
           " a creator ask.")
    stories = tally.get("stories", 0)
    storyline = ("Not one of them had a live story when it was read."
                 if stories == 0 else
                 "{} had a live story up.".format(stories))

    # One account can dominate a follower total, and this one does, so the
    # figure says so itself rather than letting the headline stand alone.
    top = tally.get("top_dark") or {}
    darkfol = tally.get("dark_fol") or 0
    if top.get("fol") and darkfol and top["fol"] / darkfol > 0.2:
        storyline += (" <b>{:,} of those followers are one account, {}</b>,"
                      " which carries its own name and domain and is recorded"
                      " here as a second account of another creator —"
                      " worth confirming before the headline figure is quoted;"
                      " without it the dark audience is {:,}.").format(
            top["fol"], top["h"], darkfol - top["fol"])
    html = swap_rx(
        html,
        r"<b>What the board says vs what (?:you see|Instagram shows)\.</b>"
        r".*?Iona task or a creator ask\.",
        cav.format(at=read_at(tally.get("at")), scanned=tally["scanned"],
                   green=tally["green"], amber=tally["amber"], red=tally["red"],
                   darkfol=tally.get("dark_fol") or 0, storyline=storyline),
        "ig caveat",
    )

    # ---- the Instagram table waited on the database to paint -----------
    # Both tables were only ever drawn from the igreview snapshot callback, so
    # if the db capability is slow or unavailable the section renders as bare
    # headers. The rows do not need the marks - the marks decorate rows that
    # already exist - so they are drawn once up front and redrawn when the
    # snapshot lands.
    html = swap(
        html,
        "(async () => {\n  const db = await claude.use('db');",
        "try { renderIG(); renderCT(); }   // paint from the data; marks arrive after\n"
        "catch (e) { const n = document.getElementById('igsaved');\n"
        "  if (n) n.textContent = 'The Instagram list failed to draw: '\n"
        "    + (e && (e.stack || e.message) || e); }\n\n"
        "(async () => {\n  const db = await claude.use('db');",
        "initial ig render",
    )

    # ---- money is stored in cents and was printed as dollars -----------
    # `fm` never divided by 100 while almost every caller passed cents, so the
    # score bar read "$720,068/day" for a roster taking about $7,200. Three
    # call sites had been compensating by hand, which is why the contact table
    # looked right next to a bar that did not. The formatter now owns the
    # conversion and those three stop dividing.
    html = swap(
        html,
        "const fm = n => (n < 0 ? '-' : '') + '$' + "
        "Math.abs(Math.round(n)).toLocaleString('en-US');",
        "/* Every money figure on this page is cents. One place converts. */\n"
        "const fm = n => (n < 0 ? '-' : '') + '$' + "
        "Math.abs(Math.round(n / 100)).toLocaleString('en-US');",
        "fm cents",
    )
    html = swap(
        html,
        "const sg = n => (n >= 0 ? '+' : '-') + '$' + "
        "Math.abs(Math.round(n)).toLocaleString('en-US');",
        "const sg = n => (n >= 0 ? '+' : '-') + '$' + "
        "Math.abs(Math.round(n / 100)).toLocaleString('en-US');",
        "sg cents",
    )
    html = swap(html, "fm(r.sepf/100)", "fm(r.sepf)", "igr sepf")
    html = swap(html, "fm(a.sepf/100)", "fm(a.sepf)", "asks sepf")
    # idleD is counted in whole dollars, so it is the one value that has to be
    # scaled up to meet a formatter that now expects cents.
    html = swap(html, "fm(c.idleD)", "fm(c.idleD * 100)", "idleD")

    # ---- a stylesheet that was never opened ----------------------------
    # The page carries two CSS blocks and only the first has an opening tag.
    # Everything from the war-room tokens to the gameplan controls - about 120
    # lines - therefore renders as visible text at the top of the body and
    # styles nothing. Pre-existing, and the reason the board looks like a wall
    # of CSS.
    html = swap(
        html,
        "</style>\n\n/* tokens the war-room blocks need */",
        "</style>\n\n<style>\n/* tokens the war-room blocks need */",
        "reopen the second stylesheet",
    )

    # ---- a strip with no stylesheet of its own -------------------------
    # The five-figure strip under the headline uses the same markup as .band
    # but no rule ever matched `.strip`, so label, number and note ran
    # together on one line. It borrows .band's grid rather than inventing a
    # second look for the same thing.
    html = swap(
        html,
        ".band{display:grid;",
        ".strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));"
        "gap:1px;background:var(--line);border:1px solid var(--line);margin-top:20px}\n"
        ".strip>div{background:var(--surface);padding:13px 15px;min-width:0}\n"
        ".strip b{display:block;font-family:var(--mono);font-size:22px;"
        "font-weight:600;margin-top:3px}\n"
        ".strip i{font-style:normal;font-size:12.5px;color:var(--ink-2);display:block}\n"
        ".band{display:grid;",
        "strip css",
    )

    # ---- the week-vs-peak band is now a rolling seven days -------------
    # `now` is recomputed as her last seven settled days, so the label has to
    # stop claiming it is the week of Oct 19.
    html = swap(
        html,
        "<i>${fm(wkP)} in the week of Sep 14 to ${fm(wkN)} in the week of Oct 19</i>",
        "<i>${fm(wkP)} in the peak week of Sep 14 to ${fm(wkN)} in the last 7 days"
        " (Oct ${A.od-6}–${A.od})</i>",
        "tband week label",
    )

    # ---- say where each half of the page came from ---------------------
    html = swap(
        html,
        "$('#fresh').textContent = `Infloww synced ${nyFull} · data through Oct "
        "${A.od} · IG link board read at the same time`;",
        "$('#fresh').textContent = `Infloww synced ${nyFull} · money through Oct "
        "${A.od} · Instagram read on the burner, ${IGLIVE.scanned} accounts"
        "${IGLIVE.at ? ' at ' + new Date(IGLIVE.at).toLocaleString('en-US',"
        "{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',"
        "minute:'2-digit'}) + ' ET' : ''}`;",
        "fresh line",
    )

    # ---- a due date that has passed should say so ----------------------
    # The gameplan was written with dates in it and is now being read after
    # some of them. An item that reads "Wed Oct 28" on the 30th is worse than
    # no date at all, so the row says how late it is.
    html = swap(
        html,
        '    <td class="due">${esc(r.due)}</td>',
        '    <td class="due">${esc(r.due)}${lateBy(r.due)}</td>',
        "gp due cell",
    )
    late_js = """
/* "Oct 27" in a due string, against the last day the data covers. The board is
   read the morning after that day, so anything due on or before it is late. */
function lateBy(due){
  const m = /Oct\\s+(\\d{1,2})/.exec(String(due||''));
  if (!m) return '';
  const over = (A.od + 1) - Number(m[1]);
  if (over <= 0) return '';
  return `<br><span style="color:var(--down);font-size:11px">${over} day${over===1?'':'s'} late</span>`;
}
"""
    html = swap(html, "let oF = 'all';", late_js.strip() + "\nlet oF = 'all';",
                "lateBy")

    # ---- figures written into the prose that have moved ----------------
    proj = A["oct"] + A["pace"] * A["left"]
    html = swap_rx(
        html,
        r'<div><span class="k">Oct 31 projection</span><b class="down">\$[\d,]+</b>'
        r'<i>September closed \$[\d,]+ · \d+ of \d+ in the red, goal \d+</i></div>',
        '<div><span class="k">Oct 31 projection</span><b class="down">{}</b>'
        '<i>September closed {} · {} of {} in the red, goal {}</i></div>'.format(
            money(proj), money(A["sepf"]), A["proj"], A["active"], A["goal"]),
        "header strip projection",
    )

    open(OUT, "w", encoding="utf8").write(html + "\n")
    print("wrote", OUT, "({:,} bytes)".format(os.path.getsize(OUT)))
    print("Oct 31 projection", money(proj), "· September", money(A["sepf"]))
    print("red", A["proj"], "of", A["active"], "· days left", A["left"])
    print("IG live:", json.dumps({k: v for k, v in tally.items() if k != "moved"}))


if __name__ == "__main__":
    main()
