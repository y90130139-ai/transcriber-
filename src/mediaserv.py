"""Serve the videos that never left this Mac.

The hosted app holds transcripts and metadata; the actual MP4s stay on disk
here, which is why the library costs nothing to run. This is the small HTTP
server that hands them out, fronted by a Cloudflare tunnel so the phone can
reach it. Every URL is signed with the worker secret and expires, so the tunnel
being publicly resolvable does not make the videos publicly readable.

Range requests are supported because iOS Safari refuses to play a video from a
server that does not honour them.
"""
from __future__ import annotations

import base64
import hmac
import json
import mimetypes
import re
import threading
import time
import zipfile
from hashlib import sha256
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, urlparse

from . import media

# A signature is good for this long. Long enough to watch a video and to start a
# bulk download; short enough that a copied URL is not a permanent handout. The
# app mints the expiry, so this end enforces the ceiling rather than trusting it.
LINK_TTL_SEC = 6 * 60 * 60
CLOCK_SLACK_SEC = 120
BUNDLE_MAX_ITEMS = 60
STREAM_CHUNK = 1 << 18
SAFE_FOLDER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

# macOS does not know this one, and without it the browser drops the track.
mimetypes.add_type("text/vtt", ".vtt")

POSTER_NAMES = ("thumb.jpg", "source.jpg", "source.jpeg", "source.png", "source.webp")


def sign(secret: str, scope: str, expires: int) -> str:
    """The signature the app puts on a URL and this server checks."""
    digest = hmac.new(secret.encode(), f"{scope}:{expires}".encode(), sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _valid(secret: str, scope: str, params: dict[str, list[str]]) -> bool:
    expires = params.get("exp", [""])[0]
    presented = params.get("sig", [""])[0]
    if not expires.isdigit() or not presented:
        return False
    now = time.time()
    if int(expires) < now:
        return False
    if int(expires) - now > LINK_TTL_SEC + CLOCK_SLACK_SEC:
        return False
    return hmac.compare_digest(presented, sign(secret, scope, int(expires)))


def _video_in(folder: Path) -> Path | None:
    for name in ("source.mp4", "source.mov", "source.m4v", "source.webm"):
        candidate = folder / name
        if candidate.exists():
            return candidate
    return next(
        (p for p in sorted(folder.iterdir()) if p.suffix.lower() in media.VIDEO_SUFFIXES),
        None,
    )


def _poster_in(folder: Path) -> Path | None:
    for name in POSTER_NAMES:
        candidate = folder / name
        if candidate.exists():
            return candidate
    return None


def _parse_range(header: str, size: int) -> tuple[int, int] | None:
    """`bytes=start-end` -> inclusive byte offsets, or None if unusable."""
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
    if not match:
        return None
    raw_start, raw_end = match.groups()
    if raw_start:
        start = int(raw_start)
        end = int(raw_end) if raw_end else size - 1
    elif raw_end:  # a suffix range: the last N bytes
        start, end = max(0, size - int(raw_end)), size - 1
    else:
        return None
    if start >= size or start > end:
        return None
    return start, min(end, size - 1)


class _Handler(BaseHTTPRequestHandler):
    server_version = "transcriber-media"
    protocol_version = "HTTP/1.1"

    # Bound by the server factory below.
    out_dir: Path
    secret: str

    def log_message(self, *_args) -> None:  # noqa: D102 - the worker owns the console
        pass

    # ---------------------------------------------------------------- helpers

    def _folder(self, name: str) -> Path | None:
        if not SAFE_FOLDER.fullmatch(name):
            return None
        path = (self.out_dir / name).resolve()
        # Resolve then re-check: a symlink inside out/ must not become an escape.
        if path.parent != self.out_dir.resolve() or not path.is_dir():
            return None
        return path

    def _deny(self, status: HTTPStatus = HTTPStatus.FORBIDDEN) -> None:
        body = json.dumps({"error": status.phrase.lower()}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, *, download_as: str | None = None) -> None:
        size = path.stat().st_size
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        span = _parse_range(self.headers.get("Range", ""), size) if self.headers.get("Range") else None

        if span:
            start, end = span
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            length = end - start + 1
        else:
            start, length = 0, size
            self.send_response(HTTPStatus.OK)

        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        # The signature already carries the expiry; caching inside it is free.
        self.send_header("Cache-Control", "private, max-age=3600")
        if download_as:
            self.send_header("Content-Disposition", f'attachment; filename="{download_as}"')
        self.end_headers()

        if self.command == "HEAD":
            return
        with path.open("rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining > 0:
                chunk = handle.read(min(STREAM_CHUNK, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    # ------------------------------------------------------------------ route

    def do_HEAD(self) -> None:  # noqa: N802 - stdlib naming
        self.do_GET()

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        parts = [p for p in parsed.path.split("/") if p]

        # An unauthenticated liveness probe, so the tunnel can be checked without
        # handing out a signature.
        if parts == ["health"]:
            body = b'{"ok":true}'
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return

        if len(parts) == 3 and parts[0] == "v" and parts[2] in ("video", "poster", "download", "captions"):
            folder_name, what = parts[1], parts[2]
            if not _valid(self.secret, f"v/{folder_name}", params):
                return self._deny()
            folder = self._folder(folder_name)
            if folder is None:
                return self._deny(HTTPStatus.NOT_FOUND)

            if what == "poster":
                path = _poster_in(folder)
            elif what == "captions":
                # The pipeline already wrote WebVTT; serving it means the player
                # has real captions rather than a video nobody can follow muted.
                captions = folder / "transcript.vtt"
                path = captions if captions.exists() else None
            else:
                path = _video_in(folder)
            if path is None:
                return self._deny(HTTPStatus.NOT_FOUND)
            return self._send_file(
                path,
                download_as=f"{folder_name}{path.suffix}" if what == "download" else None,
            )

        if parts == ["bundle"]:
            names = [n for n in (params.get("f", [""])[0]).split(",") if n]
            if not names or len(names) > BUNDLE_MAX_ITEMS:
                return self._deny(HTTPStatus.BAD_REQUEST)
            if not _valid(self.secret, f"bundle/{','.join(names)}", params):
                return self._deny()
            return self._send_bundle(names)

        self._deny(HTTPStatus.NOT_FOUND)

    def _send_bundle(self, names: list[str]) -> None:
        """Zip the selected videos so a multi-select is one download, not twenty.

        The archive is built on disk first: the videos are already compressed, so
        it is a stored-mode copy, and knowing the final size lets the browser
        show a real progress bar instead of an open-ended spinner.
        """
        with TemporaryDirectory() as scratch:
            archive = Path(scratch) / "videos.zip"
            written = 0
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_STORED) as bundle:
                for name in names:
                    folder = self._folder(name)
                    if folder is None:
                        continue
                    video = _video_in(folder)
                    if video is None:
                        continue
                    bundle.write(video, arcname=f"{name}{video.suffix}")
                    written += 1
            if written == 0:
                return self._deny(HTTPStatus.NOT_FOUND)
            stamp = time.strftime("%Y-%m-%d")
            self._send_file(archive, download_as=f"library-{stamp}-{written}-clips.zip")


def start(out_dir: Path, secret: str, *, port: int = 0) -> tuple[ThreadingHTTPServer, int]:
    """Run the media server on a background thread; returns it and its port.

    A taken port falls back to whatever is free rather than killing the worker:
    the tunnel is pointed at whichever port this returns, so the number only has
    to be stable within one run.
    """
    handler = type("BoundHandler", (_Handler,), {"out_dir": out_dir.resolve(), "secret": secret})
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    except OSError:
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]
