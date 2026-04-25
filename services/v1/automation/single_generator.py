# Copyright (c) 2025 Stephen G. Pope
# Single Scenario Generator for Specific References
# Orchestrates Audit -> Scenario for a single item.

import argparse
import logging
import json
import os
import subprocess
import re
from services.v1.automation.pipeline_orchestrator import run_content_gen_pipeline
from services.v1.database.db_service import get_db_connection, init_db, choose_next_client_avatar_variant
from datetime import datetime, timezone

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("SingleGenerator")


SILENCE_TRIM_ENABLED = os.getenv("TTS_SILENCE_TRIM_ENABLED", "true").strip().lower() in {"1", "true", "yes"}
DEFAULT_SILENCE_TRIM_MIN_DURATION_SECONDS = float(os.getenv("TTS_SILENCE_TRIM_MIN_DURATION_SECONDS", "0.35"))
DEFAULT_SILENCE_TRIM_THRESHOLD_DB = float(os.getenv("TTS_SILENCE_TRIM_THRESHOLD_DB", "-45"))
DEFAULT_SENTENCE_TRIM_MIN_GAP_SECONDS = float(os.getenv("TTS_SENTENCE_TRIM_MIN_GAP_SECONDS", "0.3"))
DEFAULT_SENTENCE_TRIM_KEEP_GAP_SECONDS = float(os.getenv("TTS_SENTENCE_TRIM_KEEP_GAP_SECONDS", "0.1"))
DEFAULT_PAUSE_TRIM_SILENCE_MIN_DURATION_SECONDS = float(os.getenv("TTS_PAUSE_TRIM_SILENCE_MIN_DURATION_SECONDS", "0.06"))
DEFAULT_PAUSE_TRIM_SILENCE_THRESHOLD_DB = float(os.getenv("TTS_PAUSE_TRIM_SILENCE_THRESHOLD_DB", "-40"))
DEFAULT_PAUSE_TRIM_MIN_OVERLAP_SECONDS = float(os.getenv("TTS_PAUSE_TRIM_MIN_OVERLAP_SECONDS", "0.06"))
DEFAULT_PAUSE_TRIM_MAX_REMOVAL_SHARE = float(os.getenv("TTS_PAUSE_TRIM_MAX_REMOVAL_SHARE", "0.20"))
SENTENCE_END_RE = re.compile(r'[.!?…]+["»”)]*$')
SOFT_BOUNDARY_RE = re.compile(r'[,;:—-]+["»”)]*$')
SILENCE_START_RE = re.compile(r"silence_start:\s*([0-9]+(?:\.[0-9]+)?)")
SILENCE_END_RE = re.compile(r"silence_end:\s*([0-9]+(?:\.[0-9]+)?)")
SCRIPT_MIN_WORD_COUNT = 8


def _extract_valid_script_text(scenario: dict | None) -> str:
    if not isinstance(scenario, dict):
        return ""
    raw_script = scenario.get("script")
    if not isinstance(raw_script, str):
        return ""
    cleaned = re.sub(r"\s+", " ", raw_script).strip()
    if not cleaned:
        return ""

    lowered = cleaned.lower()
    if lowered in {"null", "none", "n/a", "nan"}:
        return ""
    if lowered.startswith("error ") or lowered.startswith("failed "):
        return ""

    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9]+", cleaned)
    if len(words) < SCRIPT_MIN_WORD_COUNT:
        return ""

    return cleaned


def _probe_audio_duration_seconds(file_path):
    if not file_path or not os.path.exists(file_path):
        return None

    try:
        raw = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                file_path,
            ],
            text=True,
        ).strip()
        duration = float(raw)
        return duration if duration > 0 else None
    except Exception:
        return None

def _merge_intervals(intervals: list[tuple[float, float]], gap_tolerance: float = 0.015) -> list[tuple[float, float]]:
    if not intervals:
        return []
    ordered = sorted(
        ((max(0.0, float(start)), max(0.0, float(end))) for start, end in intervals if end - start > 1e-6),
        key=lambda item: item[0],
    )
    if not ordered:
        return []
    merged: list[tuple[float, float]] = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end + gap_tolerance:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged

def _detect_silence_intervals(
    file_path: str | None,
    audio_duration: float | None = None,
    min_duration_seconds: float | None = None,
    threshold_db: float | None = None,
) -> list[tuple[float, float]]:
    if not file_path or not os.path.exists(file_path):
        return []

    resolved_min_duration = (
        min_duration_seconds if min_duration_seconds is not None else DEFAULT_PAUSE_TRIM_SILENCE_MIN_DURATION_SECONDS
    )
    try:
        resolved_min_duration = float(resolved_min_duration)
    except (TypeError, ValueError):
        resolved_min_duration = DEFAULT_PAUSE_TRIM_SILENCE_MIN_DURATION_SECONDS
    resolved_min_duration = max(0.03, min(0.5, resolved_min_duration))

    resolved_threshold = threshold_db if threshold_db is not None else DEFAULT_PAUSE_TRIM_SILENCE_THRESHOLD_DB
    try:
        resolved_threshold = float(resolved_threshold)
    except (TypeError, ValueError):
        resolved_threshold = DEFAULT_PAUSE_TRIM_SILENCE_THRESHOLD_DB
    resolved_threshold = max(-80.0, min(-15.0, resolved_threshold))

    try:
        output = subprocess.check_output(
            [
                "ffmpeg",
                "-hide_banner",
                "-i",
                file_path,
                "-af",
                f"silencedetect=noise={resolved_threshold}dB:d={resolved_min_duration}",
                "-f",
                "null",
                "-",
            ],
            stderr=subprocess.STDOUT,
            text=True,
        )
    except Exception as error:
        logger.warning("silencedetect failed for %s: %s", file_path, error)
        return []

    intervals: list[tuple[float, float]] = []
    current_start: float | None = None
    for line in output.splitlines():
        start_match = SILENCE_START_RE.search(line)
        if start_match:
            try:
                current_start = max(0.0, float(start_match.group(1)))
            except (TypeError, ValueError):
                current_start = None
            continue

        end_match = SILENCE_END_RE.search(line)
        if end_match and current_start is not None:
            try:
                silence_end = max(0.0, float(end_match.group(1)))
            except (TypeError, ValueError):
                current_start = None
                continue
            if silence_end - current_start >= resolved_min_duration:
                intervals.append((current_start, silence_end))
            current_start = None

    if current_start is not None and audio_duration and audio_duration > current_start:
        if audio_duration - current_start >= resolved_min_duration:
            intervals.append((current_start, audio_duration))

    return _merge_intervals(intervals, gap_tolerance=0.02)

def _refine_removal_intervals_with_silence(
    removal_intervals: list[tuple[float, float]],
    silence_intervals: list[tuple[float, float]],
    min_overlap_seconds: float | None = None,
) -> list[tuple[float, float]]:
    if not removal_intervals or not silence_intervals:
        return []
    resolved_min_overlap = (
        min_overlap_seconds if min_overlap_seconds is not None else DEFAULT_PAUSE_TRIM_MIN_OVERLAP_SECONDS
    )
    try:
        resolved_min_overlap = float(resolved_min_overlap)
    except (TypeError, ValueError):
        resolved_min_overlap = DEFAULT_PAUSE_TRIM_MIN_OVERLAP_SECONDS
    resolved_min_overlap = max(0.03, min(0.3, resolved_min_overlap))

    refined: list[tuple[float, float]] = []
    for remove_start, remove_end in removal_intervals:
        best_interval: tuple[float, float] | None = None
        best_len = 0.0
        for silence_start, silence_end in silence_intervals:
            overlap_start = max(remove_start, silence_start)
            overlap_end = min(remove_end, silence_end)
            overlap_len = overlap_end - overlap_start
            if overlap_len >= resolved_min_overlap and overlap_len > best_len:
                best_interval = (overlap_start, overlap_end)
                best_len = overlap_len
        if best_interval:
            refined.append(best_interval)

    return _merge_intervals(refined, gap_tolerance=0.01)

def _trim_tts_silence(
    file_path: str | None,
    min_duration_seconds: float | None = None,
    threshold_db: float | None = None,
) -> str | None:
    if not file_path or not os.path.exists(file_path) or not SILENCE_TRIM_ENABLED:
        return file_path

    resolved_min_duration = min_duration_seconds if min_duration_seconds is not None else DEFAULT_SILENCE_TRIM_MIN_DURATION_SECONDS
    try:
        resolved_min_duration = float(resolved_min_duration)
    except (TypeError, ValueError):
        resolved_min_duration = DEFAULT_SILENCE_TRIM_MIN_DURATION_SECONDS
    resolved_min_duration = max(0.0, min(1.0, resolved_min_duration))

    resolved_threshold = threshold_db if threshold_db is not None else DEFAULT_SILENCE_TRIM_THRESHOLD_DB
    try:
        resolved_threshold = float(resolved_threshold)
    except (TypeError, ValueError):
        resolved_threshold = DEFAULT_SILENCE_TRIM_THRESHOLD_DB
    resolved_threshold = max(-80.0, min(-20.0, resolved_threshold))

    root, ext = os.path.splitext(file_path)
    trimmed_path = f"{root}_trimmed{ext}" if ext else f"{file_path}_trimmed"
    filter_expr = (
        "silenceremove="
        f"start_periods=1:start_duration={resolved_min_duration}:start_threshold={resolved_threshold}dB:"
        f"stop_periods=-1:stop_duration={resolved_min_duration}:stop_threshold={resolved_threshold}dB:"
        "start_silence=0.08:stop_silence=0.10"
    )

    try:
        subprocess.check_output(
            [
                "ffmpeg",
                "-y",
                "-i",
                file_path,
                "-af",
                filter_expr,
                "-c:a",
                "libmp3lame",
                "-q:a",
                "4",
                trimmed_path,
            ],
            stderr=subprocess.STDOUT,
            text=True,
        )
        if os.path.exists(trimmed_path) and os.path.getsize(trimmed_path) > 0:
            original_duration = _probe_audio_duration_seconds(file_path)
            trimmed_duration = _probe_audio_duration_seconds(trimmed_path)
            if trimmed_duration and original_duration and trimmed_duration <= original_duration - 0.05:
                return trimmed_path
            if trimmed_duration and not original_duration:
                return trimmed_path
    except Exception as error:
        logger.warning("Silence trim failed for %s: %s", file_path, error)

    return file_path

def _is_sentence_end(punctuated_word: str | None) -> bool:
    if not punctuated_word:
        return False
    return bool(SENTENCE_END_RE.search(str(punctuated_word).strip()))

def _build_timing_safe_removal_intervals(
    words: list[dict],
    min_gap_seconds: float,
    keep_gap_seconds: float,
) -> list[tuple[float, float]]:
    intervals: list[tuple[float, float]] = []
    if not words:
        return intervals

    resolved_min_gap = max(0.0, min(2.0, float(min_gap_seconds)))
    resolved_keep_gap = max(0.08, min(0.5, float(keep_gap_seconds))) # Keep at least a small natural gap for safety

    for idx in range(len(words) - 1):
        current = words[idx]
        nxt = words[idx + 1]
        try:
            start_time = float(current.get("start", 0))
            end_time = float(current.get("end", 0))
            next_start = float(nxt.get("start", 0))
            next_end = float(nxt.get("end", 0))
        except (TypeError, ValueError):
            continue
        
        gap = next_start - end_time
        if gap < resolved_min_gap:
            continue

        boundary_word = (current.get("punctuated_word") or current.get("word") or "").strip()
        is_sentence_end = _is_sentence_end(boundary_word)
        is_soft_boundary = bool(SOFT_BOUNDARY_RE.search(boundary_word))

        # Dynamic target gap based on punctuation
        if is_sentence_end:
            target_keep_gap = resolved_keep_gap # e.g. 0.3s
        elif is_soft_boundary:
            target_keep_gap = max(0.22, resolved_keep_gap * 0.75) # keep safer pauses around commas/semicolons
        else:
            target_keep_gap = max(0.16, resolved_keep_gap * 0.6) # keep safer internal pauses to protect consonant attacks

        # Improved guards to prevent clipping first/last phonemes
        # We increase the guard for the start of the next word to avoid cutting "breaths" or sharp starts
        previous_word_duration = max(0.04, min(1.0, end_time - start_time))
        next_word_duration = max(0.04, min(1.0, next_end - next_start))
        
        tail_guard = min(0.14, max(0.06, previous_word_duration * 0.22))
        head_guard = min(0.18, max(0.09, next_word_duration * 0.30))
        
        available_gap = gap - tail_guard - head_guard

        if available_gap <= target_keep_gap + 0.08:
            continue

        extra_keep_gap = max(0.0, target_keep_gap - (tail_guard + head_guard))
        # Keep more space after sentence ends
        tail_keep_ratio = 0.6 if is_sentence_end else 0.5
        
        keep_tail = tail_guard + (extra_keep_gap * tail_keep_ratio)
        keep_head = head_guard + (extra_keep_gap * (1.0 - tail_keep_ratio))
        
        remove_start = end_time + keep_tail
        remove_end = next_start - keep_head
        
        if remove_end - remove_start >= 0.08:
            intervals.append((remove_start, remove_end))
            
    return intervals

def _trim_sentence_gaps(
    file_path: str | None,
    words: list[dict],
    min_gap_seconds: float | None,
    keep_gap_seconds: float | None,
    enabled: bool,
) -> tuple[str | None, list[dict]]:
    if not enabled or not file_path or not os.path.exists(file_path) or not words:
        return file_path, words

    resolved_min_gap = min_gap_seconds if min_gap_seconds is not None else DEFAULT_SENTENCE_TRIM_MIN_GAP_SECONDS
    resolved_keep_gap = keep_gap_seconds if keep_gap_seconds is not None else DEFAULT_SENTENCE_TRIM_KEEP_GAP_SECONDS
    try:
        resolved_min_gap = float(resolved_min_gap)
    except (TypeError, ValueError):
        resolved_min_gap = DEFAULT_SENTENCE_TRIM_MIN_GAP_SECONDS
    try:
        resolved_keep_gap = float(resolved_keep_gap)
    except (TypeError, ValueError):
        resolved_keep_gap = DEFAULT_SENTENCE_TRIM_KEEP_GAP_SECONDS

    removal_intervals = _build_timing_safe_removal_intervals(words, resolved_min_gap, resolved_keep_gap)
    if not removal_intervals:
        return file_path, words

    for word in words:
        try:
            w_start = float(word.get("start", 0))
            w_end = float(word.get("end", 0))
        except (TypeError, ValueError):
            continue
        for r_start, r_end in removal_intervals:
            if w_start < r_end and w_end > r_start:
                return file_path, words

    audio_duration = _probe_audio_duration_seconds(file_path)
    if audio_duration is None:
        try:
            audio_duration = max(float(w.get("end", 0)) for w in words)
        except Exception:
            audio_duration = None
    if not audio_duration or audio_duration <= 0:
        return file_path, words

    silence_intervals = _detect_silence_intervals(file_path, audio_duration=audio_duration)
    if not silence_intervals:
        return file_path, words

    removal_intervals = _refine_removal_intervals_with_silence(removal_intervals, silence_intervals)
    if not removal_intervals:
        return file_path, words

    max_removal_share = max(0.05, min(0.5, float(DEFAULT_PAUSE_TRIM_MAX_REMOVAL_SHARE)))
    total_removed = sum(max(0.0, end - start) for start, end in removal_intervals)
    if total_removed <= 0.03:
        return file_path, words
    if total_removed > audio_duration * max_removal_share:
        logger.info(
            "Skip sentence trim for %s: planned removal %.3fs exceeds %.0f%% of audio %.3fs",
            file_path,
            total_removed,
            max_removal_share * 100,
            audio_duration,
        )
        return file_path, words

    segments: list[tuple[float, float]] = []
    cursor = 0.0
    for r_start, r_end in removal_intervals:
        keep_end = max(cursor, min(r_start, audio_duration))
        if keep_end - cursor >= 0.02:
            segments.append((cursor, keep_end))
        cursor = max(cursor, min(r_end, audio_duration))
    if audio_duration - cursor >= 0.02:
        segments.append((cursor, audio_duration))

    if len(segments) <= 1:
        return file_path, words

    root, ext = os.path.splitext(file_path)
    trimmed_path = f"{root}_senttrim{ext}" if ext else f"{file_path}_senttrim"
    filter_parts = []
    concat_inputs = []
    for idx, (start, end) in enumerate(segments):
        filter_parts.append(
            f"[0:a]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[a{idx}]"
        )
        concat_inputs.append(f"[a{idx}]")
    filter_parts.append(f"{''.join(concat_inputs)}concat=n={len(segments)}:v=0:a=1[out]")
    filter_complex = ";".join(filter_parts)

    try:
        subprocess.check_output(
            [
                "ffmpeg",
                "-y",
                "-i",
                file_path,
                "-filter_complex",
                filter_complex,
                "-map",
                "[out]",
                "-c:a",
                "libmp3lame",
                "-q:a",
                "4",
                trimmed_path,
            ],
            stderr=subprocess.STDOUT,
            text=True,
        )
        if not os.path.exists(trimmed_path) or os.path.getsize(trimmed_path) == 0:
            return file_path, words
    except Exception as error:
        logger.warning("Sentence gap trim failed for %s: %s", file_path, error)
        return file_path, words

    adjusted_words = []
    removal_intervals_sorted = sorted(removal_intervals, key=lambda item: item[0])
    interval_idx = 0
    removed_cumulative = 0.0
    for word in words:
        try:
            w_start = float(word.get("start", 0))
            w_end = float(word.get("end", 0))
        except (TypeError, ValueError):
            adjusted_words.append(word)
            continue
        while interval_idx < len(removal_intervals_sorted) and w_start >= removal_intervals_sorted[interval_idx][1] - 1e-6:
            r_start, r_end = removal_intervals_sorted[interval_idx]
            removed_cumulative += max(0.0, r_end - r_start)
            interval_idx += 1
        new_start = max(0.0, w_start - removed_cumulative)
        new_end = max(new_start, w_end - removed_cumulative)
        updated = dict(word)
        updated["start"] = round(new_start, 2)
        updated["end"] = round(new_end, 2)
        adjusted_words.append(updated)

    return trimmed_path, adjusted_words

def _load_json_if_needed(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value or {}

def generate_for_content(content_id, client_id=None, generate_video=False, generation_source="manual"):
    """
    Triggers generation of a rewritten scenario for a specific content record.
    Saves the result to the generated_scenarios table to avoid duplicating references.
    """
    logger.info(f"Triggering generation for Content {content_id}")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get content details
        query = "SELECT job_id, transcript, audit_json, niche, client_id, reels_url, target_product_info FROM processed_content WHERE id = %s"
        cursor.execute(query, (content_id,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row:
            logger.error(f"Content {content_id} not found in database.")
            return None
            
        base_job_id, transcript, audit_json_raw, niche, content_client_id, reels_url, target_product_info = row
        resolved_client_id = client_id or content_client_id
        
        audit_json = _load_json_if_needed(audit_json_raw)
        
        from services.v1.database.db_service import get_client, save_generated_scenario
        brand_voice = None
        target_audience = None
        target_duration_seconds = None
        target_duration_min_seconds = None
        target_duration_max_seconds = None
        broll_interval_seconds = None
        broll_timing_mode = None
        broll_pacing_profile = None
        broll_pause_threshold_seconds = None
        broll_coverage_percent = None
        broll_semantic_relevance_priority = None
        broll_product_clip_policy = None
        broll_generator_model = None
        product_media_assets = None
        product_keyword = None
        product_video_url = None
        tts_provider = "minimax"
        tts_voice_id = None
        elevenlabs_voice_id = None
        tts_pronunciation_overrides = None
        tts_silence_trim_min_duration_seconds = None
        tts_silence_trim_threshold_db = None
        tts_silence_trim_enabled = None
        tts_sentence_trim_enabled = None
        tts_sentence_trim_min_gap_seconds = None
        tts_sentence_trim_keep_gap_seconds = None
        learned_rules_scenario = None
        learned_rules_visual = None
        learned_rules_video = None
        
        if resolved_client_id:
            client_data = get_client(client_id=resolved_client_id)
            if client_data:
                brand_voice = client_data.get("brand_voice")
                target_audience = client_data.get("target_audience")
                target_product_info = target_product_info or client_data.get("product_info")
                target_duration_seconds = client_data.get("target_duration_seconds")
                target_duration_min_seconds = client_data.get("target_duration_min_seconds")
                target_duration_max_seconds = client_data.get("target_duration_max_seconds")
                broll_interval_seconds = client_data.get("broll_interval_seconds")
                broll_timing_mode = client_data.get("broll_timing_mode")
                broll_pacing_profile = client_data.get("broll_pacing_profile")
                broll_pause_threshold_seconds = client_data.get("broll_pause_threshold_seconds")
                broll_coverage_percent = client_data.get("broll_coverage_percent")
                broll_semantic_relevance_priority = client_data.get("broll_semantic_relevance_priority")
                broll_product_clip_policy = client_data.get("broll_product_clip_policy")
                broll_generator_model = client_data.get("broll_generator_model")
                product_media_assets = client_data.get("product_media_assets")
                product_keyword = client_data.get("product_keyword")
                product_video_url = client_data.get("product_video_url")
                tts_provider = client_data.get("tts_provider") or "minimax"
                tts_voice_id = client_data.get("tts_voice_id")
                elevenlabs_voice_id = client_data.get("elevenlabs_voice_id")
                tts_pronunciation_overrides = client_data.get("tts_pronunciation_overrides")
                tts_silence_trim_min_duration_seconds = client_data.get("tts_silence_trim_min_duration_seconds")
                tts_silence_trim_threshold_db = client_data.get("tts_silence_trim_threshold_db")
                tts_silence_trim_enabled = client_data.get("tts_silence_trim_enabled")
                tts_sentence_trim_enabled = client_data.get("tts_sentence_trim_enabled")
                tts_sentence_trim_min_gap_seconds = client_data.get("tts_sentence_trim_min_gap_seconds")
                tts_sentence_trim_keep_gap_seconds = client_data.get("tts_sentence_trim_keep_gap_seconds")
                learned_rules_scenario = client_data.get("learned_rules_scenario")
                learned_rules_visual = client_data.get("learned_rules_visual")
                learned_rules_video = client_data.get("learned_rules_video")
                
        # Only rewrite the scenario, bypassing the ingestion and transcription phases
        from services.v1.automation.scenario_service import (
            rewrite_reference_script,
            find_unshowable_asset_reference_issues,
            normalize_narrator_gender,
        )
        from services.v1.automation.notifier_service import notify_service_payment_issue
        import uuid
        
        logger.info(f"Rewriting scenario for Content {content_id}")
        
        # Get active avatar gender for Russian grammar agreement
        active_avatar = choose_next_client_avatar_variant(resolved_client_id)
        gender = normalize_narrator_gender(active_avatar.get("gender") if active_avatar else None)
        logger.info(
            "Using narrator gender=%s for content_id=%s avatar=%s",
            gender,
            content_id,
            active_avatar.get("avatar_name") if active_avatar else "default",
        )
        selected_tts_provider = tts_provider
        selected_tts_voice_id = tts_voice_id
        selected_elevenlabs_voice_id = elevenlabs_voice_id
        if active_avatar:
            avatar_tts_provider = active_avatar.get("tts_provider")
            if avatar_tts_provider in {"minimax", "elevenlabs"}:
                selected_tts_provider = avatar_tts_provider
            if selected_tts_provider == "elevenlabs":
                selected_elevenlabs_voice_id = active_avatar.get("elevenlabs_voice_id") or selected_elevenlabs_voice_id
            else:
                selected_tts_voice_id = active_avatar.get("tts_voice_id") or selected_tts_voice_id
        
        scenario_json = rewrite_reference_script(
            transcript=transcript,
            audit_json=audit_json,
            niche=niche,
            target_product_info=target_product_info,
            brand_voice=brand_voice,
            target_audience=target_audience,
            target_duration_seconds=target_duration_seconds,
            target_duration_min_seconds=target_duration_min_seconds,
            target_duration_max_seconds=target_duration_max_seconds,
            learned_rules_scenario=learned_rules_scenario,
            gender=gender,
        )
        
        import uuid
        res_job_id = f"{base_job_id or 'single'}_v1_{uuid.uuid4().hex[:4]}"

        from services.v1.automation.scenario_service import prepare_for_tts
        from services.v1.providers.minimax_service import prepare_text_for_minimax_tts, text_to_speech_minimax
        from services.v1.providers.elevenlabs_service import DEFAULT_ELEVENLABS_VOICE_ID, prepare_text_for_elevenlabs_tts, text_to_speech_elevenlabs
        from services.v1.transcription.deepgram_service import build_fallback_transcript_alignment, transcribe_media_deepgram
        from services.v1.automation.visual_keyword_service import extract_visual_keyword_segments
        from services.v1.automation.video_prompt_service import generate_seedance_prompts

        script_text = _extract_valid_script_text(scenario_json)
        if not script_text:
            logger.error(
                "Skipping save for single scenario %s because generator returned empty/invalid script payload",
                res_job_id,
            )
            return {"status": "error", "message": "Scenario generation returned invalid script", "job_id": res_job_id}

        asset_reference_issues = find_unshowable_asset_reference_issues(script_text)
        if asset_reference_issues:
            logger.error(
                "Skipping save for single scenario %s because script contains unsupported demonstrative asset references: %s",
                res_job_id,
                asset_reference_issues,
            )
            return {
                "status": "error",
                "message": "Scenario contains unsupported demonstrative references to unseen assets",
                "job_id": res_job_id,
            }

        tts_script = prepare_for_tts(script_text) if script_text else ""
        tts_audio_path = None
        tts_word_timestamps = None
        video_keyword_segments = None
        video_generation_prompts = None

        tts_request_text = None
        tts_audio_duration_seconds = None

        if tts_script:
            try:
                if selected_tts_provider == "elevenlabs":
                    tts_request_text = prepare_text_for_elevenlabs_tts(
                        tts_script,
                        pronunciation_overrides=tts_pronunciation_overrides,
                    )
                    tts_audio_path = text_to_speech_elevenlabs(
                        tts_script,
                        voice_id=selected_elevenlabs_voice_id or DEFAULT_ELEVENLABS_VOICE_ID,
                        pronunciation_overrides=tts_pronunciation_overrides,
                    )
                else:
                    tts_request_text = prepare_text_for_minimax_tts(
                        tts_script,
                        pronunciation_overrides=tts_pronunciation_overrides,
                    )
                    tts_audio_path = text_to_speech_minimax(
                        tts_script,
                        voice_id=selected_tts_voice_id or None,
                        pronunciation_overrides=tts_pronunciation_overrides,
                    )
                if tts_silence_trim_enabled is None:
                    tts_silence_trim_enabled = SILENCE_TRIM_ENABLED
                # Do not stack amplitude-based trim and word-timestamp trim together.
                should_run_silence_trim = (
                    bool(tts_silence_trim_enabled)
                    and not bool(tts_sentence_trim_enabled)
                )
                if should_run_silence_trim:
                    tts_audio_path = _trim_tts_silence(
                        tts_audio_path,
                        tts_silence_trim_min_duration_seconds,
                        tts_silence_trim_threshold_db,
                    )
                tts_audio_duration_seconds = _probe_audio_duration_seconds(tts_audio_path)
                try:
                    deepgram_result = transcribe_media_deepgram(tts_audio_path)
                except Exception as deepgram_error:
                    logger.warning(
                        "Deepgram unavailable for single scenario %s, using fallback transcript alignment: %s",
                        res_job_id,
                        deepgram_error,
                    )
                    deepgram_result = build_fallback_transcript_alignment(tts_script)
                tts_word_timestamps = {
                    "transcript": deepgram_result.get("transcript", ""),
                    "words": deepgram_result.get("words", []),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "is_fallback": bool(deepgram_result.get("is_fallback", False)),
                }
                effective_words = deepgram_result.get("words", [])
                if tts_sentence_trim_enabled and not deepgram_result.get("is_fallback"):
                    tts_audio_path, adjusted_words = _trim_sentence_gaps(
                        tts_audio_path,
                        deepgram_result.get("words", []),
                        tts_sentence_trim_min_gap_seconds,
                        tts_sentence_trim_keep_gap_seconds,
                        True,
                    )
                    tts_audio_duration_seconds = _probe_audio_duration_seconds(tts_audio_path)
                    tts_word_timestamps["words"] = adjusted_words
                    effective_words = adjusted_words
                video_keyword_segments = extract_visual_keyword_segments(
                    scenario_text=script_text,
                    tts_text=tts_script,
                    transcript=deepgram_result.get("transcript", ""),
                    words=effective_words,
                    broll_interval_seconds=broll_interval_seconds,
                    broll_timing_mode=broll_timing_mode,
                    broll_pacing_profile=broll_pacing_profile,
                    broll_pause_threshold_seconds=broll_pause_threshold_seconds,
                    broll_coverage_percent=broll_coverage_percent,
                    broll_semantic_relevance_priority=broll_semantic_relevance_priority,
                    broll_product_clip_policy=broll_product_clip_policy,
                    product_keyword=product_keyword,
                    product_video_url=product_video_url,
                    product_media_assets=product_media_assets,
                    learned_rules_visual=learned_rules_visual,
                )
                video_generation_prompts = generate_seedance_prompts(
                    scenario_text=script_text,
                    tts_text=tts_script,
                    keyword_segments=(video_keyword_segments or {}).get("segments", []),
                    generator_model=broll_generator_model,
                    learned_rules_video=learned_rules_video,
                )
            except Exception as media_error:
                logger.error(f"Failed to auto-generate media pipeline for single scenario {res_job_id}: {media_error}")
                notify_service_payment_issue(resolved_client_id, f"TTS/{selected_tts_provider}", media_error)
        
        save_generated_scenario(
            job_id=res_job_id,
            client_id=resolved_client_id,
            source_content_id=content_id,
            niche=niche,
            mode="rewrite",
            topic=scenario_json.get("topic_cluster"),
            angle=scenario_json.get("topic_angle"),
            generation_source=generation_source,
            scenario_json=scenario_json,
            tts_script=tts_script,
            tts_request_text=tts_request_text,
            tts_audio_path=tts_audio_path,
            tts_audio_duration_seconds=tts_audio_duration_seconds,
            tts_word_timestamps=tts_word_timestamps,
            video_keyword_segments=video_keyword_segments,
            video_generation_prompts=video_generation_prompts,
            heygen_avatar_id=active_avatar.get("avatar_id") if active_avatar else None,
            heygen_avatar_name=active_avatar.get("avatar_name") if active_avatar else None,
            heygen_look_id=(active_avatar.get("look") or {}).get("look_id") if active_avatar else None,
            heygen_look_name=(active_avatar.get("look") or {}).get("look_name") if active_avatar else None,
            background_audio_tag="neutral",
        )
        
        logger.info(f"Successfully saved rewritten scenario to generated_scenarios with job_id={res_job_id}")
        
        return {
            "status": "success",
            "job_id": res_job_id,
            "scenario": scenario_json
        }
        
    except Exception as e:
        logger.error(f"Failed to generate for content {content_id}: {e}")
        return None

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Single Scenario Generator")
    parser.add_argument("--content_id", type=int, required=True, help="ID of the content to process")
    parser.add_argument("--client_id", type=int, help="Optional client ID for context")
    parser.add_argument("--generation_source", type=str, default="manual", choices=["manual", "auto"], help="Generation source tag")
    
    args = parser.parse_args()
    
    init_db()
    res = generate_for_content(args.content_id, args.client_id, generation_source=args.generation_source)
    if res:
        print(json.dumps(res, ensure_ascii=False))
