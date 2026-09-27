"""What a reference video *looks like*, shot by shot, measured on the Mac.

Geno, 2026-09-27: the card's filming directions were picked from a table by
the reel's format tag, so every "text overlay" said "back camera" even when the
original was a selfie in the hand, and a reel that cut from her reaction to a
clip of a horse running off was briefed as one continuous shot. Nothing had
looked at the picture — only at the words and the on-screen text.

This looks. For each reel on disk:

- **Cuts**, from ffmpeg's scene score, into shots of at least MIN_SHOT seconds.
- **Per shot**, three frames through Apple Vision (`vendor/bin/look-frame`):
  how many people, how big the largest face is (a selfie fills the frame), how
  tall the tallest body is (full length or not), and Vision's own scene labels
  ("horse", "beach") for shots nobody is in.
- **Camera movement**, from how much the *edges* of the frame change between
  frames: the edges are background, so they move when the phone moves and stay
  put when it is propped, however much the person in the middle moves.

Same constitution as `visual.py`: on-device, free, no key, no network, and it
never raises — a reel it cannot read comes back as `None`, not as a crash.
Keyframes are kept in `<folder>/look/` for the one-line descriptions
(`describe.py`) and for anyone checking the result by eye.
"""
from __future__ import annotations

import json
import re
import statistics
import subprocess
from pathlib import Path

from . import config

VERSION = 1

# ffmpeg's scene score above which a frame starts a new shot. 0.3 catches hard
# cuts and leaves a person walking across a room as one shot.
SCENE_THRESHOLD = 0.3
# A "shot" shorter than this is a flash frame or a transition, merged into its
# neighbour rather than briefed as a step of its own.
MIN_SHOT = 0.8
MAX_SHOTS = 8

# Motion is measured on a tiny grey grid, a few frames a second.
MOTION_FPS = 6
GRID_W, GRID_H = 18, 32
# The outer ring of the grid is the background.
EDGE = 3
# Mean absolute change of the edge cells between frames, 0-255. Below STILL
# the phone was propped; above MOVING it was being carried or panned. Tuned on
# library reels (2026-09-27): propped talking heads sit under 3, selfies in
# the hand 4-9, walking shots well above 10.
STILL = 3.2
MOVING = 10.0

# A face covering this much of the frame is at selfie distance — arm's length
# or closer. A body this tall is full length.
CLOSE_FACE = 0.045
FULL_BODY = 0.72

# Vision labels that say nothing a person would film differently.
DULL_LABELS = {
    "people", "adult", "person", "structure", "wood_processed", "material",
    "textile", "clothing", "portrait", "selfie", "hair", "face", "skin",
    "blue_sky", "sky", "indoor", "outdoor", "light", "screenshot", "document",
    "text", "font", "night_sky", "art", "illustrations",
}


def _run(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, **kwargs)


def _duration(media: Path) -> float | None:
    result = _run([str(config.FFPROBE), "-v", "error", "-show_entries", "format=duration",
                   "-of", "default=nw=1:nk=1", str(media)], text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def _cuts(media: Path) -> list[float]:
    result = _run([str(config.FFMPEG), "-nostdin", "-hide_banner", "-i", str(media),
                   "-vf", f"select='gt(scene,{SCENE_THRESHOLD})',showinfo", "-an", "-f", "null", "-"],
                  text=True)
    return [float(m) for m in re.findall(r"pts_time:([0-9.]+)", result.stderr)]


def spans(cuts: list[float], duration: float) -> list[tuple[float, float]]:
    """Shots from cut times: short ones folded into the one before, at most
    MAX_SHOTS (the shortest merged first)."""
    edges = [0.0] + sorted(c for c in cuts if 0 < c < duration) + [duration]
    out: list[list[float]] = []
    for start, end in zip(edges, edges[1:]):
        if out and end - start < MIN_SHOT:
            out[-1][1] = end
        else:
            out.append([start, end])
    # A short first shot has nothing before it; fold it forward instead.
    if len(out) > 1 and out[0][1] - out[0][0] < MIN_SHOT:
        out[1][0] = out[0][0]
        out.pop(0)
    while len(out) > MAX_SHOTS:
        shortest = min(range(len(out)), key=lambda i: out[i][1] - out[i][0])
        into = shortest - 1 if shortest > 0 else 1
        lo, hi = sorted((shortest, into))
        out[lo] = [out[lo][0], out[hi][1]]
        out.pop(hi)
    return [(round(a, 2), round(b, 2)) for a, b in out]


def _grid_frames(media: Path, start: float, end: float) -> list[bytes]:
    result = _run([str(config.FFMPEG), "-nostdin", "-v", "error", "-ss", f"{start:.2f}",
                   "-t", f"{max(end - start, 0.2):.2f}", "-i", str(media),
                   "-vf", f"fps={MOTION_FPS},scale={GRID_W}:{GRID_H},format=gray",
                   "-f", "rawvideo", "-"])
    size = GRID_W * GRID_H
    data = result.stdout
    return [data[i:i + size] for i in range(0, len(data) - size + 1, size)]


def edge_motion(frames: list[bytes]) -> float | None:
    """Mean change of the background ring between consecutive frames."""
    if len(frames) < 2:
        return None
    ring = [y * GRID_W + x for y in range(GRID_H) for x in range(GRID_W)
            if x < EDGE or y < EDGE or x >= GRID_W - EDGE or y >= GRID_H - EDGE]
    diffs = [sum(abs(a[i] - b[i]) for i in ring) / len(ring) for a, b in zip(frames, frames[1:])]
    return round(statistics.median(diffs), 2)


def camera_of(motion: float | None) -> str:
    if motion is None:
        return "unknown"
    if motion < STILL:
        return "still"
    return "moving" if motion > MOVING else "handheld"


def _keyframes(media: Path, start: float, end: float, into: Path, shot: int) -> list[Path]:
    paths = []
    for n, at in enumerate((0.25, 0.5, 0.75)):
        path = into / f"shot-{shot}-{n}.jpg"
        t = start + (end - start) * at
        _run([str(config.FFMPEG), "-nostdin", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(media),
              "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", str(path)])
        if path.exists():
            paths.append(path)
    return paths


def _look(paths: list[Path]) -> list[dict]:
    if not paths:
        return []
    result = _run([str(config.LOOK_FRAME), *[str(p) for p in paths]], text=True)
    out = []
    for line in result.stdout.splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "error" not in row:
            out.append(row)
    return out


def summarise(looks: list[dict], motion: float | None) -> dict:
    """One shot, from its frames: who is in it, how close, what else is there."""
    if not looks:
        return {"people": 0, "framing": "unknown", "camera": camera_of(motion), "motion": motion, "labels": []}
    people = [max(int(l.get("faces") or 0), int(l.get("bodies") or 0)) for l in looks]
    # Present in most frames, not just one: a passer-by is not the subject.
    count = sorted(people)[len(people) // 2]
    face = statistics.median(float(l.get("face") or 0) for l in looks)
    body = max(float(l.get("body") or 0) for l in looks)
    if count == 0:
        framing = "none"
    elif face >= CLOSE_FACE:
        framing = "close"
    elif body >= FULL_BODY:
        framing = "full"
    else:
        framing = "mid"
    tally: dict[str, int] = {}
    for l in looks:
        for label in l.get("labels") or []:
            if label not in DULL_LABELS:
                tally[label] = tally.get(label, 0) + 1
    labels = [k for k, _ in sorted(tally.items(), key=lambda kv: -kv[1])][:4]
    camera = camera_of(motion)
    return {
        "people": count,
        "framing": framing,
        "camera": camera,
        # A close face in a phone that is moving is a selfie in the hand; the
        # front camera is the only way to film yourself that close handheld.
        "selfie": framing == "close" and camera in ("handheld", "moving"),
        "motion": motion,
        "face": round(face, 3),
        "labels": labels,
    }


def measure(folder: Path) -> dict | None:
    """The shot list for one library folder, or None when nothing could be read."""
    media = folder / "source.mp4"
    if not media.exists() or not config.LOOK_FRAME.exists():
        return None
    try:
        duration = _duration(media)
        if not duration:
            return None
        into = folder / "look"
        into.mkdir(exist_ok=True)
        shots = []
        for index, (start, end) in enumerate(spans(_cuts(media), duration), start=1):
            frames = _keyframes(media, start, end, into, index)
            shot = summarise(_look(frames), edge_motion(_grid_frames(media, start, end)))
            shot.update({"start": start, "end": end, "frames": [p.name for p in frames]})
            shots.append(shot)
        return {"version": VERSION, "duration": round(duration, 2), "shots": shots}
    except Exception as error:  # never raises — see the module note
        print(f"  shots: {folder.name}: {error}")
        return None


DESCRIBE_SHOTS = 4


def _frames_for(folder: Path, count: int) -> list[dict]:
    """The middle keyframe of each shot, as the data URLs the describe route takes."""
    import base64
    frames = []
    for no in range(1, min(count, DESCRIBE_SHOTS) + 1):
        path = folder / "look" / f"shot-{no}-1.jpg"
        if path.exists():
            frames.append({"no": no, "image": "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode()})
    return frames


def describe(cloud, limit: int) -> int:
    """One line per shot from the vision model, for measured reels. Stops at the
    first refused call — the free allowance is shared with the captions."""
    import urllib.error
    items = cloud.post("/api/worker/describe", {"need": True, "limit": limit})["items"]
    done = 0
    for row in items:
        folder = config.DEFAULT_OUT_DIR / str(row.get("folder") or "")
        frames = _frames_for(folder, int(row.get("shots") or 1))
        if not frames:
            print(f"  skip {folder.name[:50]}: no keyframes — run ./bin/look --apply --again first")
            continue
        try:
            cloud.post("/api/worker/describe", {"job_id": row["job_id"], "frames": frames})
        except urllib.error.HTTPError as error:
            reason = error.read().decode(errors="replace")[:240]
            if error.code == 429:
                print(f"  allowance used up — the rest tomorrow ({reason})")
                break
            print(f"  failed {folder.name[:44]}: {error.code} {reason}")
            continue
        done += 1
        print(f"  described {folder.name[:60]}")
    print(f"\n{done} of {len(items)} described.")
    return 0


def main(argv: list[str]) -> int:
    """./bin/look — measure shots for library videos still on disk.

      ./bin/look                         # what would be done
      ./bin/look --apply [--limit 50]    # live weeks first, then the rest
      ./bin/look --apply --jobs a,b,c [--again]
      ./bin/look --describe [--limit 20] # one line per shot, vision model
    """
    from . import worker

    apply = "--apply" in argv
    arg = lambda name: argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else None
    user_config = config.load_user_config()
    cloud = worker.Cloud(arg("--cloud") or user_config["cloud_url"], user_config["worker_secret"])
    if "--describe" in argv:
        return describe(cloud, int(arg("--limit") or 20))
    if not config.LOOK_FRAME.exists():
        print("look-frame missing — run ./setup.sh (needs xcode-select --install)")
        return 1
    request: dict = {"need": True, "limit": int(arg("--limit") or 50)}
    if arg("--jobs"):
        request["jobs"] = arg("--jobs").split(",")
        request["again"] = "--again" in argv
    items = cloud.post("/api/worker/shots", request)["items"]
    pairs = [(row, config.DEFAULT_OUT_DIR / str(row.get("folder") or "")) for row in items]
    pairs = [(row, folder) for row, folder in pairs if row.get("folder") and (folder / "source.mp4").exists()]
    print(f"{len(items)} without a shot list, {len(pairs)} with the video on disk")
    if not apply:
        print("dry run — pass --apply to measure and post")
        return 0
    done = 0
    for row, folder in pairs:
        result = measure(folder)
        if not result:
            print(f"  skip {folder.name[:50]}: could not read")
            continue
        cloud.post("/api/worker/shots", {"job_id": row["job_id"], "shots": result})
        done += 1
        summary = " | ".join(f"{s['framing']}/{s['camera']}" + (f" {s['labels'][0]}" if s["labels"] and s["people"] == 0 else "")
                             for s in result["shots"])
        print(f"  {len(result['shots'])} shot{'s' if len(result['shots']) != 1 else ''}  {folder.name[:44]:<44} {summary[:70]}")
    print(f"\n{done} of {len(pairs)} measured.")
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(main(sys.argv[1:]))
