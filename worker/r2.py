"""Copy worker files into Cloudflare R2.

Mirrors `src/r2.py` on the Mac — curl's own SigV4 (`--aws-sigv4`, present in
every curl this image ships), credentials fed on stdin as a curl config, never
on the command line, so they cannot be read out of the process table. Only the
put differs: the worker streams bytes from memory, not from a file on disk.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
import urllib.parse
from pathlib import Path

SIGV4 = "aws:amz:auto:s3"
UPLOAD_TIMEOUT_SEC = 300.0


class R2Error(RuntimeError):
    """R2 refused, or curl could not reach it."""


def bucket() -> dict | None:
    account = os.environ.get("R2_ACCOUNT_ID")
    key_id = os.environ.get("R2_ACCESS_KEY_ID")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY")
    name = os.environ.get("R2_BUCKET")
    if not (account and key_id and secret and name):
        return None
    return {"account": account, "key_id": key_id, "secret": secret, "name": name}


def _endpoint(config: dict) -> str:
    return f"https://{config['account']}.r2.cloudflarestorage.com"


def put(config: dict, key: str, body: bytes, content_type: str) -> str:
    """Upload one object; returns the object URL (not public — presigned on read)."""
    target = f"{_endpoint(config)}/{config['name']}/{urllib.parse.quote(key.lstrip('/'))}"
    with tempfile.NamedTemporaryFile("w", delete=False) as config_file:
        config_file.write(f'user = "{config["key_id"]}:{config["secret"]}"\n')
        config_path = config_file.name
    try:
        done = subprocess.run(
            [
                "curl", "-sS", "--fail-with-body", "--aws-sigv4", SIGV4,
                "--connect-timeout", "30", "--max-time", str(int(UPLOAD_TIMEOUT_SEC)),
                "-K", config_path,
                "-X", "PUT",
                "-H", f"Content-Type: {content_type}",
                "-H", "Cache-Control: public, max-age=31536000, immutable",
                "--data-binary", "@-",
                target,
            ],
            input=body,
            capture_output=True,
            timeout=UPLOAD_TIMEOUT_SEC + 30,
        )
    finally:
        Path(config_path).unlink(missing_ok=True)

    if done.returncode != 0:
        message = done.stderr.decode(errors="replace")[:400] or f"curl exited {done.returncode}"
        raise R2Error(message)
    return target


EXTENSIONS = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def key_for(platform: str, media_id: str, content_type: str) -> str:
    extension = EXTENSIONS.get(content_type.split(";")[0].strip().lower(), "bin")
    return f"ofmpro/{platform}/{media_id}.{extension}"
