"""Copy plan videos into Cloudflare R2.

The library's videos never leave this Mac — they are served off loopback behind
a tunnel, which is why the library costs nothing. A plan is different. She may
open it at 2am with the Mac asleep, and handing a client a dead player is not
acceptable. So the videos that land on a plan, and only those, are copied to R2.

The Mac uploads rather than the app: the file is already here, and pushing ten
megabytes through a Vercel function is exactly the cap that forced phone uploads
to go browser-direct to Blob in the first place.

Signing is `curl --aws-sigv4`, which ships with the system curl. Credentials go
in on stdin as a curl config file, not on the command line, so they never appear
in `ps` output.
"""
from __future__ import annotations

import subprocess
import tempfile
import urllib.parse
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass
from pathlib import Path

from . import config

# Generous: a 10 MB clip over a slow uplink, not a hung socket forever.
UPLOAD_TIMEOUT_SEC = 300.0
DELETE_TIMEOUT_SEC = 60.0
LIST_TIMEOUT_SEC = 60.0
SIGV4 = "aws:amz:auto:s3"

# One page of a bucket listing, and the most pages one sweep will walk. Ten
# thousand objects is far more than this bucket will ever hold; the ceiling is
# there so a paging bug cannot spin forever.
LIST_PAGE = 1000
LIST_MAX_PAGES = 10

S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"


class R2Error(RuntimeError):
    """R2 refused, or curl could not reach it."""


@dataclass(frozen=True)
class Bucket:
    account_id: str
    access_key_id: str
    secret_access_key: str
    name: str

    @property
    def endpoint(self) -> str:
        return f"https://{self.account_id}.r2.cloudflarestorage.com"

    def url_for(self, key: str) -> str:
        return f"{self.endpoint}/{self.name}/{key.lstrip('/')}"


def from_config(user_config: dict) -> Bucket | None:
    """The bucket, or None when R2 has not been set up yet.

    Absent credentials are a normal state, not an error: the console shows the
    plan items as still waiting, and the share page falls back to the Instagram
    link rather than showing a player that cannot load.
    """
    settings = user_config.get("r2")
    if not isinstance(settings, dict):
        return None
    fields = ("account_id", "access_key_id", "secret_access_key", "bucket")
    values = [settings.get(field) for field in fields]
    if not all(isinstance(value, str) and value for value in values):
        return None
    account, key_id, secret, bucket = values
    return Bucket(account, key_id, secret, bucket)


def _curl(
    bucket: Bucket,
    url: str,
    *options: str,
    timeout: float,
    out: Path | None = None,
) -> int:
    """Run one signed request, returning its HTTP status code.

    Every option lives in the config file on stdin so that nothing sensitive is
    visible to another process on this machine.

    `out` is where the response body goes. Uploads and deletes want it thrown
    away; a listing is the one request whose answer is the body.
    """
    lines = [
        f'--aws-sigv4 "{SIGV4}"',
        f'--user "{bucket.access_key_id}:{bucket.secret_access_key}"',
        *options,
        "--silent",
        "--show-error",
        "--location",
        f'--output "{out}"' if out else "--output /dev/null",
        '--write-out "%{http_code}"',
        f'--url "{url}"',
    ]
    try:
        finished = subprocess.run(
            ["curl", "--config", "-"],
            input="\n".join(lines),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise R2Error(f"curl failed: {exc}") from exc

    if finished.returncode != 0:
        raise R2Error(finished.stderr.strip() or f"curl exited {finished.returncode}")
    try:
        return int(finished.stdout.strip() or 0)
    except ValueError as exc:
        raise R2Error(f"unreadable curl output: {finished.stdout!r}") from exc


def put(bucket: Bucket, path: Path, key: str) -> int:
    """Upload one file. Returns its size in bytes."""
    if not path.is_file():
        raise R2Error(f"no such file: {path}")

    status = _curl(
        bucket,
        bucket.url_for(key),
        f'--upload-file "{path}"',
        '--header "Content-Type: video/mp4"',
        timeout=UPLOAD_TIMEOUT_SEC,
    )
    if status not in (200, 201):
        raise R2Error(f"R2 answered {status} for {key}")
    return path.stat().st_size


def delete(bucket: Bucket, key: str) -> None:
    """Reclaim one object. An already-absent object is a success, not a failure."""
    status = _curl(
        bucket,
        bucket.url_for(key),
        "--request DELETE",
        timeout=DELETE_TIMEOUT_SEC,
    )
    if status not in (200, 202, 204, 404):
        raise R2Error(f"R2 answered {status} deleting {key}")


@dataclass(frozen=True)
class Stored:
    """One object as the bucket describes it."""

    key: str
    modified: str
    size: int


def list_keys(bucket: Bucket, prefix: str = "plans/") -> list[Stored] | None:
    """Every object under `prefix`, or None if the listing could not be finished.

    None rather than a short list, on purpose. The app reads a listing as the
    whole truth about the bucket and answers with deletions, so half a listing
    presented as a whole one is a request to delete the other half. Any failure
    — a refused request, unparseable XML, more pages than the ceiling allows —
    comes back as None and the sweep is simply skipped until next time.
    """
    found: list[Stored] = []
    token: str | None = None

    for _ in range(LIST_MAX_PAGES):
        query = {"list-type": "2", "prefix": prefix, "max-keys": str(LIST_PAGE)}
        if token:
            query["continuation-token"] = token
        url = f"{bucket.endpoint}/{bucket.name}?{urllib.parse.urlencode(query)}"

        with tempfile.NamedTemporaryFile(suffix=".xml") as body:
            status = _curl(bucket, url, timeout=LIST_TIMEOUT_SEC, out=Path(body.name))
            if status != 200:
                raise R2Error(f"R2 answered {status} listing {prefix}")
            try:
                root = ElementTree.parse(body.name).getroot()
            except ElementTree.ParseError as exc:
                raise R2Error(f"unreadable listing: {exc}") from exc

        for entry in root.findall(f"{S3_NS}Contents"):
            key = entry.findtext(f"{S3_NS}Key") or ""
            if not key:
                continue
            found.append(Stored(
                key=key,
                modified=entry.findtext(f"{S3_NS}LastModified") or "",
                size=int(entry.findtext(f"{S3_NS}Size") or 0),
            ))

        if (root.findtext(f"{S3_NS}IsTruncated") or "").lower() != "true":
            return found
        token = root.findtext(f"{S3_NS}NextContinuationToken")
        if not token:
            return found

    # More pages than the ceiling. Not an error worth raising — just not a
    # listing anything is allowed to act on.
    return None


VIDEO_NAMES = ("source.mp4", "source.mov", "source.m4v", "source.webm")


def video_in(folder_name: str, out_dir: Path | None = None) -> Path | None:
    """The video file inside one library folder, by the same rules mediaserv uses."""
    from . import media

    root = out_dir or config.DEFAULT_OUT_DIR
    folder = (root / folder_name).resolve()
    if folder.parent != root.resolve() or not folder.is_dir():
        return None
    for name in VIDEO_NAMES:
        candidate = folder / name
        if candidate.exists():
            return candidate
    return next(
        (p for p in sorted(folder.iterdir()) if p.suffix.lower() in media.VIDEO_SUFFIXES),
        None,
    )
