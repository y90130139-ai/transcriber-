"""Read the screen on videos already in the library that nothing has looked at.

Everything added before the visual pass existed carries a transcript but no
answer to "what does the screen say". `transcripts.has_looked is null` is
exactly that set, and the app orders it silent-first because that is where the
answer changes something: measured 2026-09-06, 44 of the 50 silent folders in
out/ (88%) carry on-screen text, and without it every one of them fell through
to the same placeholder hook tag.

Like ./bin/relisten, this reads the copy of the video already on disk rather
than re-fetching — the video is right there, and a re-fetch would put a
since-gated post at the mercy of whatever Instagram thinks of the cookies today.
Only the visual fields are rewritten; the transcript, metadata and figures the
original fetch captured are left exactly as they are.

  ./bin/relook                     # what would be done
  ./bin/relook --apply
  ./bin/relook --apply --cloud http://localhost:3000
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from . import config, media, pipeline, visual, worker


def _folders(out_dir: Path, targets: list[dict]) -> list[tuple[dict, Path]]:
    found = []
    for row in targets:
        folder = out_dir / str(row.get("folder") or "")
        if not row.get("folder") or not folder.is_dir():
            print(f"  skip {row['job_id']}: no folder on disk")
            continue
        found.append((row, folder))
    return found


def relook(folder: Path) -> dict:
    """Read the screen and write the result into transcript.json in place."""
    video = next(
        (p for p in sorted(folder.iterdir()) if p.suffix.lower() in media.VIDEO_SUFFIXES),
        None,
    )
    if video is None:
        raise RuntimeError("no video in folder")

    report = pipeline._visual_report(visual.analyze(video, folder))

    # Rewrite only the visual block. Re-rendering the whole result here would
    # mean re-deriving a transcript this pass never listened to.
    path = folder / "transcript.json"
    data = json.loads(path.read_text())
    data["visual"] = report
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return report


def main(argv: list[str]) -> int:
    apply = "--apply" in argv
    user_config = config.load_user_config()
    base = user_config["cloud_url"]
    if "--cloud" in argv:
        base = argv[argv.index("--cloud") + 1]
    cloud = worker.Cloud(base, user_config["worker_secret"])
    out_dir = config.DEFAULT_OUT_DIR

    if not visual.available():
        print("OCR binary missing — run ./setup.sh (needs xcode-select --install)")
        return 1

    targets = cloud.post("/api/worker/unseen", {})["items"]
    pairs = _folders(out_dir, targets)
    print(f"{len(targets)} never looked at, {len(pairs)} with the video still on disk")
    if not apply:
        print("dry run — pass --apply to read the screens and post the results")
        return 0

    with_text = 0
    for row, folder in pairs:
        try:
            report = relook(folder)
        except Exception as exc:
            print(f"  failed {folder.name}: {str(exc).splitlines()[0][:120]}")
            continue
        cloud.complete(worker._payload(row["job_id"], folder))
        with_text += bool(report["has_text"])
        first = (report["captions"][0]["text"] if report["captions"] else "")
        print(f"  {'text' if report['has_text'] else '  — '}  {folder.name[:44]:<44} {first[:52]}")
    print(f"\n{with_text} of {len(pairs)} had something written on screen.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
