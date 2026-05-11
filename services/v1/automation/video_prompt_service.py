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
            "word_start": segment.get("word_start"),
            "word_end": segment.get("word_end"),
            "keyword": segment.get("keyword"),
            "phrase": segment.get("phrase"),
            "visual_intent": segment.get("visual_intent"),
            "asset_type": segment.get("asset_type"),
            "asset_url": segment.get("asset_url"),
            "asset_duration_seconds": segment.get("asset_duration_seconds"),
            "use_ready_asset": segment.get("asset_type") == "product_video",
            "must_show": segment.get("visual_intent") or segment.get("phrase") or segment.get("keyword"),
        })
    return prepared


def _clean_context_value(value: Any) -> str:
    return str(value or "").strip()


def _build_product_context_block(
    product_info: str | None,
    product_keyword: str | None,
    niche: str | None,
    brand_voice: str | None,
    target_audience: str | None,
) -> str:
    context_lines = [
        ("Product / offer", product_info),
        ("Product keywords", product_keyword),
        ("Niche", niche),
        ("Target audience", target_audience),
        ("Brand voice", brand_voice),
    ]
    lines = [f"- {label}: {_clean_context_value(value)}" for label, value in context_lines if _clean_context_value(value)]
    if not lines:
        return "- Product context is not provided. Infer only from the scenario text and keyword segment; do not invent a different industry."
    return "\n".join(lines)


def _product_context_fallback_hint(product_info: str | None, product_keyword: str | None, niche: str | None) -> str:
    context = " / ".join(
        _clean_context_value(value)
        for value in (product_info, product_keyword, niche)
        if _clean_context_value(value)
    )
    if context:
        return (
            "Derive the real usage environment from this context: "
            f"{context}. Keep shots anchored to the product/category, its proof details, and realistic customer interactions."
        )
    return "Derive the product/category only from the script and keyword segment; avoid unrelated lifestyle, tourism, or generic stock footage."


def generate_seedance_prompts(
    scenario_text: str,
    tts_text: str,
    keyword_segments: List[Dict[str, Any]],
    generator_model: str | None = None,
    learned_rules_video: str | None = None,
    product_info: str | None = None,
    product_keyword: str | None = None,
    niche: str | None = None,
    brand_voice: str | None = None,
    target_audience: str | None = None,
) -> Dict[str, Any]:
    profile = _resolve_broll_model_profile(generator_model)
    max_clip_duration = float(profile["clip_duration_seconds"])
    product_context = _build_product_context_block(product_info, product_keyword, niche, brand_voice, target_audience)
    product_context_fallback_hint = _product_context_fallback_hint(product_info, product_keyword, niche)

    if not keyword_segments:
        logger.warning("Empty segments provided to prompt generator. Creating global fallback prompt.")
        keyword_segments = [{"slot_start": 0.0, "slot_end": 10.0, "keyword": "Professional Atmosphere", "phrase": "General scene", "visual_intent": "WS of a modern professional environment, 4K"}]

    prompt_inputs = _build_prompt_segment_inputs(keyword_segments)

    prompt = f"""
ROLE:
You are a Senior Technical Cinematographer and Prompt Engineer specialized in Google Veo 3. 
You create prompts for photorealistic UGC (User Generated Content) that produce footage indistinguishable from real high-end phone videos shot by a skilled creator in the product's real usage environment.

YOUR CREATIVE MANDATE:
Every clip must follow the Veo-3 Meta-Framework structure. You prioritize technical precision over vague adjectives. 
The viewer should think: "A pro shot this with an iPhone 16 Pro, using perfect natural lighting and deliberate camera movement."
The viewer must also immediately understand the product/category context. Product relevance is more important than aesthetic variety.

TASK:
For each keyword segment below, write a structured JSON prompt for a {max_clip_duration:.1f}-second vertical video clip (9:16).

═══════════════════════════════════════════
PRODUCT CONTEXT — HIGHEST PRIORITY:
═══════════════════════════════════════════
{product_context}

PRODUCT VISUAL WORLD DERIVATION:
Before writing prompts, infer the product's visual world from PRODUCT CONTEXT, SCENARIO, TTS TEXT, and KEYWORD SEGMENTS:
- product_category: what is being sold or promoted
- real_usage_environment: where the product is naturally used or evaluated
- proof_visuals: concrete things that prove the offer visually
- forbidden_unrelated_worlds: scenes that would look attractive but unrelated

Use that inferred product visual world for every clip. Do not output this reasoning separately; reflect it inside each prompt_json.global_logic, location, action, and visual_anchor.

Fallback hint if context is sparse:
{product_context_fallback_hint}

NON-NEGOTIABLE PRODUCT RELEVANCE RULES:
1. Every generated b-roll clip must visually belong to the inferred product visual world, unless the transcript explicitly names a different location or object.
2. Use the keyword segment as the spoken timing anchor, but translate abstract/generic words through the product context.
3. Do not invent travel, hotels, airports, beaches, restaurants, luxury interiors, or any unrelated lifestyle world unless the product context or transcript explicitly requires it.
4. At least one of these must appear in each generated prompt: product/package, product texture/material, usage on the relevant person/object/device, proof detail, real customer environment, or the exact product category.
5. If keyword meaning is abstract, show concrete product proof: hands using the product, close-up texture/material, relevant surface, relevant device/screen, packaging, result, or a realistic user interaction.
6. If the keyword seems to point away from the product, resolve the conflict conservatively: keep the visual product-led and use the keyword only as an emotional or timing cue.

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
   - Match human details to the target audience if provided; otherwise keep demographic details neutral and natural.

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
        "product_visual_world": {{
          "product_category": "<inferred product/category>",
          "real_usage_environment": "<where this product is naturally used>",
          "proof_visual": "<specific product proof shown in this clip>"
        }},
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
These examples show how to derive a product visual world from context. Do not copy their industries, props, or locations unless the current product context matches them.

PRODUCT CONTEXT: face cream / skincare
KEYWORD: "кожа утром"
✅ GREAT: 
"action": "Close-up Dolly In (50mm macro feel) toward a fingertip lifting a small pearl of white face cream from an open jar on a bathroom vanity. The cream forms soft ridges and glossy peaks under diffused morning window light. A blurred face and shoulder remain in the mirror background while the hand moves steadily toward the cheek. Subsurface scattering is visible on natural skin texture, with faint pores and realistic redness near the nose. The palette is clean white ceramic, pale beige towel fibers, and soft daylight."

PRODUCT CONTEXT: payment card / fintech
KEYWORD: "оплата без проблем"
✅ GREAT: 
"action": "Over-shoulder Medium Shot (35mm) of a real hand holding a phone above a compact checkout terminal on a cafe counter. The thumb confirms payment on the screen while a small receipt curls out beside a ceramic cup. Soft window light reflects on the glass screen, and the terminal display glows green after the tap. Natural micro-jitter follows the user's wrist movement, with wallet leather grain and countertop scratches visible."

PRODUCT CONTEXT: online course / education
KEYWORD: "понятный план"
✅ GREAT: 
"action": "POV Slow Tilt Down (35mm) from a laptop screen showing a clean lesson checklist to a notebook where a hand underlines the next step. The desk has pencil marks, a glass of water, and a phone timer beside the keyboard. Soft afternoon window light creates gentle shadows across paper fibers. The camera drifts naturally as the learner moves the pen, making the plan feel usable and real."

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
        model = os.getenv("SCENARIO_MODEL", "google/gemini-2.5-flash")
        client = _openrouter_client()
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content.strip()
        if "```json" in content:
            content = content.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in content:
            content = content.split("```", 1)[1].split("```", 1)[0].strip()

        payload = json.loads(content)
        ai_prompts = payload.get("prompts") if isinstance(payload, dict) else []
        if not isinstance(ai_prompts, list):
            ai_prompts = []

        # Merge AI prompts with original technical metadata from keyword_segments
        final_prompts = []
        for i, segment in enumerate(keyword_segments):
            # Try to match AI prompt by index (default behavior)
            ai_p = ai_prompts[i] if i < len(ai_prompts) else {}
            
            # Use original metadata for critical technical fields
            asset_type = segment.get("asset_type")
            use_ready_asset = asset_type == "product_video"
            
            final_prompts.append({
                # Keep source timings immutable to avoid desync drift introduced by LLM rewrites.
                "slot_start": segment.get("slot_start"),
                "slot_end": segment.get("slot_end"),
                "word_start": segment.get("word_start"),
                "word_end": segment.get("word_end"),
                "keyword": segment.get("keyword"),
                "phrase": segment.get("phrase"),
                "prompt": ai_p.get("prompt"),
                "pacing": ai_p.get("pacing", "normal"),
                "asset_type": asset_type,
                "asset_url": segment.get("asset_url"),
                "asset_duration_seconds": segment.get("asset_duration_seconds"),
                "use_ready_asset": use_ready_asset,
                # If it's a ready asset, prompt_json is secondary/not needed
                "prompt_json": ai_p if not use_ready_asset else None
            })

        return {
            "prompts": final_prompts,
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
            product_scene_hint = _product_context_fallback_hint(product_info, product_keyword, niche)
            scene_sequencing = [
                    {
                        "shot_id": 1,
                        "timing": f"0.0s - {duration:.1f}s",
                        "location": f"A recognizable real-world setting that immediately evokes: {must_show}. Context: {product_scene_hint}",
                        "action": (
                            f"A candid, handheld-style shot capturing {must_show}. The camera is positioned at eye-level or slightly low, "
                            f"but the environment must stay anchored to the product context: {product_scene_hint}. "
                            f"Show concrete product proof, usage, texture, or relevant customer interaction instead of generic travel or lifestyle scenes. "
                            f"The lighting is natural and atmospheric, with visible textures like reflections on glass, steam, fabric, packaging, or skin. "
                            f"The shot feels like a spontaneous moment captured on a phone, with subtle, organic camera drift."
                        ),
                        "visual_anchor": must_show,
                    }
                ]
            fallback.append({
                "slot_start": segment.get("slot_start"),
                "slot_end": segment.get("slot_end"),
                "word_start": segment.get("word_start"),
                "word_end": segment.get("word_end"),
                "keyword": segment.get("keyword"),
                "phrase": segment.get("phrase"),
                "asset_type": segment.get("asset_type"),
                "asset_url": segment.get("asset_url"),
                "asset_duration_seconds": segment.get("asset_duration_seconds"),
                "use_ready_asset": use_ready_asset,
                "prompt_json": None if use_ready_asset else {
                    "product_visual_world": {
                        "product_category": _clean_context_value(product_keyword or niche or "inferred from script"),
                        "real_usage_environment": product_scene_hint,
                        "proof_visual": must_show,
                    },
                    "global_logic": f"Personal phone footage in the product's real usage context. Natural imperfections, shifting auto-exposure, intimate framing. Single continuous shot, {duration:.1f} seconds.",
                    "scene_sequencing": scene_sequencing,
                    "technical_directives": {
                        "camera_movement": "camera drifts slowly as the filmer shifts their stance, slight natural unsteadiness",
                        "style": "personal phone footage, natural imperfections, product-led real-life moment",
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
