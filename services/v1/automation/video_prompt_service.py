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
You are a cinematic micro-video director who shoots personal travel content on an iPhone.
You create prompts that produce footage indistinguishable from real phone videos posted on Instagram stories and TikTok by travelers.

YOUR CREATIVE MANDATE:
Every clip must feel like someone pulled out their phone and filmed a moment from their trip — NOT like a stock library clip or an ad.
The viewer should think: "this person was actually there and filmed this with their own phone."

TASK:
For each keyword segment below, write a structured JSON prompt that will generate a {max_clip_duration:.1f}-second vertical video clip.
These clips are b-roll inserts that play over a talking-head narration.

═══════════════════════════════════════════
VISUAL STORYTELLING RULES (CRITICAL):
═══════════════════════════════════════════

1. DESCRIBE WHAT THE CAMERA SEES, NOT WHAT YOU WANT THE STYLE TO BE
   ❌ BAD: "authentic iPhone UGC, realistic travel footage"
   ✅ GOOD: "A woman's hand trails along a sun-warmed stone wall as she walks down a narrow cobblestone alley in Barcelona, laundry lines with colorful clothes strung between balconies above, dappled afternoon sunlight filtering through"

2. EVERY FRAME NEEDS SENSORY TEXTURE
   Include at least 2-3 of these in every prompt:
   - Specific lighting (golden hour glow, overcast diffused light, neon reflections on wet pavement, harsh midday shadows)
   - Physical textures (condensation on glass, weathered wood grain, sand on skin, fabric folds)
   - Environmental movement (wind in hair/leaves/curtains, steam rising, water rippling, traffic passing)
   - Temperature cues (breath vapor, sweat on skin, sunburn glow, warm drink steam)

3. HUMAN PRESENCE WITHOUT FACES
   Show people through:
   - Hands (holding coffee, scrolling phone, pointing at something, resting on railing)
   - Over-shoulder perspective (viewer sees what the person sees)
   - Silhouettes and partial figures (legs walking, shadow on wall, arm reaching)
   - Personal objects in frame (phone screen, sunglasses on table, open passport, packed suitcase)
   NEVER describe a full face close-up or a person posing for camera.
   APPEARANCE: Any visible person (hands, skin, silhouette, hair) must be European-looking — light skin, European features. This is the target audience demographic.

4. CAMERA BEHAVIOR THROUGH ACTIONS, NOT LABELS
   ❌ BAD: "handheld smartphone movement with natural micro-jitter"
   ✅ GOOD: "Camera slowly pans right following a street vendor, slight drift as the filmer shifts weight"
   ✅ GOOD: "POV looking down at feet walking on wet tiles, camera bounces gently with each step"
   ✅ GOOD: "Camera tilts up from a plate of food to reveal a panoramic ocean view through the restaurant window"

5. DEPTH AND LAYERS
   Every shot must have foreground AND background:
   ❌ BAD: "a beach at sunset" (flat, generic)
   ✅ GOOD: "Close-up of wet sand with foam receding in foreground, footprints leading to a distant figure at the water's edge, orange sun low on horizon casting long shadows"

6. ANTI-STOCK CHECKLIST (apply to every prompt):
   - Is there something imperfect? (slightly messy table, uneven lighting, a random passerby)
   - Is there visible human activity? (not staged, not posed)
   - Can you tell the SPECIFIC location from the visual? (not "a beach" but "a Thai beach with longtail boats")
   - Is there a micro-story? (someone doing something, not just a pretty vista)

═══════════════════════════════════════════
SHOT VARIETY (MANDATORY):
═══════════════════════════════════════════
Rotate through these shot types across segments — NEVER repeat the same type consecutively:
- POV walking shot (camera IS the person's eyes)
- Over-shoulder reveal (we see what they see over their shoulder)
- Detail close-up (hands, objects, food, textures — shot from 10-20cm)
- Low angle looking up (from table level, floor level, water level)
- Slow pan discovery (camera moves to reveal something unexpected)
- Reflection shot (in window, puddle, mirror, phone screen)

═══════════════════════════════════════════
TECHNICAL SPECS:
═══════════════════════════════════════════
- Generator model: {profile["model_label"]}
- Max duration per clip: {max_clip_duration:.1f} seconds
- Aspect ratio: {profile["aspect_ratio"]} (vertical)
- Resolution: {profile["resolution"]}
- Mode: {profile["mode"] or "n/a"}
- ONE continuous shot per clip. No cuts or scene switches.
- Framing: always composed for vertical mobile screen.

═══════════════════════════════════════════
JSON OUTPUT FORMAT:
═══════════════════════════════════════════
Return ONLY this JSON structure, no other text:

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
        "global_logic": "<1-2 sentence overall mood and filming approach>",
        "scene_sequencing": [
          {{
            "shot_id": 1,
            "timing": "0.0s - {max_clip_duration:.1f}s",
            "location": "<specific real place with identifying visual details>",
            "action": "<detailed cinematic description: what exactly the camera sees, the movement, the light, the textures, the human element — written as one flowing paragraph of 2-4 sentences>",
            "visual_anchor": "<the key visual element that connects to the keyword>"
          }}
        ],
        "technical_directives": {{
          "camera_movement": "<specific camera action described as physical movement, not a style label>",
          "style": "personal phone footage, natural imperfections, real-life moment",
          "continuity": "single-take continuous capture, no cuts",
          "framing": "<specific framing for this shot — e.g. 'low angle from table looking up' or 'tight over-shoulder'>",
          "capture_device": "phone camera, shallow depth at close range, auto-exposure shifts"
        }},
        "negative_prompt": "{IPHONE_NEGATIVE_PROMPT}"
      }}
    }}
  ]
}}

RULES FOR SPECIAL CASES:
- If asset_type is "product_video": set "prompt_json": null, "use_ready_asset": true
- "scene_sequencing" must contain exactly ONE item
- Timing always starts at 0.0s

═══════════════════════════════════════════
EXAMPLES OF GREAT vs TERRIBLE PROMPTS:
═══════════════════════════════════════════

KEYWORD: "отели на Бали"
❌ TERRIBLE: location="Bali hotel", action="person at a hotel pool in Bali, authentic iPhone footage"
✅ GREAT: location="Infinity pool edge at a Bali cliff-side villa, Uluwatu area", action="Close-up of a woman's feet dangling over an infinity pool edge, turquoise water stretching to the horizon below. Her toes skim the surface sending tiny ripples. A tropical drink with a paper umbrella sits on the wet stone beside her. Camera slowly tilts up from feet to reveal the vast Indian Ocean panorama, lens catches a sun flare. Late afternoon golden light paints everything warm amber."

KEYWORD: "еда в Таиланде"
❌ TERRIBLE: location="Thai street", action="Thai street food being prepared, authentic UGC style"
✅ GREAT: location="Smoky night market stall on Yaowarat Road, Bangkok Chinatown", action="POV shot: the viewer's hand reaches toward a sizzling wok where a vendor tosses pad thai with flames leaping up. The camera drifts to the right revealing a row of glowing food stalls stretching down the narrow street, motorcycles weaving between pedestrians, neon signs reflecting on the wet asphalt. Dense steam catches the warm orange light from bare overhead bulbs."

KEYWORD: "перелёт"
❌ TERRIBLE: location="airplane", action="person looking out airplane window, handheld camera feel"
✅ GREAT: location="Economy class window seat during golden hour descent", action="Camera peers past a sleeping passenger's shoulder through the oval airplane window. Cloud layer below glows pink and orange. The wing cuts through frame at a diagonal. A phone notification lights up on the tray table in the foreground, slightly out of focus. The plane banks gently and the light shifts across the cabin wall."

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
            model="google/gemini-2.5-flash",
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
