# Copyright (c) 2025 Stephen G. Pope
# Single Scenario Generator for Specific References
# Orchestrates Audit -> Scenario for a single item.

import argparse
import logging
import json
import os
import subprocess
from services.v1.automation.pipeline_orchestrator import run_content_gen_pipeline
from services.v1.database.db_service import get_db_connection, init_db
from datetime import datetime, timezone

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("SingleGenerator")


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

def _load_json_if_needed(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value or {}

def generate_for_content(content_id, client_id=None, generate_video=False):
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
                
        # Only rewrite the scenario, bypassing the ingestion and transcription phases
        from services.v1.automation.scenario_service import rewrite_reference_script, find_unshowable_asset_reference_issues
        import uuid
        
        logger.info(f"Rewriting scenario for Content {content_id}")
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
        )
        
        import uuid
        res_job_id = f"{base_job_id or 'single'}_v1_{uuid.uuid4().hex[:4]}"

        from services.v1.automation.scenario_service import prepare_for_tts
        from services.v1.providers.minimax_service import prepare_text_for_minimax_tts, text_to_speech_minimax
        from services.v1.providers.elevenlabs_service import DEFAULT_ELEVENLABS_VOICE_ID, prepare_text_for_elevenlabs_tts, text_to_speech_elevenlabs
        from services.v1.transcription.deepgram_service import build_fallback_transcript_alignment, transcribe_media_deepgram
        from services.v1.automation.visual_keyword_service import extract_visual_keyword_segments
        from services.v1.automation.video_prompt_service import generate_seedance_prompts

        script_text = scenario_json.get("script", "")
        if script_text.strip().lower().startswith("error generating"):
            logger.error(
                "Skipping save for single scenario %s because generator returned placeholder error script",
                res_job_id,
            )
            return {"status": "error", "message": "Scenario generation failed", "job_id": res_job_id}

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
                if tts_provider == "elevenlabs":
                    tts_request_text = prepare_text_for_elevenlabs_tts(tts_script)
                    tts_audio_path = text_to_speech_elevenlabs(tts_script, voice_id=elevenlabs_voice_id or DEFAULT_ELEVENLABS_VOICE_ID)
                else:
                    tts_request_text = prepare_text_for_minimax_tts(tts_script)
                    tts_audio_path = text_to_speech_minimax(tts_script, voice_id=tts_voice_id or None)
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
                }
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
                )
                video_generation_prompts = generate_seedance_prompts(
                    scenario_text=script_text,
                    tts_text=tts_script,
                    keyword_segments=(video_keyword_segments or {}).get("segments", []),
                    generator_model=broll_generator_model,
                )
            except Exception as media_error:
                logger.error(f"Failed to auto-generate media pipeline for single scenario {res_job_id}: {media_error}")
        
        save_generated_scenario(
            job_id=res_job_id,
            client_id=resolved_client_id,
            source_content_id=content_id,
            niche=niche,
            mode="rewrite",
            topic=scenario_json.get("topic_cluster"),
            angle=scenario_json.get("topic_angle"),
            scenario_json=scenario_json,
            tts_script=tts_script,
            tts_request_text=tts_request_text,
            tts_audio_path=tts_audio_path,
            tts_audio_duration_seconds=tts_audio_duration_seconds,
            tts_word_timestamps=tts_word_timestamps,
            video_keyword_segments=video_keyword_segments,
            video_generation_prompts=video_generation_prompts,
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
    
    args = parser.parse_args()
    
    init_db()
    res = generate_for_content(args.content_id, args.client_id)
    if res:
        print(json.dumps(res, ensure_ascii=False))
