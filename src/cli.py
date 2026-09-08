"""Command-line entry point: one link, a folder of clips, or a whole batch file."""
from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

from . import config, library, media, pipeline

# Pasted lists routinely carry notes after a link ("<url> - make this into a video"),
# or several links on one line. Pull the URLs out rather than demanding clean input.
URL_PATTERN = re.compile(r"https?://\S+")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="transcribe",
        description="Transcribe Instagram / TikTok posts (or local videos) on-device, with speaker labels.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  transcribe https://www.instagram.com/reel/XXXX/\n"
            "  transcribe ~/Downloads/clip.mp4 --speakers 2\n"
            "  transcribe inbox/                 # every video in a folder\n"
            "  transcribe --batch links.txt      # one URL per line\n"
        ),
    )
    parser.add_argument("inputs", nargs="*", help="URLs, video files, or folders of videos")
    parser.add_argument("--batch", type=Path, help="text file of inputs, one per line")
    parser.add_argument("--out", type=Path, default=config.DEFAULT_OUT_DIR, help="output directory")
    parser.add_argument("--model", choices=sorted(config.ASR_MODELS), default="best",
                        help="'best' = large-v3-turbo, 'fast' = base (default: best)")
    parser.add_argument("--lang", default="auto", help="language code, or 'auto' (default)")
    parser.add_argument("--speakers", type=int, help="force an exact number of speakers")
    parser.add_argument("--no-speakers", action="store_true", help="skip speaker separation")
    parser.add_argument("--formats", default=",".join(config.DEFAULT_FORMATS),
                        help="comma list: md,txt,srt,vtt,json")
    parser.add_argument("--no-video", action="store_true", help="delete the video after transcribing")
    parser.add_argument("--keep-audio", action="store_true", help="keep the extracted 16k wav")
    parser.add_argument("--force", action="store_true", help="re-transcribe items already in the index")
    parser.add_argument("--list", action="store_true", help="print the transcript library and exit")
    return parser


def expand_inputs(args: argparse.Namespace) -> list[str]:
    """Flatten URLs, files, folders, and a batch file into an ordered, de-duplicated list."""
    raw: list[str] = list(args.inputs)
    if args.batch:
        if not args.batch.exists():
            raise SystemExit(f"batch file not found: {args.batch}")
        for line in args.batch.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            found = URL_PATTERN.findall(line)
            raw += found if found else [line]

    resolved: list[str] = []
    for item in raw:
        if media.is_url(item):
            resolved.append(media.normalize_url(item))
            continue
        path = Path(item).expanduser()
        if path.is_dir():
            resolved += [
                str(child) for child in sorted(path.iterdir())
                if child.suffix.lower() in media.MEDIA_SUFFIXES
            ]
        else:
            resolved.append(str(path))

    seen: set[str] = set()
    return [item for item in resolved if not (item in seen or seen.add(item))]


def show_library(out_dir: Path) -> int:
    records = library.load(out_dir)
    if not records:
        print(f"No transcripts yet in {out_dir}")
        return 0
    ordered = sorted(records.values(), key=lambda r: r.get("transcribed_at", ""), reverse=True)
    print(f"{len(ordered)} transcript(s) in {out_dir}\n")
    for record in ordered:
        print(f"  {record.get('transcribed_at','')[:10]}  "
              f"{(record.get('platform') or '-'):<10} "
              f"{(record.get('author') or '-'):<20} "
              f"{record.get('speaker_count', 0)} spk  "
              f"{record.get('word_count', 0):>5}w  {record.get('folder')}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    out_dir: Path = args.out.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.list:
        return show_library(out_dir)

    inputs = expand_inputs(args)
    if not inputs:
        build_parser().print_help()
        return 1

    options = pipeline.Options(
        out_dir=out_dir,
        model=args.model,
        language=args.lang,
        formats=tuple(f.strip() for f in args.formats.split(",") if f.strip()),
        num_speakers=args.speakers,
        diarization=not args.no_speakers,
        keep_video=not args.no_video,
        keep_audio=args.keep_audio,
        force=args.force,
    )
    user_config = config.load_user_config()
    done = library.load(out_dir)

    failures: list[tuple[str, str]] = []
    completed = 0
    for position, source in enumerate(inputs, start=1):
        label = source if len(source) <= 78 else source[:75] + "..."
        print(f"[{position}/{len(inputs)}] {label}")
        if not options.force and source in done:
            print(f"  already transcribed -> {done[source].get('folder')} (use --force to redo)")
            continue
        started = time.time()
        try:
            folder = pipeline.process(source, options, user_config, log=print)
        except Exception as exc:  # one bad item must never kill a bulk run
            print(f"  FAILED: {exc}\n")
            failures.append((source, str(exc).splitlines()[0]))
            continue
        completed += 1
        print(f"  done in {time.time() - started:.1f}s -> {folder}\n")

    print(f"Finished: {completed} transcribed, {len(failures)} failed, "
          f"{len(inputs) - completed - len(failures)} skipped.")
    for source, reason in failures:
        print(f"  ! {source}: {reason}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
