"""The one browser every Instagram account on this Mac is driven through.

Scout's reader, the viewer, and both sign-in windows all launch through here,
so each burner is always seen as the same machine: the Google Chrome installed
on this Mac, one window size, one language, an ordinary Chrome user agent.

Why it matters (2026-09-25): Playwright's own headless Chromium announces
itself as "HeadlessChrome" in its user agent and its browser hints, and sets
`navigator.webdriver` — the first things a bot check reads. And a session signed
in on one browser and then used from a different-looking one is a flag of its
own, which is why the sign-in windows use this too.
"""
from __future__ import annotations

VIEWPORT = {"width": 1280, "height": 860}
LOCALE = "en-US"
ARGS = ["--disable-blink-features=AutomationControlled"]
# What an ordinary Chrome on a Mac sends, filled in with the real engine's
# major version so the claim and the engine agree.
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36")


def launch(play, *, headless: bool):
    """Installed Google Chrome (in Chrome's own new headless mode when
    headless), falling back to Playwright's full Chromium — never its
    stripped-down headless shell, whose browser hints still say headless."""
    try:
        return play.chromium.launch(channel="chrome", headless=headless, args=ARGS)
    except Exception:
        return play.chromium.launch(channel="chromium", headless=headless, args=ARGS)


def context_options(browser, **extra) -> dict:
    """Keyword arguments for `browser.new_context(...)`."""
    major = str(browser.version).split(".")[0]
    return {
        "viewport": VIEWPORT,
        "locale": LOCALE,
        "user_agent": USER_AGENT.format(major=major),
        **extra,
    }
