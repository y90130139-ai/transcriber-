"""Turn an input (Instagram/TikTok URL or a local video file) into video + 16k audio."""
from __future__ import annotations

import json
import shutil
import urllib.request
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from . import config
from .util import run, slugify

# Share links carry tracking junk that makes the same post look like two posts.
TRACKING_PARAMS = frozenset(
    {"igsi", "igshid", "si", "fbclid", "utm_source", "utm_medium",
     "utm_campaign", "utm_content", "utm_term"}
)

VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".gif"}
AUDIO_SUFFIXES = {".m4a", ".mp3", ".wav", ".aac", ".flac", ".ogg", ".opus"}
MEDIA_SUFFIXES = VIDEO_SUFFIXES | AUDIO_SUFFIXES
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass(frozen=True)
class Source:
    """A resolved piece of media plus whatever the platform told us about it."""

    media_path: Path
    meta: dict

    @property
    def slug(self) -> str:
        author = slugify(self.meta.get("author") or "", max_len=24)
        title = slugify(self.meta.get("title") or self.media_path.stem, max_len=40)
        parts = [p for p in (self.meta.get("platform"), author, title) if p]
        return "-".join(parts)[:80]


def is_url(value: str) -> bool:
    return value.startswith(("http://", "https://"))


def normalize_url(url: str) -> str:
    """Drop tracking parameters so share links dedupe against clean ones."""
    parts = urlsplit(url)
    kept = [(k, v) for k, v in parse_qsl(parts.query) if k.lower() not in TRACKING_PARAMS]
    return urlunsplit(parts._replace(query=urlencode(kept)))


def platform_of(url: str) -> str:
    lowered = url.lower()
    if "instagram." in lowered:
        return "instagram"
    if "tiktok." in lowered:
        return "tiktok"
    if "youtube." in lowered or "youtu.be" in lowered:
        return "youtube"
    return "web"


# yt-dlp's browser-cookie reader can block forever when the browser holds a
# lock on its cookie store, so every cookie-bearing attempt is time-boxed.
COOKIE_TIMEOUT_SEC = 45.0
NO_COOKIE_TIMEOUT_SEC = 180.0
# Instagram's CDN serves these files to anyone, including datacenters, and asks
# for no session — it is only the site that gates.
DIRECT_TIMEOUT_SEC = 120.0
DIRECT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
)

# Errors that mean "this post needs a session", as opposed to a dead link.
_LOGIN_HINTS = (
    "login required", "log in", "sign in", "rate-limit", "restricted",
    "private", "not available", "empty media response", "requested content",
    # Instagram's audience-gate wording. "not available" does not catch it:
    # the message contracts to "isn't available", and matching is substring.
    # These posts download fine with a session, so failing to retry here meant
    # giving up on a reel that was never actually out of reach.
    "isn't available", "available to everyone", "certain audiences",
    "age-restricted", "not be appropriate",
)


def _cookie_args(user_config: dict) -> list[str]:
    """Resolve the cookie flag, preferring an exported file over the browser.

    `--cookies-from-browser chrome` needs Keychain access and blocks on the
    lock Chrome holds over its cookie store while running, so it hangs under
    the launchd worker. An exported cookies.txt has neither problem. A path
    that does not exist is ignored, so gated posts report "login needed"
    rather than a yt-dlp file error.
    """
    cookie_file = user_config.get("cookies_file")
    if cookie_file and Path(cookie_file).expanduser().is_file():
        return ["--cookies", str(Path(cookie_file).expanduser())]
    browser = user_config.get("cookies_from_browser")
    if browser:
        return ["--cookies-from-browser", browser]
    return []


def _needs_login(message: str) -> bool:
    lowered = message.lower()
    return any(hint in lowered for hint in _LOGIN_HINTS)


# yt-dlp's wording when a post simply has no video in it. Cookies cannot help
# with this — an image post stays an image post however you are logged in — so
# it must not be mistaken for a login wall and must not be retried forever.
_NO_VIDEO_HINTS = (
    "there is no video in this post",
    "no video formats found",
    "no video could be found in this post",
)


def _has_no_video(message: str) -> bool:
    lowered = message.lower()
    return any(hint in lowered for hint in _NO_VIDEO_HINTS)


def _media_in(workdir: Path) -> Path | None:
    """The video or audio yt-dlp actually landed, if any."""
    return next(
        (p for p in sorted(workdir.iterdir())
         if p.suffix.lower() in MEDIA_SUFFIXES and not p.name.endswith(".info.json")),
        None,
    )


def _pick_handle(info: dict) -> str | None:
    """Find the @handle, which lives in a different field on every platform.

    TikTok puts it in `uploader` ('nasa') and the display name in `channel`;
    Instagram does the reverse and its `uploader_id` is a bare numeric id. So
    prefer whichever candidate actually looks like a handle.

    On Instagram `channel` goes first. A one-word display name ("Amelia",
    "DANIELLE🖤") has no space and is not digits, so a platform-blind order
    took it for the handle — 45 of 196 creators were filed that way, and the
    watchlist sweep cannot look up a display name.
    """
    if (info.get("extractor_key") or "").lower().startswith("instagram"):
        candidates = [info.get("channel"), info.get("uploader"), info.get("uploader_id")]
    else:
        candidates = [info.get("uploader"), info.get("channel"), info.get("uploader_id")]
    handle = next(
        (c for c in candidates if c and " " not in c and not c.isdigit()), None
    )
    return handle or next((c for c in candidates if c), None)


def _iso_date(raw: str | None) -> str | None:
    if not raw or len(raw) != 8:
        return raw
    try:
        return datetime.strptime(raw, "%Y%m%d").date().isoformat()
    except ValueError:
        return raw


def _fetch(cmd: list[str], url: str, user_config: dict) -> None:
    """Fetch anonymously first, falling back to cookies only if login is needed.

    Public Reels and TikToks — the overwhelming majority — need no session, and
    skipping cookies on the first try makes them both faster and immune to the
    browser cookie-store lock. Cookies are the retry, not the default.
    """
    cookies = _cookie_args(user_config)
    try:
        run(cmd, timeout=NO_COOKIE_TIMEOUT_SEC)
        return
    except RuntimeError as anonymous_failure:
        if not cookies or not _needs_login(str(anonymous_failure)):
            raise RuntimeError(f"could not download {url}\n{anonymous_failure}") from anonymous_failure

    try:
        run([*cmd[:-1], *cookies, url], timeout=COOKIE_TIMEOUT_SEC)
    except RuntimeError as cookie_failure:
        raise RuntimeError(
            f"could not download {url} (tried anonymously, then with "
            f"{cookies[1]} cookies)\n{cookie_failure}"
        ) from cookie_failure


def _from_direct(direct: dict, workdir: Path, url: str) -> Source:
    """Fetch the media URL the sweep stored, and build the metadata from what it
    already knew.

    yt-dlp resolves an Instagram post through the private `/api/v1` endpoints,
    and those are retired — measured 2026-09-20, when all 24 failed jobs came
    from the burner reader and none from Apify. There is nothing to resolve
    here: the sweep saw `video_versions[0].url` on Instagram's own response and
    kept it, along with the caption, the handle and the date. Instagram's CDN
    serves those files without a session.
    """
    target = workdir / "source.mp4"
    request = urllib.request.Request(direct["video_url"], headers={"User-Agent": DIRECT_UA})
    with urllib.request.urlopen(request, timeout=DIRECT_TIMEOUT_SEC) as response:
        target.write_bytes(response.read())
    if target.stat().st_size == 0:
        target.unlink(missing_ok=True)
        raise RuntimeError(f"the stored media URL for {url} returned an empty file")

    posted = (direct.get("posted_at") or "")[:10].replace("-", "") or None
    caption = direct.get("caption") or ""
    return Source(media_path=target, meta={
        "platform": "instagram",
        "author": direct.get("handle"),
        # No title comes back with a bare file, so the caption's first line
        # stands in — the same thing yt-dlp does for a Reel.
        "title": caption.splitlines()[0][:100] if caption else None,
        "caption": caption or None,
        "upload_date": posted,
        "duration_sec": direct.get("duration_sec"),
        "webpage_url": url,
        "source_url": url,
    })


def download(url: str, workdir: Path, user_config: dict, direct: dict | None = None) -> Source:
    """Fetch a post with yt-dlp into workdir, returning the media file and its metadata.

    `direct` is what the sweep already read about this post — its media URL and
    the metadata around it — used only when yt-dlp cannot resolve the page."""
    workdir.mkdir(parents=True, exist_ok=True)
    cmd = [
        config.YT_DLP, "--no-playlist", "--no-warnings", "--no-progress",
        # Social platforms rate-limit bursts; a few retries keeps bulk runs alive.
        "--socket-timeout", "30", "-R", "3", "--retry-sleep", "3",
        "--extractor-retries", "3", "--sleep-requests", "1",
        "--ffmpeg-location", config.FFMPEG.parent,
        # Instagram serves DASH VP9, which QuickTime, Photos and most upload
        # forms refuse. Ask for H.264 first and only fall back to anything else.
        "-f", "bv*[vcodec^=avc1]+ba/b[vcodec^=avc1]/bv*+ba/b",
        "--merge-output-format", "mp4",
        "--write-info-json",
        "--write-thumbnail",
        "-o", str(workdir / "source.%(ext)s"),
        url,
    ]
    # An Instagram carousel is a playlist to yt-dlp, and --no-playlist does not
    # change that. Its photo slides each fail with "no video formats found",
    # which makes the whole run exit non-zero even when the one slide that is a
    # video downloaded perfectly. So a failure is only fatal if nothing landed.
    try:
        _fetch(cmd, url, user_config)
    except RuntimeError as failure:
        if _media_in(workdir) is None:
            if _has_no_video(str(failure)):
                # Instagram answered with a post that carries no video track.
                # Traced 2026-09-03 against the raw private API: these posts
                # come back media_type=1 (photo) or media_type=8 (carousel of
                # photos), never media_type=2/product_type=clips, and have no
                # `video_versions` key at all. A working Reel has all three.
                # Ruled out on the same run: stale yt-dlp, a dead cookie jar
                # (the session is live and other Reels resolve with it), the
                # /p/ vs /reel/ URL shape, and the /embed/ endpoint (it now
                # serves the same login shell for working and failing posts
                # alike). No open yt-dlp issue matches this signature.
                #
                # A /reel/ URL is not proof of video: Instagram serves photo
                # posts with attached audio through the Reels surface, so they
                # play in the app while the API correctly reports no video.
                # Auth cannot conjure a video track that is not in the post, so
                # this stays terminal rather than retrying with cookies.
                raise RuntimeError(
                    f"Instagram returned this post as photo media — caption, "
                    f"creator and thumbnails came back, but the post carries no "
                    f"video track to transcribe. A /reel/ link does not "
                    f"guarantee video: photo posts with audio play in the Reels "
                    f"feed too. Re-exporting cookies will not change this: {url}"
                ) from failure
            # The page would not resolve, but the sweep that found this reel
            # already read its media URL off Instagram's own response. Fetch
            # that instead of asking yt-dlp to resolve a page it cannot.
            if direct and direct.get("video_url"):
                return _from_direct(direct, workdir, url)
            raise

    media = _media_in(workdir)
    if media is None:
        raise RuntimeError(f"download produced no media file for {url}")

    # With a carousel there is one info.json per slide. The one describing the
    # video is the one named after it; picking the first alphabetically would
    # hang a photo slide's id, duration and caption on the wrong file.
    info_files = sorted(workdir.glob("*.info.json"))
    matching = next(
        (f for f in info_files if f.name == f"{media.stem}.info.json"), None
    )
    chosen = matching or (info_files[0] if info_files else None)
    info = json.loads(chosen.read_text()) if chosen else {}

    meta = {
        "source": url,
        "source_type": "url",
        "platform": platform_of(url),
        "title": info.get("title") or info.get("fulltitle") or media.stem,
        "author": _pick_handle(info),
        "author_name": info.get("uploader") or info.get("channel"),
        "author_url": info.get("uploader_url") or info.get("channel_url"),
        "caption": (info.get("description") or "").strip() or None,
        "upload_date": _iso_date(info.get("upload_date")),
        "duration_sec": info.get("duration"),
        # Instagram returns likes and comments on every post; view and share
        # counts it simply does not expose, so they stay absent rather than
        # becoming columns that are always null.
        "like_count": info.get("like_count"),
        "comment_count": info.get("comment_count"),
        "view_count": info.get("view_count"),
        "post_id": info.get("id"),
        "webpage_url": info.get("webpage_url") or url,
        "thumbnail_file": _thumbnail_name(workdir),
        "thumbnail_url": info.get("thumbnail"),
    }
    return Source(media_path=media, meta=meta)


def _thumbnail_name(workdir: Path) -> str | None:
    """The poster frame yt-dlp saved alongside the video, if any."""
    for candidate in sorted(workdir.iterdir()):
        if candidate.suffix.lower() in IMAGE_SUFFIXES:
            return candidate.name
    return None


def adopt_local(path: Path, workdir: Path) -> Source:
    """Copy a phone/desktop video into the job folder and probe it."""
    workdir.mkdir(parents=True, exist_ok=True)
    destination = workdir / f"source{path.suffix.lower()}"
    if not destination.exists():
        shutil.copy2(path, destination)
    meta = {
        "source": str(path),
        "source_type": "file",
        "platform": "local",
        "title": path.stem,
        "author": None,
        "caption": None,
        "upload_date": datetime.fromtimestamp(path.stat().st_mtime).date().isoformat(),
        "duration_sec": probe_duration(destination),
        "post_id": None,
        "webpage_url": None,
    }
    return Source(media_path=destination, meta=meta)


def video_codec(media: Path) -> str | None:
    try:
        out = run([
            config.FFPROBE, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name", "-of", "csv=p=0", media,
        ])
        return out.strip() or None
    except RuntimeError:
        return None


def ensure_playable(media: Path) -> Path:
    """Re-encode to H.264 if the download is a codec Apple software won't open."""
    if media.suffix.lower() != ".mp4" or video_codec(media) in ("h264", None):
        return media
    converted = media.with_name(f"{media.stem}-h264.mp4")
    run([
        config.FFMPEG, "-y", "-loglevel", "error", "-i", media,
        "-c:v", "h264_videotoolbox", "-b:v", "6M",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", converted,
    ])
    media.unlink()
    return converted.rename(media)


def probe_duration(media: Path) -> float | None:
    try:
        out = run([
            config.FFPROBE, "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", media,
        ])
        return round(float(out.strip()), 2)
    except (RuntimeError, ValueError):
        return None


def has_audio(media: Path) -> bool:
    out = run([
        config.FFPROBE, "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=index", "-of", "csv=p=0", media,
    ])
    return bool(out.strip())


def extract_audio(media: Path, destination: Path) -> Path:
    """Decode to the 16 kHz mono PCM that both whisper.cpp and the diarizer expect."""
    if not has_audio(media):
        raise RuntimeError(f"{media.name} has no audio track — nothing to transcribe")
    run([
        config.FFMPEG, "-y", "-loglevel", "error", "-i", media,
        "-vn", "-ac", "1", "-ar", str(config.SAMPLE_RATE), "-c:a", "pcm_s16le",
        destination,
    ])
    return destination
