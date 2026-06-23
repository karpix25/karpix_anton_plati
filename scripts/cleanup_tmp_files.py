#!/usr/bin/env python3
import argparse
import os
import shutil
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
import psycopg2

load_dotenv(override=True)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Safely cleanup old generated media from /tmp."
    )
    parser.add_argument("--tmp-root", default="/tmp")
    parser.add_argument("--min-age-hours", type=float, default=24.0)
    parser.add_argument("--tts-min-age-days", type=float, default=7.0)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--allow-without-db", action="store_true")
    return parser.parse_args()


def connect_db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        database=os.getenv("DB_NAME", "postgres"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASS", ""),
        port=os.getenv("DB_PORT", "5432"),
    )


def load_referenced_paths():
    with connect_db() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT tts_audio_path, montage_video_path
                FROM generated_scenarios
                WHERE tts_audio_path IS NOT NULL
                   OR montage_video_path IS NOT NULL
                """
            )
            paths = set()
            for tts_path, montage_path in cursor.fetchall():
                for value in (tts_path, montage_path):
                    if value:
                        paths.add(str(Path(value).resolve()))
            return paths


def is_old(path, min_age_seconds):
    try:
        return time.time() - path.stat().st_mtime >= min_age_seconds
    except FileNotFoundError:
        return False


def is_inside(path, root):
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def remove_path(path, execute):
    if execute:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)
    print(("DELETE " if execute else "WOULD DELETE ") + str(path))


def prune_montage_dir(workdir, referenced_paths, execute):
    entries = list(workdir.iterdir())
    kept = []
    deleted = 0
    for entry in entries:
        resolved_entry = str(entry.resolve())
        if resolved_entry in referenced_paths:
            kept.append(entry)
            continue
        remove_path(entry, execute)
        deleted += 1

    should_remove_dir = not kept
    if execute and should_remove_dir:
        should_remove_dir = not any(workdir.iterdir())

    if should_remove_dir:
        remove_path(workdir, execute)
    elif deleted:
        print(f"KEEP DIR {workdir} (referenced files remain: {len(kept)})")


def cleanup_montage(root, min_age_seconds, referenced_paths, execute):
    montage_root = root / "platipo-miru-montage"
    if not montage_root.exists():
        return
    for workdir in sorted(montage_root.iterdir()):
        if workdir.is_dir() and is_old(workdir, min_age_seconds):
            prune_montage_dir(workdir, referenced_paths, execute)


def cleanup_reels(root, min_age_seconds, execute):
    for reel_path in sorted(root.glob("reel_*.mp4")):
        if reel_path.is_file() and is_old(reel_path, min_age_seconds):
            remove_path(reel_path, execute)


def cleanup_tts(root, min_age_seconds, referenced_paths, execute):
    candidates = list(root.glob("tts_*.mp3"))
    tts_dir = root / "platipo-miru-tts"
    if tts_dir.exists():
        candidates.extend(tts_dir.glob("*.mp3"))

    for tts_path in sorted(candidates):
        resolved_path = str(tts_path.resolve())
        if resolved_path in referenced_paths:
            print(f"KEEP REFERENCED {tts_path}")
            continue
        if tts_path.is_file() and is_old(tts_path, min_age_seconds):
            remove_path(tts_path, execute)


def main():
    args = parse_args()
    root = Path(args.tmp_root)
    if not root.exists() or not root.is_dir():
        raise SystemExit(f"tmp root does not exist: {root}")

    referenced_paths = set()
    try:
        referenced_paths = load_referenced_paths()
    except Exception as error:
        if args.execute and not args.allow_without_db:
            raise SystemExit(
                f"DB lookup failed; refusing execute cleanup: {error}"
            )
        print(f"WARNING: DB lookup failed, referenced paths unknown: {error}")

    if not is_inside(root / "platipo-miru-montage", root):
        raise SystemExit("Refusing unsafe tmp root")

    mode = "EXECUTE" if args.execute else "DRY RUN"
    print(f"Mode: {mode}")
    print(f"Referenced paths loaded: {len(referenced_paths)}")

    cleanup_montage(root, args.min_age_hours * 3600, referenced_paths, args.execute)
    cleanup_reels(root, args.min_age_hours * 3600, args.execute)
    cleanup_tts(
        root,
        args.tts_min_age_days * 24 * 3600,
        referenced_paths,
        args.execute,
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
