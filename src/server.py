"""A local drop-and-go web UI for the transcriber.

Serves one page on localhost. Drop videos on it or paste links; jobs run through
the same pipeline the CLI uses, one at a time, and transcripts appear in place.
Nothing leaves the machine — the server binds to 127.0.0.1 only.
"""
from __future__ import annotations

import json
import queue
import threading
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import config, library, media, pipeline

WEB_DIR = config.ROOT / "web"
UPLOAD_DIR = config.ROOT / "inbox"
MAX_UPLOAD_BYTES = 500 * 1024 * 1024


@dataclass
class Job:
    id: str
    label: str
    kind: str
    source: str
    status: str = "queued"
    stage: str = "waiting"
    folder: str | None = None
    error: str | None = None
    created: str = field(default_factory=lambda: datetime.now().strftime("%H:%M:%S"))

    def as_dict(self) -> dict:
        return {
            "id": self.id, "label": self.label, "kind": self.kind,
            "status": self.status, "stage": self.stage,
            "folder": self.folder, "error": self.error, "created": self.created,
        }


class JobBoard:
    """Thread-safe job registry plus the worker that drains the queue."""

    def __init__(self, options: pipeline.Options, user_config: dict) -> None:
        self._jobs: dict[str, Job] = {}
        self._order: list[str] = []
        self._lock = threading.Lock()
        self._queue: queue.Queue[str] = queue.Queue()
        self._options = options
        self._user_config = user_config
        threading.Thread(target=self._worker, daemon=True).start()

    def add(self, label: str, kind: str, source: str) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], label=label, kind=kind, source=source)
        with self._lock:
            self._jobs[job.id] = job
            self._order.append(job.id)
        self._queue.put(job.id)
        return job

    def snapshot(self) -> list[dict]:
        with self._lock:
            return [self._jobs[i].as_dict() for i in reversed(self._order)]

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def _update(self, job_id: str, **changes) -> None:
        with self._lock:
            job = self._jobs[job_id]
            for key, value in changes.items():
                setattr(job, key, value)

    def _worker(self) -> None:
        while True:
            job_id = self._queue.get()
            job = self.get(job_id)
            if job is None:
                continue
            self._update(job_id, status="running", stage="starting")
            try:
                folder = pipeline.process(
                    job.source, self._options, self._user_config,
                    log=lambda line, jid=job_id: self._update(jid, stage=line.strip(" .…")),
                )
                self._update(job_id, status="done", stage="finished", folder=folder.name)
            except Exception as exc:
                traceback.print_exc()
                self._update(
                    job_id, status="failed", stage="failed",
                    error=str(exc).splitlines()[0][:300],
                )


class Handler(BaseHTTPRequestHandler):
    board: JobBoard
    out_dir: Path

    def log_message(self, *args) -> None:  # keep the console clean
        pass

    # -- helpers -----------------------------------------------------------
    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload, code: int = 200) -> None:
        self._send(code, json.dumps(payload).encode(), "application/json; charset=utf-8")

    # -- routes ------------------------------------------------------------
    def do_GET(self) -> None:
        if self.path in ("/", "/index.html"):
            page = (WEB_DIR / "index.html").read_bytes()
            return self._send(200, page, "text/html; charset=utf-8")
        if self.path == "/api/jobs":
            return self._json({"jobs": self.board.snapshot()})
        if self.path.startswith("/api/transcript/"):
            return self._transcript(self.path.rsplit("/", 1)[-1])
        self._json({"error": "not found"}, 404)

    def _transcript(self, job_id: str) -> None:
        job = self.board.get(job_id)
        if job is None or not job.folder:
            return self._json({"error": "not ready"}, 404)
        folder = self.out_dir / job.folder
        markdown = folder / "transcript.md"
        if not markdown.exists():
            return self._json({"error": "missing transcript"}, 404)
        payload = json.loads((folder / "transcript.json").read_text())
        self._json({
            "markdown": markdown.read_text(),
            "folder": str(folder),
            "speakers": payload.get("speakers", []),
            "blocks": payload.get("blocks", []),
            "meta": payload.get("meta", {}),
            "language": payload.get("language"),
        })

    def do_POST(self) -> None:
        if self.path == "/api/link":
            return self._add_links()
        if self.path == "/api/upload":
            return self._add_upload()
        self._json({"error": "not found"}, 404)

    def _body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_UPLOAD_BYTES:
            raise ValueError("file too large")
        return self.rfile.read(length)

    def _add_links(self) -> None:
        try:
            payload = json.loads(self._body() or b"{}")
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json({"error": str(exc)}, 400)
        from .cli import URL_PATTERN

        urls = URL_PATTERN.findall(payload.get("text", ""))
        if not urls:
            return self._json({"error": "no links found in that text"}, 400)
        added = [
            self.board.add(url.split("?")[0], "link", media.normalize_url(url)).as_dict()
            for url in urls
        ]
        self._json({"added": added})

    def _add_upload(self) -> None:
        filename = Path(self.headers.get("X-Filename", "clip.mp4")).name
        if Path(filename).suffix.lower() not in media.MEDIA_SUFFIXES:
            return self._json({"error": f"{filename}: not a video or audio file"}, 400)
        try:
            data = self._body()
        except ValueError as exc:
            return self._json({"error": str(exc)}, 400)
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        destination = UPLOAD_DIR / filename
        stem, suffix, counter = destination.stem, destination.suffix, 2
        while destination.exists():
            destination = UPLOAD_DIR / f"{stem}-{counter}{suffix}"
            counter += 1
        destination.write_bytes(data)
        self._json({"added": [self.board.add(filename, "file", str(destination)).as_dict()]})


def serve(port: int = 8765, *, model: str = "best") -> None:
    out_dir = config.DEFAULT_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    options = pipeline.Options(out_dir=out_dir, model=model)
    Handler.board = JobBoard(options, config.load_user_config())
    Handler.out_dir = out_dir
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"\n  Transcriber running at  http://localhost:{port}")
    print(f"  Transcripts land in     {out_dir}")
    print("  Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
