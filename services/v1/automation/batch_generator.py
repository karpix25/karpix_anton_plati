import os
import sys
import json
import logging
import argparse
import subprocess
import re
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv(override=True)

import uuid
from services.v1.automation.scenario_service import (
    rewrite_reference_script,
    generate_scenario,
    generate_clustered_scenario,
    generate_from_topic_and_structure,
    find_unshowable_asset_reference_issues,
    prepare_for_tts,
)
from services.v1.automation.visual_keyword_service import extract_visual_keyword_segments
from services.v1.automation.video_prompt_service import generate_seedance_prompts
from services.v1.automation.notifier_service import notify_service_payment_issue
from services.v1.database.db_service import (
    get_db_connection,
    get_client,
    init_db,
    get_topic_card,
    get_structure_card,
    get_random_topic_card,
    get_random_topic_family_card,
    get_random_structure_card,
    get_random_compatible_pair,
    get_random_compatible_family_pair,
    get_references_by_niche,
    get_references_by_topic,
    get_references_by_angle,
    save_content_data,
    save_generated_scenario,
    choose_next_client_avatar_variant,
)
from services.v1.providers.minimax_service import prepare_text_for_minimax_tts, text_to_speech_minimax
from services.v1.providers.elevenlabs_service import DEFAULT_ELEVENLABS_VOICE_ID, prepare_text_for_elevenlabs_tts, text_to_speech_elevenlabs
from services.v1.transcription.deepgram_service import build_fallback_transcript_alignment, transcribe_media_deepgram

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


SILENCE_TRIM_ENABLED = os.getenv("TTS_SILENCE_TRIM_ENABLED", "true").strip().lower() in {"1", "true", "yes"}
DEFAULT_SILENCE_TRIM_MIN_DURATION_SECONDS = float(os.getenv("TTS_SILENCE_TRIM_MIN_DURATION_SECONDS", "0.35"))
DEFAULT_SILENCE_TRIM_THRESHOLD_DB = float(os.getenv("TTS_SILENCE_TRIM_THRESHOLD_DB", "-45"))
DEFAULT_SENTENCE_TRIM_MIN_GAP_SECONDS = float(os.getenv("TTS_SENTENCE_TRIM_MIN_GAP_SECONDS", "0.3"))
DEFAULT_SENTENCE_TRIM_KEEP_GAP_SECONDS = float(os.getenv("TTS_SENTENCE_TRIM_KEEP_GAP_SECONDS", "0.1"))
SENTENCE_END_RE = re.compile(r'[.!?…]+["»”)]*$')


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
        f"stop_periods=-1:stop_duration={resolved_min_duration}:stop_threshold={resolved_threshold}dB"
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

def _build_sentence_removal_intervals(
    words: list[dict],
    min_gap_seconds: float,
    keep_gap_seconds: float,
) -> list[tuple[float, float]]:
    intervals: list[tuple[float, float]] = []
    if not words:
        return intervals

    resolved_min_gap = max(0.0, min(2.0, float(min_gap_seconds)))
    resolved_keep_gap = max(0.0, min(0.5, float(keep_gap_seconds)))

    for idx in range(len(words) - 1):
        current = words[idx]
        nxt = words[idx + 1]
        if not _is_sentence_end(current.get("punctuated_word") or current.get("word")):
            continue
        try:
            end_time = float(current.get("end", 0))
            next_start = float(nxt.get("start", 0))
        except (TypeError, ValueError):
            continue
        gap = next_start - end_time
        if gap < resolved_min_gap:
            continue
        if gap <= resolved_keep_gap + 0.02:
            continue
        keep_tail = min(resolved_keep_gap * 0.5, gap)
        keep_head = max(0.0, resolved_keep_gap - keep_tail)
        remove_start = end_time + keep_tail
        remove_end = next_start - keep_head
        if remove_end - remove_start >= 0.04:
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

    removal_intervals = _build_sentence_removal_intervals(words, resolved_min_gap, resolved_keep_gap)
    if not removal_intervals:
        return file_path, words

    # Safety: if any word overlaps a planned removal interval, skip trimming.
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

    # Adjust word timestamps
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

def get_reference_pool(niche="General", client_id=None, topic=None, angle=None):
    """
    Fetches a pool of references based on niche, topic, or angle.
    """
    if topic:
        return get_references_by_topic(topic, client_id)
    if angle:
        return get_references_by_angle(angle, client_id)
    return get_references_by_niche(niche, client_id)

def run_batch_generation(count=1, client_id=1, niche="General", topic=None, angle=None, mode="rewrite", topic_id=None, structure_id=None, generation_source="manual"):
    """
    Main entry point for batch generation.
    """
    client = get_client(client_id)
    if not client:
        raise ValueError(f"Client with ID {client_id} not found.")

    target_product_info = client.get("product_info")
    brand_voice = client.get("brand_voice")
    target_audience = client.get("target_audience")
    target_duration_seconds = client.get("target_duration_seconds")
    target_duration_min_seconds = client.get("target_duration_min_seconds")
    target_duration_max_seconds = client.get("target_duration_max_seconds")
    broll_interval_seconds = client.get("broll_interval_seconds")
    broll_timing_mode = client.get("broll_timing_mode")
    broll_pacing_profile = client.get("broll_pacing_profile")
    broll_pause_threshold_seconds = client.get("broll_pause_threshold_seconds")
    broll_coverage_percent = client.get("broll_coverage_percent")
    broll_semantic_relevance_priority = client.get("broll_semantic_relevance_priority")
    broll_product_clip_policy = client.get("broll_product_clip_policy")
    broll_generator_model = client.get("broll_generator_model")
    product_media_assets = client.get("product_media_assets")
    product_keyword = client.get("product_keyword")
    product_video_url = client.get("product_video_url")
    tts_provider = client.get("tts_provider") or "minimax"
    tts_voice_id = client.get("tts_voice_id")
    elevenlabs_voice_id = client.get("elevenlabs_voice_id")
    tts_silence_trim_min_duration_seconds = client.get("tts_silence_trim_min_duration_seconds")
    tts_silence_trim_threshold_db = client.get("tts_silence_trim_threshold_db")
    tts_silence_trim_enabled = client.get("tts_silence_trim_enabled")
    tts_sentence_trim_enabled = client.get("tts_sentence_trim_enabled")
    tts_sentence_trim_min_gap_seconds = client.get("tts_sentence_trim_min_gap_seconds")
    learned_rules_scenario = client.get("learned_rules_scenario")
    learned_rules_visual = client.get("learned_rules_visual")
    learned_rules_video = client.get("learned_rules_video")

    # Get references
    ranked_references = get_reference_pool(niche=niche, client_id=client_id, topic=topic, angle=angle)
    
    # Get active avatar gender for Russian grammar agreement
    active_avatar = choose_next_client_avatar_variant(client_id)
    gender = active_avatar.get("gender", "female") if active_avatar else "female"
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
    
    # In cluster mode, we use multiple references at once
    cluster_references = ranked_references if mode == "cluster" else []
    
    # For rewrite and single modes, we limit by the available references
    count = min(count, len(ranked_references)) if mode != "mix" else count
    
    if count == 0 and mode != "mix":
        logger.warning(f"No references found for niche '{niche}' and client {client_id}. Cannot run {mode} generation.")
        return []

    generated_scenarios = []
    
    for i in range(count):
        ref = ranked_references[i % len(ranked_references)] if ranked_references else None
        if ref:
            logger.info(f"Generating scenario {i+1}/{count} using anchor reference: {ref['reels_url']}")

        if mode == "mix":
            topic_card = None
            structure_card = None

            if topic_id:
                topic_card = get_topic_card(topic_id)
            if structure_id:
                structure_card = get_structure_card(structure_id)

            if not topic_card or not structure_card:
                compatible_pair = get_random_compatible_family_pair(client_id) or get_random_compatible_pair(client_id)
                if compatible_pair and not topic_id and not structure_id:
                    topic_card = compatible_pair
                    structure_card = {
                        "id": compatible_pair.get("structure_id"),
                        "pattern_type": compatible_pair.get("pattern_type"),
                        "narrator_role": compatible_pair.get("narrator_role"),
                        "hook_style": compatible_pair.get("hook_style"),
                        "core_thesis": compatible_pair.get("core_thesis"),
                        "format_type": compatible_pair.get("format_type"),
                        "item_count": compatible_pair.get("item_count"),
                        "sequence_logic": compatible_pair.get("sequence_logic"),
                        "integration_style": compatible_pair.get("integration_style"),
                        "reusable_slots": compatible_pair.get("reusable_slots"),
                        "forbidden_drifts": compatible_pair.get("forbidden_drifts"),
                    }
                else:
                    topic_card = topic_card or get_random_topic_family_card(client_id) or get_random_topic_card(client_id)
                    structure_card = structure_card or get_random_structure_card(client_id)

            if not topic_card or not structure_card:
                raise ValueError(f"Not enough topic/structure cards to run mix generation for client {client_id}.")

            scenario = generate_from_topic_and_structure(
                topic_card=topic_card,
                structure_card=structure_card,
                niche=niche,
                target_product_info=target_product_info,
                brand_voice=brand_voice,
                target_audience=target_audience,
                target_duration_seconds=target_duration_seconds,
                target_duration_min_seconds=target_duration_min_seconds,
                target_duration_max_seconds=target_duration_max_seconds,
                variation_index=i + 1,
                total_variations=count,
                learned_rules_scenario=learned_rules_scenario,
                gender=gender,
            )
            source_references = [f"topic:{topic_card.get('id')}", f"struct:{structure_card.get('id')}"]
            source_reference = source_references[0]
            
            # Use labels from cards instead of relying on LLM to return them
            # This ensures they match what was selected in the Generator UI
            topic = topic_card.get("topic_short") or topic_card.get("topic_cluster")
            angle = f"{structure_card.get('pattern_type')} ({structure_card.get('narrator_role')})"
        elif mode == "rewrite":
            scenario = rewrite_reference_script(
                transcript=ref["transcript"],
                audit_json=ref["audit_json"],
                niche=niche,
                target_product_info=target_product_info,
                brand_voice=brand_voice,
                target_audience=target_audience,
                target_duration_seconds=target_duration_seconds,
                target_duration_min_seconds=target_duration_min_seconds,
                target_duration_max_seconds=target_duration_max_seconds,
                variation_index=i + 1,
                total_variations=count,
                learned_rules_scenario=learned_rules_scenario,
                gender=gender,
            )
            source_references = [ref["reels_url"]]
            source_reference = ref["reels_url"]
        elif mode == "single":
            scenario = generate_scenario(
                audit_json=ref["audit_json"],
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
            source_references = [ref["reels_url"]]
            source_reference = ref["reels_url"]
        else:
            scenario = generate_clustered_scenario(
                reference_audits=[item["audit_json"] for item in cluster_references],
                niche=niche,
                target_product_info=target_product_info,
                topic=topic,
                angle=angle,
                variation_index=i + 1,
                total_variations=count,
                brand_voice=brand_voice,
                target_audience=target_audience,
                target_duration_seconds=target_duration_seconds,
                target_duration_min_seconds=target_duration_min_seconds,
                target_duration_max_seconds=target_duration_max_seconds,
                learned_rules_scenario=learned_rules_scenario,
                gender=gender,
            )
            source_references = [item["reels_url"] for item in cluster_references]
            source_reference = ref["reels_url"]

        # Generate unique job_id for this variation
        if mode == "mix":
            res_job_id = f"mix_{client_id}_{uuid.uuid4().hex[:8]}"
        else:
            # For rewrite/single/cluster, we use the original job_id as base
            base_job_id = ref.get("job_id", "batch")
            res_job_id = f"{base_job_id}_v{i+1}_{uuid.uuid4().hex[:4]}"

        # Optimize for TTS
        script_text = scenario.get("script", "")
        is_error_placeholder = script_text.strip().lower().startswith("error generating")
        asset_reference_issues = find_unshowable_asset_reference_issues(script_text)
        tts_script = prepare_for_tts(script_text) if script_text else ""
        tts_audio_path = None
        tts_word_timestamps = None
        video_keyword_segments = None
        video_generation_prompts = None

        tts_request_text = None
        tts_audio_duration_seconds = None

        if is_error_placeholder:
            logger.error(
                "Skipping save for scenario %s because generator returned placeholder error script",
                res_job_id,
            )
            continue

        if asset_reference_issues:
            logger.error(
                "Skipping save for scenario %s because script contains unsupported demonstrative asset references: %s",
                res_job_id,
                asset_reference_issues,
            )
            continue

        if tts_script:
            try:
                if selected_tts_provider == "elevenlabs":
                    tts_request_text = prepare_text_for_elevenlabs_tts(tts_script)
                    tts_audio_path = text_to_speech_elevenlabs(
                        tts_script,
                        voice_id=selected_elevenlabs_voice_id or DEFAULT_ELEVENLABS_VOICE_ID,
                    )
                else:
                    tts_request_text = prepare_text_for_minimax_tts(tts_script)
                    tts_audio_path = text_to_speech_minimax(tts_script, voice_id=selected_tts_voice_id or None)
                if tts_silence_trim_enabled is None:
                    tts_silence_trim_enabled = SILENCE_TRIM_ENABLED
                if tts_silence_trim_enabled:
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
                        "Deepgram unavailable for scenario %s, using fallback transcript alignment: %s",
                        res_job_id,
                        deepgram_error,
                    )
                    deepgram_result = build_fallback_transcript_alignment(tts_script)
                tts_word_timestamps = {
                    "transcript": deepgram_result.get("transcript", ""),
                    "words": deepgram_result.get("words", []),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                if tts_sentence_trim_enabled and not deepgram_result.get("is_fallback"):
                    tts_audio_path, adjusted_words = _trim_sentence_gaps(
                        tts_audio_path,
                        deepgram_result.get("words", []),
                        tts_sentence_trim_min_gap_seconds,
                        DEFAULT_SENTENCE_TRIM_KEEP_GAP_SECONDS,
                        True,
                    )
                    tts_audio_duration_seconds = _probe_audio_duration_seconds(tts_audio_path)
                    tts_word_timestamps["words"] = adjusted_words
                video_keyword_segments = extract_visual_keyword_segments(
                    scenario_text=script_text,
                    tts_text=tts_script,
                    transcript=deepgram_result.get("transcript", ""),
                    words=deepgram_result.get("words", []),
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
            except Exception as e:
                logger.error(f"Failed to auto-generate TTS/timestamps/keywords for scenario {res_job_id}: {e}")
                notify_service_payment_issue(client_id, f"TTS/{selected_tts_provider}", e)

        # Save to Database (New Table)
        try:
            save_generated_scenario(
                job_id=res_job_id,
                client_id=client_id,
                source_content_id=ref.get("id") if mode != "mix" else None,
                topic_card_id=topic_card.get("id") if mode == "mix" else None,
                structure_card_id=structure_card.get("id") if mode == "mix" else None,
                niche=niche,
                mode=mode,
                topic=topic or scenario.get("topic_cluster") or scenario.get("topic_short"),
                angle=angle or scenario.get("topic_angle") or scenario.get("pattern_type"),
                generation_source=generation_source,
                scenario_json=scenario,
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
            logger.info(f"Successfully saved generated scenario {i+1} to scenarios table with job_id={res_job_id}")
        except Exception as e:
            logger.error(f"Failed to save scenario {i+1} to scenarios table: {e}")

        generated_scenarios.append({
            "index": i + 1,
            "job_id": res_job_id,
            "mode": mode,
            "generation_source": generation_source,
            "topic": topic or scenario.get("topic_cluster") or scenario.get("topic_short"),
            "angle": angle or scenario.get("topic_angle") or scenario.get("pattern_type"),
            "source_reference": source_reference,
            "source_references": source_references,
            "topic_card_id": topic_card.get("id") if mode == "mix" else None,
            "structure_card_id": structure_card.get("id") if mode == "mix" else None,
            "scenario": scenario,
            "tts_script": tts_script,
            "tts_audio_path": tts_audio_path,
            "tts_audio_duration_seconds": tts_audio_duration_seconds,
            "tts_word_timestamps": tts_word_timestamps,
            "video_keyword_segments": video_keyword_segments,
            "video_generation_prompts": video_generation_prompts,
            "heygen_avatar_id": active_avatar.get("avatar_id") if active_avatar else None,
            "heygen_avatar_name": active_avatar.get("avatar_name") if active_avatar else None,
            "heygen_look_id": (active_avatar.get("look") or {}).get("look_id") if active_avatar else None,
            "heygen_look_name": (active_avatar.get("look") or {}).get("look_name") if active_avatar else None,
            "background_audio_tag": "neutral",
        })
        
    return generated_scenarios

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run batch scenario generation.")
    parser.add_argument("--count", type=int, default=1, help="Number of variations to generate.")
    parser.add_argument("--client_id", type=int, default=1, help="Client ID to use for context.")
    parser.add_argument("--niche", type=str, default="General", help="Niche to focus on.")
    parser.add_argument("--topic", type=str, help="Specific topic to focus on.")
    parser.add_argument("--angle", type=str, help="Specific angle to focus on.")
    parser.add_argument("--mode", type=str, default="rewrite", choices=["rewrite", "single", "cluster", "mix"], help="Generation mode.")
    parser.add_argument("--topic_id", type=int, help="Topic card ID (for mix mode).")
    parser.add_argument("--structure_id", type=int, help="Structure card ID (for mix mode).")
    parser.add_argument("--generation_source", type=str, default="manual", choices=["manual", "auto"], help="Generation source tag.")
    
    args = parser.parse_args()
    
    try:
        init_db()
        results = run_batch_generation(
            count=args.count,
            client_id=args.client_id,
            niche=args.niche,
            topic=args.topic,
            angle=args.angle,
            mode=args.mode,
            topic_id=args.topic_id,
            structure_id=args.structure_id,
            generation_source=args.generation_source
        )
        
        # Save results to a file for the caller to read
        output_file = f"batch_gen_{args.niche.replace(' ', '_')}.json"
        with open(output_file, "w") as f:
            json.dump(results, f, indent=4, ensure_ascii=False)
            
        print(f"\n✅ Generated {len(results)} scenarios. Saved to {output_file}")
        
    except Exception as e:
        logger.error(f"Batch generation failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
