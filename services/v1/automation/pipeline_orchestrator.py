# Copyright (c) 2025 Stephen G. Pope
#
# Pipeline Orchestrator for Content Generation Automation
# Coordinates Audit -> Scenario -> TTS -> Avatar -> AI Editing

import logging
import concurrent.futures
from services.v1.automation.audit_service import get_transcript_audit
from services.v1.automation.scenario_service import rewrite_reference_script
from services.v1.automation.ai_editor_service import generate_broll_plan
from services.v1.providers.minimax_service import text_to_speech_minimax
from services.v1.providers.elevenlabs_service import DEFAULT_ELEVENLABS_VOICE_ID, text_to_speech_elevenlabs
from services.v1.providers.heygen_api import generate_avatar_video, wait_for_heygen_video
from services.v1.ingestion.instagram_downloader import download_instagram_reel
from services.v1.transcription.deepgram_service import transcribe_media_deepgram
from services.v1.database.db_service import (
    save_content_data,
    get_processed_content_by_job_id,
    save_topic_card,
    save_structure_card,
    link_content_to_cards,
    save_topic_structure_pair,
    choose_next_client_avatar_variant,
)
from services.v1.automation.notifier_service import send_telegram_notification, notify_service_payment_issue

# Note: This assumes cloud_storage utilities exist or will be added to this workspace.
try:
    from services.cloud_storage import upload_file
except ImportError:
    # Use a dummy upload if the file is missing
    def upload_file(path):
        return f"file://{path}"

# Set up logging
logger = logging.getLogger(__name__)

def _build_topic_card(audit_json, niche):
    strategy = audit_json.get("reference_strategy", {}) if audit_json else {}
    return {
        "topic_short": strategy.get("topic_cluster") or niche,
        "topic_family": strategy.get("topic_family") or strategy.get("topic_cluster") or niche,
        "topic_cluster": strategy.get("topic_cluster") or niche,
        "topic_angle": strategy.get("topic_angle") or "Без угла",
        "promise": strategy.get("promise"),
        "pain_point": strategy.get("pain_point"),
        "proof_type": strategy.get("proof_type"),
        "cta_type": strategy.get("cta_type"),
    }

def _build_structure_card(audit_json):
    pattern = audit_json.get("pattern_framework", {}) if audit_json else {}
    return {
        "pattern_type": pattern.get("pattern_type", "other"),
        "narrator_role": pattern.get("narrator_role"),
        "hook_style": pattern.get("hook_style"),
        "core_thesis": pattern.get("core_thesis"),
        "content_shape": pattern.get("content_shape", {}),
        "argument_style": pattern.get("argument_style"),
        "integration_style": pattern.get("integration_style", {}),
        "reusable_slots": pattern.get("reusable_slots", {}),
        "forbidden_drifts": pattern.get("forbidden_drifts", []),
    }

def run_content_gen_pipeline(job_id, transcript=None, reels_url=None, niche="General", target_product_info=None, client_id=None, avatar_id="469083313936440c9d9651586bd2251a", analysis_only=False, generate_video=True, manual=True):
    """
    Runs the content generation pipeline.
    If analysis_only=True, stops after Phase 1 (Atomic Deconstruction).
    If manual=False, checks client's auto_generate setting.
    """
    logger.info(f"[{job_id}] Starting pipeline. Client ID: {client_id}. Niche: {niche}")
    
    # Fetch extra client context if client_id is provided
    brand_voice = None
    target_audience = None
    auto_generate = True
    monthly_limit = 30
    tts_provider = "minimax"
    tts_voice_id = None
    elevenlabs_voice_id = None
    learned_rules_scenario = None
    learned_rules_visual = None
    learned_rules_video = None
    
    if client_id:
        from services.v1.database.db_service import get_client, get_client_monthly_count
        client_data = get_client(client_id=client_id)
        if client_data:
            brand_voice = client_data.get("brand_voice")
            target_audience = client_data.get("target_audience")
            target_product_info = target_product_info or client_data.get("product_info")
            auto_generate = client_data.get("auto_generate", False)
            monthly_limit = client_data.get("monthly_limit", 30)
            tts_provider = client_data.get("tts_provider") or "minimax"
            tts_voice_id = client_data.get("tts_voice_id")
            elevenlabs_voice_id = client_data.get("elevenlabs_voice_id")
            learned_rules_scenario = client_data.get("learned_rules_scenario")
            learned_rules_visual = client_data.get("learned_rules_visual")
            learned_rules_video = client_data.get("learned_rules_video")

    selected_avatar_variant = None
    if client_id:
        selected_avatar_variant = choose_next_client_avatar_variant(client_id)
        if selected_avatar_variant:
            avatar_id = selected_avatar_variant["avatar_id"]
            logger.info(f"[{job_id}] Selected client avatar rotation: avatar={selected_avatar_variant['avatar_name']} look={selected_avatar_variant.get('look', {}).get('look_name') if selected_avatar_variant.get('look') else 'default'}")

    # Check if we should proceed to full generation
    # If it's NOT a manual trigger and auto_generate is OFF, we stop after analysis
    if not manual and not auto_generate:
        logger.info(f"[{job_id}] Auto-generate is OFF for client {client_id}. Stopping after Phase 1.")
        analysis_only = True

    # Phase 0: Ingestion if URL is provided
    transcript_meta = None
    if reels_url:
        logger.info(f"[{job_id}] Phase 0: Downloading and transcribing Reel")
        video_path = download_instagram_reel(reels_url)
        try:
            transcription_data = transcribe_media_deepgram(video_path)
        except Exception as error:
            notify_service_payment_issue(client_id, "Deepgram", error)
            raise
        transcript = transcription_data["transcript"]
        transcript_meta = transcription_data.get("transcript_meta")
        word_count = transcript_meta.get("word_count") if transcript_meta else None
        duration_seconds = transcript_meta.get("duration_seconds") if transcript_meta else None
        
        logger.info(f"[{job_id}] Captured stats - Words: {word_count}, Duration: {duration_seconds}s")
        
        save_content_data(
            job_id, 
            reels_url=reels_url, 
            transcript=transcript, 
            niche=niche, 
            client_id=client_id,
            word_count=word_count,
            duration_seconds=duration_seconds
        )
        
    if not transcript:
        raise ValueError("Transcript or Reels URL must be provided")

    # Phase 1: Audit (Atomic Deconstruction)
    logger.info(f"[{job_id}] Phase 1: Performing atomic deconstruction")
    audit_json = get_transcript_audit(
        transcript, 
        niche=niche, 
        target_product_info=target_product_info,
        brand_voice=brand_voice,
        target_audience=target_audience
    )
    if transcript_meta:
        audit_json["transcript_meta"] = transcript_meta
    save_content_data(job_id, audit_json=audit_json, niche=niche, client_id=client_id)

    if client_id:
        content_row = get_processed_content_by_job_id(job_id)
        source_content_id = content_row.get("id") if content_row else None
        topic_card_id = save_topic_card(client_id, _build_topic_card(audit_json, niche), source_content_id=source_content_id)
        structure_card_id = save_structure_card(client_id, _build_structure_card(audit_json), source_content_id=source_content_id)
        link_content_to_cards(job_id, topic_card_id=topic_card_id, structure_card_id=structure_card_id)
        save_topic_structure_pair(client_id, topic_card_id, structure_card_id, source_content_id=source_content_id)
    
    if analysis_only:
        logger.info(f"[{job_id}] Analysis complete. Stopping as requested.")
        
        if client_id:
            msg = f"✅ **Анализ референса готов!**\n\n💡 DNA: {audit_json.get('viral_dna_synthesis')}\n\nСценарий скоро будет готов..."
            send_telegram_notification(client_id, msg)

        return {
            "status": "analysis_complete",
            "job_id": job_id,
            "audit": audit_json
        }
    
    # Phase Quota: Check monthly limit
    if client_id:
        usage = get_client_monthly_count(client_id)
        if usage >= monthly_limit:
            logger.warning(f"[{job_id}] Client {client_id} exceeded monthly limit ({usage}/{monthly_limit}). Stopping.")
            return {
                "status": "quota_exceeded",
                "job_id": job_id,
                "message": f"Monthly limit of {monthly_limit} scenarios reached."
            }

    # Phase 2: Scenario (Close rewrite of the original reference)
    gender = selected_avatar_variant.get("gender", "female") if selected_avatar_variant else "female"
    scenario_json = rewrite_reference_script(
        transcript,
        audit_json=audit_json,
        transcript_meta=transcript_meta or (audit_json or {}).get("transcript_meta"),
        niche=niche,
        target_product_info=target_product_info,
        brand_voice=brand_voice,
        target_audience=target_audience,
        learned_rules_scenario=learned_rules_scenario,
        gender=gender,
    )
    script_text = scenario_json.get("script")
    save_content_data(job_id, scenario_json=scenario_json, niche=niche)
    
    if client_id:
        scene_name = scenario_json.get("scene_name", "Без названия")
        msg = (
            f"🎬 **Сценарий готов!**\n\n"
            f"📌 **Название:** {scene_name}\n\n"
            f"📝 **Текст сценария:**\n{script_text}"
        )
        send_telegram_notification(client_id, msg)
    
    if not generate_video:
        logger.info(f"[{job_id}] Video generation is OFF. Stopping after Phase 2.")
        return {
            "status": "scenario_complete",
            "job_id": job_id,
            "audit": audit_json,
            "scenario": scenario_json
        }
    
    # Phase 3 & 4: (Parallel) TTS and B-roll Planning
    with concurrent.futures.ThreadPoolExecutor() as executor:
        if tts_provider == "elevenlabs":
            tts_future = executor.submit(text_to_speech_elevenlabs, script_text, elevenlabs_voice_id or DEFAULT_ELEVENLABS_VOICE_ID)
        else:
            tts_future = executor.submit(text_to_speech_minimax, script_text, tts_voice_id or None)
        editor_future = executor.submit(generate_broll_plan, scenario_json)
        
        try:
            audio_local_path = tts_future.result()
        except Exception as error:
            notify_service_payment_issue(client_id, f"TTS/{tts_provider}", error)
            raise
        try:
            broll_plan = editor_future.result()
        except Exception as error:
            notify_service_payment_issue(client_id, "B-roll planner", error)
            raise
        
    # Phase 5: Avatar Video Generation
    # Upload audio to cloud storage so HeyGen can access it
    try:
        audio_url = upload_file(audio_local_path)
    except Exception as e:
        logger.error(f"Failed to upload audio: {e}")
        audio_url = f"file://{audio_local_path}" # Fallback for local testing if supported
    
    # Trigger HeyGen
    look = selected_avatar_variant.get("look") if selected_avatar_variant else None
    motion_look_id = (look or {}).get("motion_look_id")
    fallback_look_id = (look or {}).get("look_id")
    try:
        heygen_video_id = generate_avatar_video(
            audio_url,
            avatar_id,
            look_id=motion_look_id or fallback_look_id,
            fallback_look_id=fallback_look_id,
        )
    except Exception as error:
        notify_service_payment_issue(client_id, "HeyGen", error)
        raise
    
    # Wait for result
    try:
        final_video_url = wait_for_heygen_video(heygen_video_id)
    except Exception as error:
        notify_service_payment_issue(client_id, "HeyGen", error)
        raise
    save_content_data(job_id, final_video_url=final_video_url)
    
    if client_id:
        msg = f"🚀 **Видео готово!**\n\n🔗 {final_video_url}"
        send_telegram_notification(client_id, msg)

    return {
        "status": "success",
        "job_id": job_id,
        "audit": audit_json,
        "scenario": scenario_json,
        "broll_plan": broll_plan,
        "selected_avatar_variant": selected_avatar_variant,
        "heygen_video_id": heygen_video_id,
        "final_video_url": final_video_url
    }
