"""Publish the local media server through Cloudflare, for free.

Two modes. If config.json names a `media_hostname`, a proper named tunnel is
run and the hostname never changes — that is the arrangement worth having, and
it is what Cloudflare Access sits in front of. Without one, a quick tunnel is
opened instead: no account, no DNS, no cost, but the hostname is reissued every
time cloudflared restarts. That is survivable because the worker reports its
current media URL on every heartbeat, so the app always signs URLs against
whatever hostname is live right now.
"""
from __future__ import annotations

import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import config

QUICK_URL = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
STARTUP_TIMEOUT_SEC = 45.0
RESTART_DELAY_SEC = 5.0

# Cloudflare can withdraw a quick tunnel's hostname without cloudflared exiting.
# Observed 2026-09-06: the process had been up since Friday, the worker was
# heartbeating happily every few seconds, and the hostname it kept reporting had
# been NXDOMAIN for hours — so the app went on signing correct links to a server
# that no longer existed, and every download failed in the browser with "can't
# find the server". `_watch` only re-reads the hostname after the process dies,
# so nothing on the Mac could ever notice. This is the check that notices.
HEALTH_PATH = "/health"
HEALTH_INTERVAL_SEC = 120.0
HEALTH_TIMEOUT_SEC = 10.0
# Two in a row, so one dropped request on a home connection does not tear down a
# working tunnel. At a two-minute interval that is a four-minute worst case.
HEALTH_FAILURES = 2


class Tunnel:
    """A cloudflared process kept alive, whose public URL can be read at any time."""

    def __init__(self, port: int, *, hostname: str | None = None, tunnel_name: str | None = None):
        self.port = port
        self.hostname = hostname
        self.tunnel_name = tunnel_name
        self._url: str | None = f"https://{hostname}" if hostname else None
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        self._stop = threading.Event()

    @property
    def url(self) -> str | None:
        with self._lock:
            return self._url

    def _command(self) -> list[str]:
        binary = str(config.CLOUDFLARED)
        target = f"http://127.0.0.1:{self.port}"
        if self.tunnel_name:
            return [binary, "tunnel", "--no-autoupdate", "run", "--url", target, self.tunnel_name]
        return [binary, "tunnel", "--no-autoupdate", "--url", target]

    def _spawn(self) -> subprocess.Popen[str]:
        return subprocess.Popen(
            self._command(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

    def _watch(self) -> None:
        """Keep one cloudflared alive, re-reading the quick URL after each restart."""
        while not self._stop.is_set():
            # A named tunnel's hostname is fixed, so a restart restores the same
            # URL. Without this the health check below could clear it once and
            # nothing would ever put it back.
            if self.hostname:
                with self._lock:
                    self._url = f"https://{self.hostname}"
            try:
                process = self._spawn()
            except OSError as exc:
                print(f"  tunnel: cannot start cloudflared ({exc})")
                return
            self._process = process
            deadline = time.time() + STARTUP_TIMEOUT_SEC
            found = self.hostname is not None

            # cloudflared prints its banner, including the quick-tunnel hostname,
            # on stderr. Draining it also keeps the pipe from filling up.
            for line in process.stderr or ():
                if self._stop.is_set():
                    break
                if not found:
                    match = QUICK_URL.search(line)
                    if match:
                        with self._lock:
                            self._url = match.group(0)
                        found = True
                        print(f"  tunnel: videos reachable at {match.group(0)}")
                    elif time.time() > deadline:
                        print("  tunnel: no hostname after 45s — carrying on without video")
                        deadline = float("inf")

            process.wait()
            if self._stop.is_set():
                return
            if not self.hostname:
                with self._lock:
                    self._url = None
            print("  tunnel: cloudflared exited — restarting")
            time.sleep(RESTART_DELAY_SEC)

    def _reachable(self) -> bool:
        """Can the outside world actually get to the media server right now?

        Deliberately over the public URL rather than over 127.0.0.1: the thing
        that breaks is the tunnel, and a local probe would have said everything
        was fine throughout the outage. A dead hostname fails here at DNS.
        """
        url = self.url
        if not url:
            return True  # nothing to check; `_watch` owns getting one
        try:
            request = urllib.request.Request(f"{url}{HEALTH_PATH}", method="GET")
            with urllib.request.urlopen(request, timeout=HEALTH_TIMEOUT_SEC) as response:
                return 200 <= response.status < 400
        except (urllib.error.URLError, OSError, ValueError):
            return False

    def _monitor(self) -> None:
        """Tear down a tunnel that is up but unreachable, so a fresh one is issued.

        Clearing `_url` first is what makes the app safe in the gap: the worker
        reports it on every heartbeat, and `/api/worker/ping` overwrites rather
        than coalesces precisely so a null means "no video right now". Until this
        existed nothing ever set it to null, so that safeguard never once fired.
        """
        failures = 0
        while not self._stop.wait(HEALTH_INTERVAL_SEC):
            if self._reachable():
                failures = 0
                continue
            failures += 1
            if failures < HEALTH_FAILURES:
                continue
            failures = 0
            print("  tunnel: hostname unreachable — restarting cloudflared")
            with self._lock:
                self._url = None
            process = self._process
            if process and process.poll() is None:
                process.terminate()   # `_watch` respawns and re-reads the hostname

    def start(self) -> None:
        if not Path(config.CLOUDFLARED).exists():
            print("  tunnel: cloudflared missing — run ./setup.sh to fetch it")
            return
        threading.Thread(target=self._watch, daemon=True).start()
        threading.Thread(target=self._monitor, daemon=True).start()

    def wait_for_url(self, timeout: float = STARTUP_TIMEOUT_SEC) -> str | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.url:
                return self.url
            time.sleep(0.5)
        return None

    def stop(self) -> None:
        self._stop.set()
        process = self._process
        if process and process.poll() is None:
            process.terminate()
