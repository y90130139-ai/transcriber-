"""Listen to videos that are already in the library but were never heard.

Everything fetched before 2026-09-03 could be added without a speech pass, so
those rows carry a poster, figures and tags but no answer to "does she talk in
this". `transcripts.has_speech is null` is exactly that set.

This re-transcribes them from the copy already on disk rather than re-fetching:
the video is right there, and a re-fetch would put a gated post at the mercy of
whatever Instagram thinks of the cookies today. The folder name is preserved,
because that is how the app addresses the video over the tunnel.

  ./bin/relisten                     # what would be done
  ./bin/relisten --apply
  ./bin/relisten --apply --cloud http://localhost:3000
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from . import asr, config, diarize, media, merge, pipeline, render, speakers, worker


def _folders(out_dir: Path, targets: list[dict]) -> list[tuple[dict, Path]]:
    found = []
    for row in targets:
        folder = out_dir / str(row.get("folder") or "")
        if not row.get("folder") or not folder.is_dir():
            print(f"  skip {row['job_id']}: no folder on disk")
            continue
        found.append((row, folder))
    return found


def relisten(folder: Path, options: pipeline.Options) -> dict:
    """Re-render every transcript file in place from the video already here."""
    video = next(
        (p for p in sorted(folder.iterdir()) if p.suffix.lower() in media.VIDEO_SUFFIXES),
        None,
    )
    if video is None:
        raise RuntimeError("no video in folder")

    transcript = asr.Transcript(language="", segments=(), model="none")
    wav: Path | None = None
    if media.has_audio(video):
        wav = media.extract_audio(video, folder / "audio.wav")
        transcript = asr.transcribe(
            wav, workdir=folder, model_key=options.model, language=options.language
        )

    turns = ()
    if transcript.segments and wav is not None and diarize.available():
        turns = diarize.diarize(wav, num_speakers=None)
    segments, order = merge.assign_speakers(transcript.segments, turns)
    profiles = speakers.build_profiles(wav, turns, order) if turns and wav else ()

    # Keep the metadata the original fetch captured — likes, caption, post id.
    # Only what was heard is being replaced.
    meta = json.loads((folder / "transcript.json").read_text()).get("meta", {})
    result = render.Result(
        meta=meta,
        transcript=transcript,
        segments=segments,
        blocks=merge.group_blocks(segments),
        profiles=profiles,
        created_at=render.now_stamp(),
        speech=pipeline._speech_report(
            transcript, meta.get("duration_sec"), checked=True
        ),
    )
    render.write_all(result, folder, options.formats)
    if wav is not None:
        wav.unlink(missing_ok=True)
    return result.speech


def main(argv: list[str]) -> int:
    apply = "--apply" in argv
    user_config = config.load_user_config()
    # --cloud points this at a locally built app, so the catch-up can be run
    # before the change that needs it has been deployed. Same database either way.
    base = user_config["cloud_url"]
    if "--cloud" in argv:
        base = argv[argv.index("--cloud") + 1]
    cloud = worker.Cloud(base, user_config["worker_secret"])
    out_dir = config.DEFAULT_OUT_DIR

    targets = cloud.post("/api/worker/unheard", {})["items"]
    pairs = _folders(out_dir, targets)
    print(f"{len(targets)} never listened to, {len(pairs)} with the video still on disk")
    if not apply:
        print("dry run — pass --apply to listen and post the results")
        return 0

    options = pipeline.Options(out_dir=out_dir)
    talking = 0
    for row, folder in pairs:
        try:
            speech = relisten(folder, options)
        except Exception as exc:
            print(f"  failed {folder.name}: {str(exc).splitlines()[0][:120]}")
            continue
        cloud.complete(worker._payload(row["job_id"], folder))
        talking += bool(speech["has_speech"])
        print(f"  {'talking' if speech['has_speech'] else 'no speech'}  {folder.name}")
    print(f"\n{talking} of {len(pairs)} turned out to have someone talking.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
