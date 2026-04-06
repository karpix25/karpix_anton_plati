import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List

from openai import OpenAI
from services.v1.providers.kie_ai_service import (
    DEFAULT_KIE_MODEL,
    GROK_IMAGINE_TEXT_TO_VIDEO_MODEL,
    SEEDANCE_15_PRO_MODEL,
    VEO3_QUALITY,
    VEO3_FAST,
    VEO3_LITE,
    normalize_kie_model,
)

logger = logging.getLogger(__name__)

IPHONE_NEGATIVE_PROMPT = (
    "stock footage, generic travel ad, polished commercial look, luxury hotel promo, cinematic drone shot, "
    "studio lighting, perfect gimbal smoothness, overly staged acting, glossy tourism commercial, text artifacts, "
    "low detail, heavy flicker, watermark, landscape composition, horizontal framing, sideways camera, rotated scene, "
    "ultrawide layout, panoramic staging, subject cropped like a horizontal shot inside a vertical frame"
)
MIN_BROLL_SEGMENT_SECONDS = 2.0


def _resolve_broll_model_profile(generator_model: str | None) -> Dict[str, Any]:
    resolved_model = normalize_kie_model(generator_model)
    if resolved_model == SEEDANCE_15_PRO_MODEL:
        return {
            "generator_model": resolved_model,
            "clip_duration_seconds": 4.0,
            "resolution": "720p",
            "aspect_ratio": "9:16",
            "generate_audio": False,
            "model_label": "Seedance 1.5 Pro",
            "mode": None,
        }

    if resolved_model == GROK_IMAGINE_TEXT_TO_VIDEO_MODEL:
        return {
            "generator_model": resolved_model,
            "clip_duration_seconds": 6.0,
            "resolution": "720p",
            "aspect_ratio": "9:16",
            "generate_audio": False,
            "model_label": "Grok Imagine T2V",
            "mode": "normal",
        }

    if resolved_model == VEO3_QUALITY:
        return {
            "generator_model": resolved_model,
            "clip_duration_seconds": 5.0,
            "resolution": "1080p",
            "aspect_ratio": "9:16",
            "generate_audio": False,
            "model_label": "Veo 3.1 Quality",
            "mode": "TEXT_2_VIDEO",
        }

    if resolved_model == VEO3_FAST:
        return {
            "generator_model": resolved_model,
            "clip_duration_seconds": 5.0,
            "resolution": "720p",
            "aspect_ratio": "9:16",
            "generate_audio": False,
            "model_label": "Veo 3.1 Fast",
            "mode": "TEXT_2_VIDEO",
        }

    if resolved_model == VEO3_LITE:
        return {
            "generator_model": resolved_model,
            "clip_duration_seconds": 5.0,
            "resolution": "720p",
            "aspect_ratio": "9:16",
            "generate_audio": False,
            "model_label": "Veo 3.1 Lite",
            "mode": "TEXT_2_VIDEO",
        }

    return {
        "generator_model": DEFAULT_KIE_MODEL,
        "clip_duration_seconds": 5.0,
        "resolution": "720p",
        "aspect_ratio": "9:16",
        "generate_audio": False,
        "model_label": "KIE V1 Pro",
        "mode": None,
    }


def _openrouter_client():
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.getenv("OPENROUTER_API_KEY"),
    )


def _build_prompt_segment_inputs(keyword_segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    prepared: List[Dict[str, Any]] = []
    for segment in keyword_segments or []:
        prepared.append({
            "slot_start": segment.get("slot_start"),
            "slot_end": segment.get("slot_end"),
            "keyword": segment.get("keyword"),
            "phrase": segment.get("phrase"),
            "visual_intent": segment.get("visual_intent"),
            "asset_type": segment.get("asset_type"),
            "asset_url": segment.get("asset_url"),
            "use_ready_asset": segment.get("asset_type") == "product_video",
            "must_show": segment.get("visual_intent") or segment.get("phrase") or segment.get("keyword"),
        })
    return prepared


def generate_seedance_prompts(
    scenario_text: str,
    tts_text: str,
    keyword_segments: List[Dict[str, Any]],
    generator_model: str | None = None,
) -> Dict[str, Any]:
    profile = _resolve_broll_model_profile(generator_model)
    max_clip_duration = float(profile["clip_duration_seconds"])

    if not keyword_segments:
        return {
            "prompts": [],
            "generator_model": profile["generator_model"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    prompt_inputs = _build_prompt_segment_inputs(keyword_segments)

    prompt = f"""
SYSTEM:
You create JSON-only video prompts for short KIE video generation.

CONTEXT:
- These prompts are for short vertical b-roll inserts on top of a talking-head video.
- The generator model is {profile["model_label"]}.
- Each generated clip must be maximum {max_clip_duration:.1f} seconds.
- Output prompts must match this exact generation profile:
  - aspect_ratio: {profile["aspect_ratio"]}
  - resolution: {profile["resolution"]}
  - duration: {int(max_clip_duration)}
  - mode: {profile["mode"] or "n/a"}
  - generate_audio: {"false" if not profile["generate_audio"] else "true"}
- Return one prompt object per keyword segment.
- If a segment already uses a ready-made product clip, do not generate a creative prompt for it. Return prompt_json as null and preserve the asset metadata.

TASK:
For each keyword segment, create a structured JSON prompt suitable for this exact generator profile.

RULES:
- Keep prompts tightly tied to the scenario topic and the segment phrase.
- Build visually specific prompts, not generic abstractions or stock categories.
- Treat `visual_intent` as a binding visual constraint, not as a soft hint.
- If a generated segment refers to an ordinary consumer good without a ready-made real asset, show a generic unbranded category or use-case, not the exact claimed item from the narration.
- For those consumer-good shots, avoid readable labels, logos, exact packaging claims, or visuals that imply we have the real product in hand when we do not.
- If `visual_intent` names a landmark, place, object, weather condition, crowd type, or travel situation, the generated scene must clearly show that exact thing.
- Never replace a named anchor from `visual_intent` with a nearby but different generic scene. If `visual_intent` says "Eiffel Tower", do not switch to a boutique window. If it says "crowded metro entrance in Paris", do not switch to a cafe terrace.
- `location`, `action`, and `visual_anchor` must all stay consistent with the same `visual_intent`.
- Before writing each prompt, resolve one explicit answer to: "what exactly must be visible in frame?" Then keep that answer consistent across the whole prompt.
- Every generated clip should feel like authentic vertical footage captured by a real person on an iPhone while traveling, not by a stock crew.
- Default visual language: handheld smartphone capture, natural available light, small human imperfections, believable micro-jitter, quick reframing, realistic phone auto-exposure.
- Avoid ad-style beauty shots, glossy hotel-commercial aesthetics, drone tourism footage, perfect cinematic pans, and generic tropical-stock visuals unless the script explicitly calls for them.
- If the segment is about a specific place, season, timing, price spike, weather pattern, or travel decision, the visual must show that exact context.
- Example: if the script is about Hainan, do not return a generic "beautiful resort beach"; prefer "tourist checking rainy-season weather on Hainan beachfront", "crowded breakfast line at a Hainan resort in January", "calm sea on Hainan promenade in October".
- Example: if the segment is about Paris winter sales and `visual_intent` says "Eiffel Tower in the background", the frame still has to include the Eiffel Tower; a random shop window alone is wrong.
- Use {profile["aspect_ratio"]} vertical composition.
- Force portrait-safe framing: the main subject must be composed for a vertical mobile screen, not a landscape scene squeezed into a tall canvas.
- Avoid wide office/table/room compositions that naturally want horizontal framing unless the action is explicitly reframed as a vertical close-up or vertical medium shot.
- Keep each prompt self-contained.
- Write the creative as a {max_clip_duration:.1f}-second storyboard for {profile["model_label"]}, but the camera language should stay user-shot and intimate.
- timing inside prompt_json must start at 0.0s and cover at most {max_clip_duration:.1f} seconds total.
- Do not include top-level keys like "task" or "model" inside prompt_json.
- Use exactly ONE continuous shot. No cuts, no scene switches, no multi-shot sequencing.
- "scene_sequencing" must contain exactly one item, covering the full duration.
- Prefer concrete real-world shots over abstract metaphors when possible.
- If asset_type is "product_video", keep:
  - "prompt_json": null
  - "use_ready_asset": true
- If asset_type is "generated_video", create a prompt_json object in the style below.

SELF-CHECK BEFORE OUTPUT:
- Does the frame visibly contain the exact `visual_intent` anchor?
- Would a human reading only `visual_anchor` guess the same scene as the script intended?
- Is this still a personal iPhone capture, not travel stock?
- Is it a single continuous shot with no cuts or scene switches?
- If any answer is no, rewrite the prompt before returning JSON.

JSON FORMAT:
{{
  "prompts": [
    {{
      "slot_start": 0,
      "slot_end": 3,
      "keyword": "эмиграция",
      "phrase": "переезд за границу",
      "asset_type": "generated_video",
      "asset_url": null,
      "use_ready_asset": false,
        "prompt_json": {{
        "global_logic": "Authentic vertical iPhone travel footage, user-shot feel, portrait-safe framing, natural light, realistic handheld motion, single-take continuous shot, full storyboard duration {max_clip_duration:.1f} seconds maximum.",
        "scene_sequencing": [
          {{
            "shot_id": 1,
            "timing": "0.0s - {max_clip_duration:.1f}s",
            "location": "specific place tied to the script topic",
            "action": "clear real-life action that looks self-shot on an iPhone",
            "visual_anchor": "specific scenario-related subject"
          }}
        ],
        "technical_directives": {{
          "camera_movement": "handheld smartphone movement, subtle natural micro-jitter, human reframing",
          "style": "authentic iPhone UGC, realistic travel footage",
          "continuity": "single-take continuous capture, no cuts or scene switches",
          "aspect_ratio": "{profile["aspect_ratio"]}",
          "resolution": "{profile["resolution"]}",
          "mode": "{profile["mode"] or "default"}",
          "generate_audio": false,
          "framing": "portrait-safe vertical framing, central subject dominance, no sideways composition, no landscape-style staging inside the vertical canvas",
          "shot_preference": "prefer close-up, over-shoulder, POV, or medium vertical shots that feel personally filmed",
          "capture_device": "modern iPhone camera look"
        }},
        "negative_prompt": "{IPHONE_NEGATIVE_PROMPT}"
      }}
    }}
  ]
}}

SCENARIO:
{scenario_text}

TTS TEXT:
{tts_text}

KEYWORD SEGMENTS:
{json.dumps(prompt_inputs, ensure_ascii=False)}
"""

    try:
        client = _openrouter_client()
        response = client.chat.completions.create(
            model="google/gemini-2.0-flash-001",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content.strip()
        if "```json" in content:
            content = content.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in content:
            content = content.split("```", 1)[1].split("```", 1)[0].strip()

        payload = json.loads(content)
        prompts = payload.get("prompts") if isinstance(payload, dict) else []
        if not isinstance(prompts, list):
            prompts = []

        return {
            "prompts": prompts,
            "generator_model": profile["generator_model"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as error:
        logger.error("Failed to generate Seedance prompts: %s", error)
        fallback = []
        for segment in keyword_segments:
            use_ready_asset = segment.get("asset_type") == "product_video"
            duration = min(
                max(float(segment.get("slot_end", 0)) - float(segment.get("slot_start", 0)), MIN_BROLL_SEGMENT_SECONDS),
                max_clip_duration,
            )
            must_show = segment.get("visual_intent") or segment.get("phrase") or segment.get("keyword")
            scene_sequencing = [
                    {
                        "shot_id": 1,
                        "timing": f"0.0s - {duration:.1f}s",
                        "location": f"Specific real-world place directly tied to: {must_show}",
                        "action": f"Authentic iPhone-style user-shot moment clearly showing this subject in an unbranded, realistic way: {must_show}",
                        "visual_anchor": must_show,
                    }
                ]
            fallback.append({
                "slot_start": segment.get("slot_start"),
                "slot_end": segment.get("slot_end"),
                "keyword": segment.get("keyword"),
                "phrase": segment.get("phrase"),
                "asset_type": segment.get("asset_type"),
                "asset_url": segment.get("asset_url"),
                "use_ready_asset": use_ready_asset,
                "prompt_json": None if use_ready_asset else {
                    "global_logic": f"Authentic vertical iPhone travel footage, user-shot feel, natural light, portrait-safe framing, single-take continuous shot, full storyboard duration {max_clip_duration:.1f} seconds maximum.",
                    "scene_sequencing": scene_sequencing,
                    "technical_directives": {
                        "camera_movement": "handheld smartphone movement with subtle natural micro-jitter",
                        "style": "authentic iPhone UGC, realistic travel footage",
                        "continuity": "single-take continuous capture, no cuts or scene switches",
                        "aspect_ratio": profile["aspect_ratio"],
                        "resolution": profile["resolution"],
                        "mode": profile["mode"] or "default",
                        "generate_audio": profile["generate_audio"],
                        "framing": "portrait-safe vertical framing, central subject dominance, no sideways composition, no landscape-style staging inside the vertical canvas",
                        "shot_preference": "prefer close-up, POV, over-shoulder, or medium vertical shots that feel personally filmed",
                        "capture_device": "modern iPhone camera look",
                    },
                    "negative_prompt": IPHONE_NEGATIVE_PROMPT,
                },
            })

        return {
            "prompts": fallback,
            "generator_model": profile["generator_model"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
