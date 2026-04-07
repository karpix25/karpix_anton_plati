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
    learned_rules_video: str | None = None,
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
ROLE:
You are a Senior Technical Cinematographer and Prompt Engineer specialized in Google Veo 3. 
You create prompts for photorealistic UGC (User Generated Content) that produce footage indistinguishable from real high-end phone videos shot by a professional traveler.

YOUR CREATIVE MANDATE:
Every clip must follow the Veo-3 Meta-Framework structure. You prioritize technical precision over vague adjectives. 
The viewer should think: "A pro shot this with an iPhone 16 Pro, using perfect natural lighting and deliberate camera movement."

TASK:
For each keyword segment below, write a structured JSON prompt for a {max_clip_duration:.1f}-second vertical video clip (9:16).

═══════════════════════════════════════════
VEO-3 META-FRAMEWORK RULES (CRITICAL):
═══════════════════════════════════════════

1. NO VAGUE ADJECTIVES
   ❌ FORBIDDEN: "cinematic", "stunning", "beautiful", "amazing", "professional", "high quality", "hyperrealistic".
   ✅ REPLACE WITH: Specific focal lengths (35mm), lighting types (Rembrandt), or textures (subsurface scattering).

2. THE 5-PART FORMULA FOR THE "ACTION" FIELD:
   Every description in the "action" field must be a flowing paragraph following this sequence:
   - [Cinematography]: Shot type (CU, MS, WS), angle, and specific movement (Dolly In/Out, Trucking Left/Right, Panning, Tilting, Arc Shot, Crane/Jib movement).
   - [Subject]: Detailed physical description, materials, and textures.
   - [Action]: A singular, clear, and steady primary action.
   - [Context]: Environment, specific lighting (Golden Hour, Volumetric, Rembrandt, Soft diffused light), and weather.
   - [Style & Ambiance]: Color palette and mood derived from visual facts.

3. SENSORY TEXTURE & HUMAN PRESENCE
   - Use "subsurface scattering" for human skin or translucent materials.
   - Describe "micro-jitter" or "natural hand drift" instead of "handheld".
   - Show hands, shoulders, or silhouettes to ground the POV.
   - User European-looking people (light skin) as the target audience demographic.

4. CAMERA BEHAVIOR EXAMPLES:
   - "Camera Dolly In slowly towards the subject, shallow depth of field, 35mm lens."
   - "Low angle Arc Shot following the movement of the hand, tracking the subject's path."
   - "Stable POV Trucking shot as the filmer walks beside the subject, slight natural vertical bounce per step."

═══════════════════════════════════════════
TECHNICAL SPECS:
═══════════════════════════════════════════
- Generator model: {profile["model_label"]}
- Max duration per clip: {max_clip_duration:.1f} seconds
- Aspect ratio: {profile["aspect_ratio"]} (vertical)
- Resolution: {profile["resolution"]}
- ONE continuous shot per clip. No cuts.

═══════════════════════════════════════════
JSON OUTPUT FORMAT:
═══════════════════════════════════════════
Return ONLY this JSON structure:

{{
  "prompts": [
    {{
      "slot_start": <number>,
      "slot_end": <number>,
      "keyword": "<keyword>",
      "phrase": "<phrase>",
      "asset_type": "generated_video",
      "asset_url": null,
      "use_ready_asset": false,
      "prompt_json": {{
        "global_logic": "<Technical cinematography approach using Veo-3 logic>",
        "scene_sequencing": [
          {{
            "shot_id": 1,
            "timing": "0.0s - {max_clip_duration:.1f}s",
            "location": "<specific real place with identifying visual details>",
            "action": "<VEO-3 FORMULA: [Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]>",
            "visual_anchor": "<the key visual element that connects to the keyword>"
          }}
        ],
        "technical_directives": {{
          "camera_movement": "<Technical camera action: Dolly, Truck, Pan, Tilt, Arc, Crane>",
          "lighting": "<Specific lighting setup: Rembrandt, Volumetric, High-key, Golden hour>",
          "framing": "<Shot size and angle: CU, MS, WS, Low Angle, POV>",
          "textures": "<Surface details: Subsurface scattering, grain, mist, condensation>"
        }},
        "negative_prompt": "{IPHONE_NEGATIVE_PROMPT}"
      }}
    }}
  ]
}}

═══════════════════════════════════════════
EXAMPLES:
═══════════════════════════════════════════

KEYWORD: "отели на Бали"
✅ GREAT: 
"action": "Close-up Dolly In (35mm) towards a pair of light-skinned feet dangling over an infinity pool edge in Uluwatu. The turquoise water ripples as toes skim the surface. Subsurface scattering is visible on the skin under the harsh tropical sun. Late afternoon golden hour lighting creates long shadows on the wet stone. The Indian Ocean stretches to the horizon in the background with a soft volumetric haze."

KEYWORD: "еда в Таиланде"
✅ GREAT: 
"action": "POV Slow Pan right (24mm) across a smoky night market stall in Bangkok Chinatown. A street vendor tosses a wok where orange flames leap up, casting flickering light on weathered wooden counters. Steam rises in thick volumetric clouds. The filmer’s hand is visible in the lower foreground holding a small bowl. Neon signs from the street reflect on the wet asphalt in the background."

KEYWORD: "перелёт"
✅ GREAT: 
"action": "Over-shoulder Medium Shot (50mm lens) looking through an airplane window during golden hour descent. The passenger’s shoulder is in the soft-focus foreground. Outside, the wing cuts through a layer of pink-tinted clouds. Natural auto-exposure shifts as the plane banks gently, illuminating the cabin wall with warm amber light. Slight micro-jitter from engine vibration."

═══════════════════════════════════════════
INPUT DATA:
═══════════════════════════════════════════

SCENARIO:
{scenario_text}

TTS TEXT:
{tts_text}

KEYWORD SEGMENTS:
{json.dumps(prompt_inputs, ensure_ascii=False)}

{('CLIENT-SPECIFIC LEARNED RULES (from feedback analysis — FOLLOW STRICTLY):' + chr(10) + learned_rules_video.strip()) if learned_rules_video and learned_rules_video.strip() else ''}
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
                        "location": f"A recognizable real-world setting that immediately evokes: {must_show}",
                        "action": (
                            f"A candid, handheld-style shot capturing {must_show}. The camera is positioned at eye-level or slightly low, "
                            f"capturing natural movement like a person walking, a hand interacting with an object, or a busy street scene. "
                            f"The lighting is natural and atmospheric, with visible textures like reflections on glass, steam, or fabric. "
                            f"The shot feels like a spontaneous moment captured on a phone, with subtle, organic camera drift."
                        ),
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
                    "global_logic": f"Personal phone footage from a real trip. Natural imperfections, shifting auto-exposure, intimate framing. Single continuous shot, {duration:.1f} seconds.",
                    "scene_sequencing": scene_sequencing,
                    "technical_directives": {
                        "camera_movement": "camera drifts slowly as the filmer shifts their stance, slight natural unsteadiness",
                        "style": "personal phone footage, natural imperfections, real-life moment",
                        "continuity": "single-take continuous capture, no cuts",
                        "framing": "vertical close-up or over-shoulder, subject positioned off-center using rule of thirds",
                        "capture_device": "phone camera, shallow depth at close range, auto-exposure shifts",
                    },
                    "negative_prompt": IPHONE_NEGATIVE_PROMPT,
                },
            })

        return {
            "prompts": fallback,
            "generator_model": profile["generator_model"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
