import os
import sys
import json
import logging
import argparse
import subprocess
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
)
from services.v1.providers.minimax_service import prepare_text_for_minimax_tts, text_to_speech_minimax
from services.v1.providers.elevenlabs_service import DEFAULT_ELEVENLABS_VOICE_ID, prepare_text_for_elevenlabs_tts, text_to_speech_elevenlabs
from services.v1.transcription.deepgram_service import build_fallback_transcript_alignment, transcribe_media_deepgram

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


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

def get_reference_pool(niche="General", client_id=None, topic=None, angle=None):
    """
    Fetches a pool of references based on niche, topic, or angle.
    """
    if topic:
        return get_references_by_topic(topic, client_id)
    if angle:
        return get_references_by_angle(angle, client_id)
    return get_references_by_niche(niche, client_id)

def run_batch_generation(count=1, client_id=1, niche="General", topic=None, angle=None, mode="rewrite", topic_id=None, structure_id=None):
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

    # Get references
    ranked_references = get_reference_pool(niche=niche, client_id=client_id, topic=topic, angle=angle)
    
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
                total_variations=count
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
            except Exception as e:
                logger.error(f"Failed to auto-generate TTS/timestamps/keywords for scenario {res_job_id}: {e}")
                notify_service_payment_issue(client_id, f"TTS/{tts_provider}", e)

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
                scenario_json=scenario,
                tts_script=tts_script,
                tts_request_text=tts_request_text,
                tts_audio_path=tts_audio_path,
                tts_audio_duration_seconds=tts_audio_duration_seconds,
                tts_word_timestamps=tts_word_timestamps,
                video_keyword_segments=video_keyword_segments,
                video_generation_prompts=video_generation_prompts,
                background_audio_tag="neutral",
            )
            logger.info(f"Successfully saved generated scenario {i+1} to scenarios table with job_id={res_job_id}")
        except Exception as e:
            logger.error(f"Failed to save scenario {i+1} to scenarios table: {e}")

        generated_scenarios.append({
            "index": i + 1,
            "job_id": res_job_id,
            "mode": mode,
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
            structure_id=args.structure_id
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
