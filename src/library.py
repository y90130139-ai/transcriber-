"""A running index of everything transcribed, so bulk runs stay traceable."""
from __future__ import annotations

import json
from pathlib import Path

INDEX_NAME = "index.jsonl"
README_NAME = "INDEX.md"


def index_path(out_dir: Path) -> Path:
    return out_dir / INDEX_NAME


def load(out_dir: Path) -> dict[str, dict]:
    """Map source (URL or file path) -> record. Corrupt lines are skipped, not fatal."""
    path = index_path(out_dir)
    if not path.exists():
        return {}
    records: dict[str, dict] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        records[record.get("source", "")] = record
    return records


def save(out_dir: Path, records: dict[str, dict]) -> None:
    ordered = sorted(records.values(), key=lambda r: r.get("transcribed_at", ""), reverse=True)
    index_path(out_dir).write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in ordered)
    )
    _write_readme(out_dir, ordered)


def upsert(out_dir: Path, record: dict) -> None:
    records = load(out_dir)
    records[record["source"]] = record
    save(out_dir, records)


def _write_readme(out_dir: Path, ordered: list[dict]) -> None:
    lines = [
        "# Transcript library",
        "",
        f"{len(ordered)} item(s). Newest first. Each row links to its own folder.",
        "",
        "| Date | Platform | Creator | Title | Speakers | Lang | Folder |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for record in ordered:
        folder = record.get("folder", "")
        title = (record.get("title") or "").replace("|", "/")[:60]
        lines.append(
            "| {date} | {platform} | {creator} | {title} | {speakers} | {lang} | [{folder}]({folder}/transcript.md) |".format(
                date=record.get("transcribed_at", "")[:10],
                platform=record.get("platform", ""),
                creator=record.get("author") or "",
                title=title,
                speakers=record.get("speaker_count", 0),
                lang=record.get("language", ""),
                folder=folder,
            )
        )
    (out_dir / README_NAME).write_text("\n".join(lines) + "\n")
