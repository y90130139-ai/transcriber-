"""The Mac side of the hosted transcriber.

The web app is a face and a queue; the transcribing happens here. This process
polls the app for claimed jobs, runs each one through the same pipeline the CLI
uses, and posts the finished transcript back. Video never leaves this machine —
only text and a small poster frame travel.

Run it with `./bin/worker`. If the Mac sleeps, jobs simply wait in the queue.
"""
from __future__ import annotations

import base64
import dataclasses
import json
import random
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import config, media, mediaserv, pipeline, r2, tunnel

POLL_IDLE_SEC = 6.0
POLL_ERROR_SEC = 30.0
# Between two Instagram downloads, a person's pause rather than a burst. Every
# download leaves from this Mac's connection — the same one Geno's phone is on —
# and 62 back to back is what got his own account warned for automated
# behaviour (2026-09-25). Slower is free: nothing here is urgent.
INSTAGRAM_GAP_SEC = (20.0, 60.0)
HEARTBEAT_SEC = 30.0
REQUEST_TIMEOUT_SEC = 60.0
THUMBNAIL_WIDTH = 420
DOWNLOAD_CHUNK = 1 << 20


class ProtectedError(RuntimeError):
    """The app answered, but with a login wall instead of the API."""


class Cloud:
    """Thin client for the app's worker endpoints."""

    def __init__(self, base_url: str, secret: str) -> None:
        self.base = base_url.rstrip("/")
        self.secret = secret

    def post(self, path: str, payload: dict) -> dict:
        request = urllib.request.Request(
            f"{self.base}{path}",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.secret}",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SEC) as response:
            body = response.read() or b"{}"
            # Vercel's deployment protection bounces API calls to an SSO login
            # page, which otherwise surfaces as a baffling JSON parse error.
            if "vercel.com/sso-api" in response.geturl() or body.lstrip()[:1] == b"<":
                raise ProtectedError(
                    "the app is behind Vercel Authentication — turn it off under "
                    "Project Settings > Deployment Protection"
                )
            return json.loads(body)

    def claim(self, note: str) -> dict:
        """One poll, which carries both the transcribe queue and the R2 errands."""
        return self.post("/api/worker/claim", {"limit": 1, "note": note})

    def report_r2(self, payload: dict) -> None:
        self._quietly("/api/worker/r2", payload)

    def reconcile_r2(self, payload: dict) -> dict:
        """Hand the app a full bucket listing and get back what it made of it."""
        return self.post("/api/worker/r2/reconcile", payload)

    def progress(self, job_id: str, stage: str) -> None:
        self._quietly("/api/worker/progress", {"id": job_id, "stage": stage})

    def ping(self, note: str, media_url: str | None = None) -> None:
        """Heartbeat, and tell the app where the videos can be reached today.

        A quick tunnel is reissued a new hostname whenever cloudflared restarts,
        so the app learns the current one from the heartbeat rather than from
        configuration that would go stale."""
        self._quietly("/api/worker/ping", {"note": note, "media_url": media_url})

    def complete(self, payload: dict) -> None:
        self.post("/api/worker/complete", payload)

    def fail(self, job_id: str, error: str) -> None:
        self._quietly("/api/worker/fail", {"id": job_id, "error": error})

    def _quietly(self, path: str, payload: dict) -> None:
        """Status chatter must never take down a job that is otherwise fine."""
        try:
            self.post(path, payload)
        except (urllib.error.URLError, OSError, ValueError, ProtectedError):
            pass


def _download(url: str, destination: Path) -> Path:
    """Pull an uploaded clip out of blob storage and onto local disk."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT_SEC) as response:
        with destination.open("wb") as handle:
            while chunk := response.read(DOWNLOAD_CHUNK):
                handle.write(chunk)
    return destination


def _thumbnail(folder: Path) -> str | None:
    """A small poster frame as a data URL, so the library is visually scannable.

    Prefers the platform's own cover image and falls back to a frame lifted out
    of the video, which is what makes phone uploads look like everything else.
    """
    from .util import run

    small = folder / "thumb.jpg"
    poster = next(
        (p for p in sorted(folder.iterdir()) if p.suffix.lower() in media.IMAGE_SUFFIXES
         and p.name != small.name),
        None,
    )
    video = next(
        (p for p in sorted(folder.iterdir()) if p.suffix.lower() in media.VIDEO_SUFFIXES),
        None,
    )

    try:
        if poster:
            run([config.FFMPEG, "-y", "-loglevel", "error", "-i", poster,
                 "-vf", f"scale={THUMBNAIL_WIDTH}:-2", "-q:v", "6", small], timeout=60)
        elif video:
            run([config.FFMPEG, "-y", "-loglevel", "error", "-ss", "1", "-i", video,
                 "-frames:v", "1", "-vf", f"scale={THUMBNAIL_WIDTH}:-2", "-q:v", "6", small],
                timeout=60)
        else:
            return None
    except RuntimeError:
        return None

    if not small.exists():
        return None
    encoded = base64.b64encode(small.read_bytes()).decode()
    return f"data:image/jpeg;base64,{encoded}"


def _read(folder: Path, name: str) -> str | None:
    path = folder / name
    return path.read_text() if path.exists() else None


def _payload(job_id: str, folder: Path) -> dict:
    data = json.loads((folder / "transcript.json").read_text())
    meta = data.get("meta", {})
    plain = _read(folder, "transcript.txt") or ""
    speech = data.get("speech") or {}
    seen = data.get("visual") or {}
    return {
        "id": job_id,
        # The folder name is how the app addresses this video on the tunnel.
        "folder": folder.name,
        "post_id": meta.get("post_id"),
        "like_count": meta.get("like_count"),
        "comment_count": meta.get("comment_count"),
        "platform": meta.get("platform"),
        "author": meta.get("author"),
        "author_name": meta.get("author_name"),
        "title": meta.get("title"),
        "webpage_url": meta.get("webpage_url"),
        "caption": meta.get("caption"),
        "upload_date": meta.get("upload_date"),
        "duration_sec": meta.get("duration_sec"),
        "language": data.get("language"),
        "speaker_count": len(data.get("speakers", [])),
        "word_count": len(plain.split()),
        # What the pass actually heard. `has_speech` is null when no pass ran,
        # which the app must not read as "nobody talked".
        "has_speech": speech.get("has_speech") if speech.get("checked") else None,
        "speech_ratio": speech.get("ratio"),
        # Text burned into the frame. For the ~29% of the corpus that never
        # speaks this is the only hook signal, so it travels as text like the
        # transcript does — the video still never leaves the Mac.
        "has_looked": seen.get("checked") or None,
        "on_screen_text": seen.get("text") or None,
        "on_screen_captions": seen.get("captions") or [],
        "thumbnail": _thumbnail(folder),
        "plain": plain,
        "markdown": _read(folder, "transcript.md"),
        "srt": _read(folder, "transcript.srt"),
        "blocks": data.get("blocks", []),
        "speakers": data.get("speakers", []),
    }


def _source_for(job: dict) -> tuple[str, Path | None]:
    """Resolve a job to something the pipeline accepts, plus any temp file to bin."""
    if job.get("kind") != "file":
        return job["source"], None
    name = Path(job.get("label") or "clip.mp4").name
    # The label used to be the filename, so it always carried an extension.
    # Now it can be a human name — "#100 - Halloween" — and a landing file
    # with no media suffix cascades: `adopt_local` copies it to a bare
    # `source`, nothing makes a poster, and the tunnel has nothing to serve.
    # The blob URL still ends in the real extension; take it from there.
    if Path(name).suffix.lower() not in media.MEDIA_SUFFIXES:
        from urllib.parse import urlparse
        suffix = Path(urlparse(job["source"]).path).suffix.lower()
        name += suffix if suffix in media.MEDIA_SUFFIXES else ".mp4"
    landing = config.INBOX_DIR / f"cloud-{job['id']}-{name}"
    return str(_download(job["source"], landing)), landing


def run_job(cloud: Cloud, job: dict, options: pipeline.Options, user_config: dict) -> None:
    label = job.get("label") or job["source"]
    # Every video gets listened to now — the pass costs about a second against a
    # fetch of tens, and its result is what sets the Talking / No speech label.
    # The flag survives only so an explicit "don't bother" can still be honoured.
    wants_speech = job.get("transcribe", True) is not False
    print(f"  → {label}{'' if wants_speech else '  (no speech pass)'}")
    temp: Path | None = None
    try:
        source, temp = _source_for(job)
        folder = pipeline.process(
            source, dataclasses.replace(options, transcribe=wants_speech), user_config,
            log=lambda line, jid=job["id"]: cloud.progress(jid, line.strip(" .…")),
            # What the sweep already read about this post: its media URL and the
            # metadata around it, used only if the page will not resolve.
            direct=job.get("media"),
        )
        cloud.progress(job["id"], "uploading transcript")
        cloud.complete(_payload(job["id"], folder))
        print(f"    done → {folder.name}")
    except Exception as exc:  # a bad link must not stop the queue
        message = str(exc).strip() or exc.__class__.__name__
        print(f"    failed: {message.splitlines()[0][:160]}")
        cloud.fail(job["id"], message[:900])
        if "tried anonymously, then with" in message:
            _check_login_soon()
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def _check_login_soon() -> None:
    """A download failed even with cookies — the shape a dead downloader login
    takes. Prove it and alert, in the background so the queue keeps moving;
    session-check itself skips if it ran in the last half hour, so a batch of
    sixty failures is one probe, not sixty."""
    try:
        subprocess.Popen(
            [str(config.ROOT / "bin" / "session-check"), "--downloader", "--from-worker"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
    except OSError as error:
        print(f"    could not start the login check: {error}")


# The launchd session checks (01:30/07:30/…) can be missed while the Mac
# sleeps, and a cookie nobody probes is exactly the cookie that expires in
# silence. The worker is always on, so it re-arms the checks whenever the
# health state is stale. Half an hour between kicks, so a broken check cannot
# spin.
SESSION_STALE_SEC = 6 * 60 * 60
SESSION_KICK_GAP_SEC = 30 * 60
_last_session_kick = 0.0


def maybe_kick_session_check() -> None:
    global _last_session_kick
    now = time.monotonic()
    if now - _last_session_kick < SESSION_KICK_GAP_SEC:
        return
    state = config.ROOT / "secrets" / "session-health.json"
    try:
        if state.is_file() and time.time() - state.stat().st_mtime < SESSION_STALE_SEC:
            return
    except OSError:
        pass
    _last_session_kick = now
    try:
        subprocess.Popen(
            [str(config.ROOT / "bin" / "session-check"), "--scout", "--viewer"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
    except OSError as error:
        print(f"    could not start the session check: {error}")


_warned_no_r2 = False

# How often the bucket is checked against the app's ledger. Rare on purpose:
# nothing here is urgent, one sweep is a handful of requests, and the cost of
# an orphan sitting for another six hours is nothing at all.
RECONCILE_EVERY_SEC = 6 * 60 * 60
# None rather than 0.0: `time.monotonic()` counts from boot, so a zero here
# means the first sweep lands immediately on a Mac that has been up a while and
# six hours late on one that just started. Sweeping once at worker start is the
# behaviour worth having, so it is stated rather than inherited from uptime.
_last_reconcile: float | None = None


def run_r2_reconcile(cloud: Cloud, bucket: r2.Bucket | None) -> None:
    """Check what the bucket actually holds against what the app thinks.

    The app's orphan list is only ever as complete as its own delete routes.
    Anything that removed a row another way — a cascade, a hand-run DELETE, a
    bug — leaves an object nothing will ever ask about again, and R2 bills for
    it forever. This is the sweep that finds those, and the reverse: rows
    claiming an object the bucket does not have, which is what a creator sees
    as a card marked ready with a dead player.

    Listing is the Mac's job for the same reason uploading is — this is the
    only side holding credentials that can. It does not delete anything: the
    strays go onto the same `r2_trash` list the delete routes use and are
    reclaimed by the same batched path on a later poll.
    """
    global _last_reconcile
    if bucket is None:
        return
    now = time.monotonic()
    if _last_reconcile is not None and now - _last_reconcile < RECONCILE_EVERY_SEC:
        return
    _last_reconcile = now

    try:
        stored = r2.list_keys(bucket)
    except r2.R2Error as exc:
        print(f"    R2 listing failed: {exc}")
        return
    # None means the listing ran past its page ceiling and is not the whole
    # bucket. The app answers a listing with deletions, so a partial one is
    # never sent — it is simply skipped until next time.
    if stored is None:
        print("    R2 listing did not finish — skipping this reconcile.")
        return

    try:
        result = cloud.reconcile_r2({
            "complete": True,
            "objects": [{"key": item.key, "modified": item.modified} for item in stored],
        })
    except (urllib.error.URLError, OSError, ValueError) as exc:
        print(f"    R2 reconcile could not reach the app ({exc})")
        return

    queued = int(result.get("queued") or 0)
    requeued = int(result.get("requeued") or 0)
    print(f"    R2 reconcile: {len(stored)} objects · {queued} orphaned · {requeued} missing")


def run_r2_errands(cloud: Cloud, bucket: r2.Bucket | None, work: dict) -> bool:
    """Move plan videos into R2, and reclaim the ones whose week has closed.

    Only videos that are on a plan are ever uploaded. Retention is what keeps
    this inside R2's free tier: a plan's objects go the moment its week is far
    enough behind, and objects whose row is already gone are handed over by the
    app as a list of orphaned keys.
    """
    uploads = work.get("uploads") or []
    expired = work.get("expired") or []
    trash = work.get("trash") or []
    if not (uploads or expired or trash):
        return False
    if bucket is None:
        # A normal state before R2 is set up, and not worth saying every poll.
        global _warned_no_r2
        if not _warned_no_r2:
            print("  R2 is not configured — plan videos are not being uploaded.")
            _warned_no_r2 = True
        return False

    uploaded: list[dict] = []
    for item in uploads:
        path = r2.video_in(str(item.get("folder", "")))
        if path is None:
            print(f"    no video on disk for {item.get('folder')}")
            continue
        try:
            size = r2.put(bucket, path, str(item["key"]))
        except r2.R2Error as exc:
            print(f"    R2 upload failed: {exc}")
            continue
        uploaded.append({"id": item["id"], "key": item["key"], "bytes": size})
        print(f"    → R2 {item['key']} ({size / 1e6:.1f} MB)")

    purged: list[str] = []
    for item in expired:
        try:
            r2.delete(bucket, str(item["key"]))
        except r2.R2Error as exc:
            print(f"    R2 delete failed: {exc}")
            continue
        purged.append(str(item["id"]))

    trashed: list[str] = []
    for key in trash:
        try:
            r2.delete(bucket, str(key))
        except r2.R2Error as exc:
            print(f"    R2 delete failed: {exc}")
            continue
        trashed.append(str(key))

    if uploaded or purged or trashed:
        cloud.report_r2({"uploaded": uploaded, "purged": purged, "trashed": trashed})
    return bool(uploaded or purged or trashed)


def _heartbeat(cloud: Cloud, note: str, link: tunnel.Tunnel | None, stop: threading.Event) -> None:
    """Keep the app's 'Mac listening' light honest during long transcribes."""
    while not stop.wait(HEARTBEAT_SEC):
        cloud.ping(note, link.url if link else None)


def serve(*, model: str = "best") -> None:
    user_config = config.load_user_config()
    base_url = user_config.get("cloud_url")
    secret = user_config.get("worker_secret")
    if not base_url or not secret:
        raise SystemExit(
            "config.json needs \"cloud_url\" and \"worker_secret\".\n"
            "Run ./bin/setup-cloud to fill them in."
        )

    import socket
    note = socket.gethostname()
    bucket = r2.from_config(user_config)
    cloud = Cloud(base_url, secret)
    out_dir = config.DEFAULT_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    options = pipeline.Options(out_dir=out_dir, model=model)

    # The videos stay here; only a signed, expiring URL to them travels. Serving
    # them from the Mac that already has to be awake is what keeps storage at $0.
    server, port = mediaserv.start(out_dir, secret, port=config.MEDIA_PORT)
    link = tunnel.Tunnel(
        port,
        hostname=user_config.get("media_hostname"),
        tunnel_name=user_config.get("media_tunnel"),
    )
    link.start()

    # launchd stops the agent with SIGTERM, whose default action skips the
    # cleanup below and leaves cloudflared running against a dead port. Turning
    # the signal into a normal exit means the tunnel goes when the worker does.
    def _bow_out(*_args) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _bow_out)

    stop = threading.Event()
    threading.Thread(target=_heartbeat, args=(cloud, note, link, stop), daemon=True).start()

    print(f"\n  Worker attached to {cloud.base}")
    print(f"  Transcripts also land in {out_dir}")
    print(f"  Videos served on 127.0.0.1:{port}")
    print(f"  Plan videos → R2 bucket {bucket.name}" if bucket
          else "  No R2 in config.json — plan videos will not be uploaded")
    if link.wait_for_url(timeout=20):
        cloud.ping(note, link.url)
    else:
        print("  No tunnel yet — playback will light up once one comes online.")
    print("  Press Ctrl+C to stop.\n")

    idle_notice = True
    try:
        while True:
            try:
                work = cloud.claim(note)
            except ProtectedError as exc:
                print(f"  {exc}\n  retrying in {POLL_ERROR_SEC:g}s…")
                time.sleep(POLL_ERROR_SEC)
                continue
            except (urllib.error.URLError, OSError, ValueError) as exc:
                print(f"  can't reach the app ({exc}) — retrying in {POLL_ERROR_SEC:g}s")
                time.sleep(POLL_ERROR_SEC)
                continue

            jobs = work.get("jobs") or []
            # Plan videos ride along on the same poll — this Mac holds both the
            # files and the R2 credentials, so it is the only side that can.
            moved = run_r2_errands(cloud, bucket, work)
            # And every six hours, what the bucket holds that no row claims.
            run_r2_reconcile(cloud, bucket)
            # Keep the cookie probes armed even if launchd slept through them.
            maybe_kick_session_check()

            if not jobs:
                if not moved and idle_notice:
                    print("  waiting for links…")
                    idle_notice = False
                if not moved:
                    time.sleep(POLL_IDLE_SEC)
                continue

            idle_notice = True
            for job in jobs:
                run_job(cloud, job, options, user_config)
                if "instagram.com" in str(job.get("source") or ""):
                    time.sleep(random.uniform(*INSTAGRAM_GAP_SEC))
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        stop.set()
        link.stop()
        server.shutdown()
        shutil.rmtree(out_dir / ".work", ignore_errors=True)
