import random
import os
import re
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, TypedDict, Literal
from dataclasses import dataclass

from openai import OpenAI

logger = logging.getLogger(__name__)

# --- TYPES ---

class Word(TypedDict):
    word: str
    punctuated_word: str
    start: float
    end: float
    confidence: Optional[float]

class TimingSlot(TypedDict):
    slot_start: float
    slot_end: float

class VisualSegment(TypedDict, total=False):
    slot_start: float
    slot_end: float
    keyword: str
    phrase: str
    word_start: float
    word_end: float
    visual_intent: str
    reason: str
    asset_type: Literal["generated_video", "product_video"]
    asset_url: Optional[str]
    asset_id: Optional[str]
    asset_name: Optional[str]
    generate_video: bool

@dataclass
class GenerationConfig:
    interval: float = 3.0
    timing_mode: str = "semantic_pause"
    pacing_profile: str = "balanced"
    pause_threshold: float = 0.45
    coverage_percent: float = 35.0
    relevance_priority: str = "balanced"
    product_clip_policy: str = "contextual"
    product_keyword: Optional[str] = None
    product_video_url: Optional[str] = None
    product_media_assets: Optional[List[Dict[str, Any]]] = None
    learned_rules: Optional[str] = None

# --- CONSTANTS ---

STRONG_BOUNDARY_RE = re.compile(r"[.!?;:]$")
SOFT_BOUNDARY_RE = re.compile(r"[,)]$")
MIN_BROLL_SEGMENT_SECONDS = 2.0
MIN_PRODUCT_SEGMENT_SECONDS = 3.0
FIRST_ATTENTION_CUT_MIN_SECONDS = 2.6
FIRST_ATTENTION_CUT_MAX_SECONDS = 3.0

PACING_PRESETS: Dict[str, Dict[str, float]] = {
    "calm": {
        "min_avatar_gap_factor": 0.95,
        "target_avatar_gap_factor": 1.2,
        "max_avatar_gap_factor": 1.8,
        "min_avatar_gap_floor": 2.8,
        "target_avatar_gap_floor": 3.4,
        "max_avatar_gap_floor": 4.8,
        "slot_min": 2.4,
        "slot_target": 2.8,
        "slot_max": 3.6,
    },
    "balanced": {
        "min_avatar_gap_factor": 0.8,
        "target_avatar_gap_factor": 1.0,
        "max_avatar_gap_factor": 1.55,
        "min_avatar_gap_floor": 2.2,
        "target_avatar_gap_floor": 2.8,
        "max_avatar_gap_floor": 4.0,
        "slot_min": 2.0,
        "slot_target": 2.8,
        "slot_max": 5.0,
    },
    "dynamic": {
        "min_avatar_gap_factor": 0.65,
        "target_avatar_gap_factor": 0.9,
        "max_avatar_gap_factor": 1.35,
        "min_avatar_gap_floor": 2.0,
        "target_avatar_gap_floor": 2.4,
        "max_avatar_gap_floor": 3.5,
        "slot_min": 2.0,
        "slot_target": 2.5,
        "slot_max": 5.0,
    },
}

# --- UTILITIES ---

def _openrouter_client():
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.getenv("OPENROUTER_API_KEY"),
    )

def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

# --- TIMING ENGINE ---

class TimingEngine:
    def __init__(self, config: GenerationConfig):
        self.config = config

    def normalize_words(self, words: List[Dict[str, Any]]) -> List[Word]:
        normalized_words: List[Word] = []
        for word in words or []:
            if not isinstance(word, dict):
                continue
            start = _safe_float(word.get("start"))
            end = _safe_float(word.get("end"), start)
            token = (word.get("word") or "").strip()
            punctuated = (word.get("punctuated_word") or token).strip()
            if not token or end < start:
                continue
            normalized_words.append({
                "start": round(start, 2),
                "end": round(end, 2),
                "word": token,
                "punctuated_word": punctuated,
                "confidence": word.get("confidence")
            })
        normalized_words.sort(key=lambda item: (item["start"], item["end"]))
        return normalized_words

    def derive_automatic_pause_threshold(self, words: List[Word]) -> float:
        if len(words) < 2:
            return 0.3
        gaps = [
            round(max(0.0, words[index]["start"] - words[index - 1]["end"]), 2)
            for index in range(1, len(words))
        ]
        positive_gaps = sorted(gap for gap in gaps if gap > 0.0)
        if not positive_gaps:
            return 0.3
        percentile_index = min(len(positive_gaps) - 1, max(0, int(len(positive_gaps) * 0.7)))
        derived = positive_gaps[percentile_index]
        return max(0.18, min(round(derived, 2), 0.65))

    def build_phrase_boundaries(self, words: List[Word], pause_threshold: float) -> List[Dict[str, Any]]:
        if not words:
            return []
        boundaries: Dict[float, Dict[str, Any]] = {}

        def register_boundary(time_value: float, strength: float, reason: str):
            rounded_time = round(max(0.0, time_value), 2)
            existing = boundaries.get(rounded_time)
            if existing:
                existing["strength"] = max(existing["strength"], strength)
                if reason not in existing["reason"]:
                    existing["reason"] = f"{existing['reason']}, {reason}"
                return
            boundaries[rounded_time] = {
                "time": rounded_time,
                "strength": round(strength, 2),
                "reason": reason,
            }

        register_boundary(words[0]["start"], 3.0, "intro")
        soft_gap_floor = max(0.18, round(pause_threshold * 0.55, 2))
        for index in range(1, len(words)):
            current = words[index]
            previous = words[index - 1]
            gap_before = max(0.0, round(current["start"] - previous["end"], 2))
            previous_token = previous.get("punctuated_word") or previous.get("word") or ""
            strength = 0.0
            reasons: List[str] = []
            if gap_before >= pause_threshold:
                strength += 1.4 + min(1.4, gap_before / max(pause_threshold, 0.01))
                reasons.append("pause")
            elif gap_before >= soft_gap_floor:
                strength += 0.55
                reasons.append("micro_pause")
            if STRONG_BOUNDARY_RE.search(previous_token):
                strength += 1.25
                reasons.append("sentence_end")
            elif SOFT_BOUNDARY_RE.search(previous_token):
                strength += 0.7
                reasons.append("comma")
            if strength > 0:
                register_boundary(current["start"], strength, "+".join(reasons) or "phrase")

        register_boundary(words[-1]["end"], 3.5, "outro")
        return sorted(boundaries.values(), key=lambda item: item["time"])

    def select_boundary(self, boundaries: List[Dict[str, Any]], min_time: float, target_time: float, max_time: float, fallback_extension: float = 0.75) -> Dict[str, Any] | None:
        candidates = [b for b in boundaries if min_time <= b["time"] <= max_time]
        if not candidates:
            candidates = [b for b in boundaries if min_time <= b["time"] <= max_time + fallback_extension]
        if not candidates:
            return None
        return min(candidates, key=lambda b: (abs(b["time"] - target_time) + (0.8 if b["time"] > max_time else 0.0) - (b.get("strength", 0.0) * 0.3)))

    def build_slots(self, words: List[Word]) -> List[TimingSlot]:
        if self.config.timing_mode == "fixed":
            return self._build_fixed_slots(words)
        if self.config.timing_mode == "coverage_percent":
            return self._build_coverage_slots(words)
        return self._build_semantic_slots(words)

    def _build_fixed_slots(self, words: List[Word]) -> List[TimingSlot]:
        interval = self.config.interval
        max_end = max((w["end"] for w in words), default=0.0)
        slots: List[TimingSlot] = []
        current = max(interval, FIRST_ATTENTION_CUT_MIN_SECONDS)
        while current <= max_end + 0.01:
            slots.append({
                "slot_start": round(current, 1),
                "slot_end": round(min(current + interval, max_end), 1),
            })
            current += interval * 2.0
        return slots

    def _build_semantic_slots(self, words: List[Word]) -> List[TimingSlot]:
        boundaries = self.build_phrase_boundaries(words, self.config.pause_threshold)
        if len(boundaries) < 2: return self._build_fixed_slots(words)
        interval = self.config.interval
        profile = PACING_PRESETS[self.config.pacing_profile]
        max_end = words[-1]["end"]
        min_gap = max(profile["min_avatar_gap_floor"], round(interval * profile["min_avatar_gap_factor"], 2))
        target_gap = max(profile["target_avatar_gap_floor"], round(interval * profile["target_avatar_gap_factor"], 2))
        max_gap = max(profile["max_avatar_gap_floor"], round(interval * profile["max_avatar_gap_factor"], 2))
        slot_min, slot_target, slot_max = profile["slot_min"], profile["slot_target"], profile["slot_max"]
        slots: List[TimingSlot] = []
        cursor = 0.0
        while cursor + min_gap + slot_min <= max_end:
            current_min_gap = max(min_gap, FIRST_ATTENTION_CUT_MIN_SECONDS) if not slots else min_gap
            start_b = self.select_boundary(boundaries, cursor + current_min_gap, cursor + max(current_min_gap, target_gap), min(cursor + max_gap, max_end - slot_min), 0.9)
            if not start_b: break
            slot_start = round(start_b["time"], 2)
            if slot_start < cursor:
                cursor = round(slot_start + 0.05, 2)
                continue
            if max_end - slot_start < slot_min: break
            end_b = self.select_boundary(boundaries, slot_start + slot_min, slot_start + slot_target, min(slot_start + slot_max, max_end), 0.45)
            slot_end = round(end_b["time"], 2) if end_b else round(min(slot_start + slot_target, max_end), 2)
            if slot_end - slot_start < slot_min: slot_end = round(min(max_end, slot_start + slot_min), 2)
            slots.append({"slot_start": round(slot_start, 1), "slot_end": round(slot_end, 1)})
            cursor = slot_end
        return slots or self._build_fixed_slots(words)

    def _build_coverage_slots(self, words: List[Word]) -> List[TimingSlot]:
        max_end = words[-1]["end"]
        min_clip_len = 2.0
        coverage = self.config.coverage_percent
        if coverage >= 95.0:
            return [{"slot_start": FIRST_ATTENTION_CUT_MIN_SECONDS, "slot_end": round(max_end, 1)}]
        boundaries = self.build_phrase_boundaries(words, self.derive_automatic_pause_threshold(words))
        profile = PACING_PRESETS[self.config.pacing_profile]
        target_broll = round(max_end * (coverage / 100.0), 2)
        cursor = FIRST_ATTENTION_CUT_MIN_SECONDS
        target_slot_len = max(min_clip_len, profile.get("slot_target", 3.0))
        num_clips = max(1, round(target_broll / target_slot_len))
        actual_avatar_needed = (max_end - cursor) - target_broll
        gaps_possible = int(max(0, actual_avatar_needed) / 2.0)
        gap_indices = set(int(g * (num_clips / (gaps_possible + 1))) for g in range(1, gaps_possible + 1)) if gaps_possible > 0 else set()
        slots: List[TimingSlot] = []
        current_broll = 0.0
        for i in range(num_clips):
            if cursor + min_clip_len > max_end: break
            if i > 0 and i in gap_indices:
                gap_len = max(2.0, actual_avatar_needed / (gaps_possible or 1))
                b = self.select_boundary(boundaries, cursor + 2.0, cursor + gap_len, min(cursor + gap_len + 1.5, max_end - min_clip_len), 1.0)
                cursor = round(b["time"], 1) if b else round(cursor + gap_len, 1)
            if cursor + min_clip_len > max_end: break
            ideal_len = min(profile["slot_max"], max(min_clip_len, (target_broll - current_broll) / (num_clips - i)))
            b = self.select_boundary(boundaries, cursor + min_clip_len, cursor + ideal_len, min(cursor + ideal_len + 1.0, max_end), 0.5)
            slot_end = round(b["time"], 1) if b else round(min(cursor + ideal_len, max_end), 1)
            if slot_end - cursor < min_clip_len: slot_end = round(min(max_end, cursor + min_clip_len), 1)
            slots.append({"slot_start": round(cursor, 1), "slot_end": round(slot_end, 1)})
            current_broll += (slot_end - cursor)
            cursor = slot_end
        return slots

# --- ASSET MANAGER ---

class ProductAssetManager:
    def __init__(self, config: GenerationConfig):
        self.config = config

    def pick_asset(self) -> Optional[Dict[str, Any]]:
        assets = self.config.product_media_assets or []
        normalized: List[Dict[str, Any]] = []
        for asset in assets:
            if not isinstance(asset, dict): continue
            url = str(asset.get("url") or "").strip()
            if not url: continue
            normalized.append({
                "id": str(asset.get("id") or url).strip(),
                "url": url,
                "name": str(asset.get("name") or asset.get("id") or "Product Asset").strip(),
                "source_type": str(asset.get("source_type") or "video").strip(),
            })
        if normalized: return random.choice(normalized)
        fallback_url = str(self.config.product_video_url or "").strip()
        if not fallback_url: return None
        return {"id": fallback_url, "url": fallback_url, "name": "Product Video", "source_type": "video"}

    def apply_assets(self, segments: List[VisualSegment], words: List[Word], slots: List[TimingSlot]) -> List[VisualSegment]:
        prod_keyword = (self.config.product_keyword or "").lower().strip()
        if not prod_keyword: return segments
        result: List[VisualSegment] = []
        for seg in segments:
            combined = f"{seg.get('keyword', '')} {seg.get('phrase', '')}".lower()
            if prod_keyword in combined:
                asset = self.pick_asset()
                seg.update({
                    "asset_type": "product_video",
                    "asset_url": asset["url"] if asset else self.config.product_video_url,
                    "asset_id": asset["id"] if asset else None,
                    "asset_name": asset["name"] if asset else None,
                    "generate_video": False,
                    "keyword": self.config.product_keyword,
                })
            else:
                seg.update({"asset_type": "generated_video", "generate_video": True})
            result.append(seg)
        
        # Force product segment if required
        has_prod = any(s.get("asset_type") == "product_video" for s in result)
        if self.config.product_clip_policy == "required" and not has_prod:
            forced = self._find_forced_product_segment(words, slots, prod_keyword)
            if forced:
                asset = self.pick_asset()
                forced.update({"asset_url": asset["url"] if asset else self.config.product_video_url})
                result.append(forced)
        return result

    def _find_forced_product_segment(self, words: List[Word], slots: List[TimingSlot], keyword: str) -> Optional[VisualSegment]:
        for slot in slots:
            slot_words = [w for w in words if w["start"] >= slot["slot_start"] and w["start"] < slot["slot_end"]]
            combined = " ".join(w["word"] for w in slot_words).lower()
            if keyword in combined:
                return {
                    "slot_start": slot["slot_start"],
                    "slot_end": slot["slot_end"],
                    "keyword": self.config.product_keyword,
                    "phrase": combined[:50],
                    "asset_type": "product_video",
                    "generate_video": False,
                    "reason": "forced_by_policy"
                }
        return None

# --- SEGMENT PROCESSOR ---

class VisualSegmentProcessor:
    def __init__(self, config: GenerationConfig, total_duration: float):
        self.config = config
        self.total_duration = total_duration
        self.profile = PACING_PRESETS[self.config.pacing_profile]

    def process(self, segments: List[VisualSegment]) -> List[VisualSegment]:
        if not segments: return []
        ordered = self._resolve_overlaps(segments)
        enforced = self._enforce_first_attention_cut(ordered)
        capped = self._enforce_coverage_limit(enforced)
        final = self._enforce_minimum_durations(capped)
        return final

    def _resolve_overlaps(self, segments: List[VisualSegment]) -> List[VisualSegment]:
        if not segments: return []
        min_avatar_len = 2.0
        min_slot_len = self.profile["slot_min"]
        ordered = sorted((dict(s) for s in segments), key=lambda x: (x["slot_start"], x.get("slot_end", 0)))
        resolved: List[VisualSegment] = []
        for seg in ordered:
            start = seg["slot_start"]
            end = seg.get("slot_end", start + min_slot_len)
            if resolved:
                prev_end = resolved[-1]["slot_end"]
                if start < prev_end + min_avatar_len:
                    if start < prev_end or (start - prev_end < min_avatar_len):
                        start = prev_end
                if end - start < min_slot_len:
                    end = min(self.total_duration, start + min_slot_len)
            if end - start < min_slot_len or start >= self.total_duration:
                continue
            seg["slot_start"], seg["slot_end"] = round(start, 1), round(min(end, self.total_duration), 1)
            resolved.append(seg)
        return resolved

    def _enforce_first_attention_cut(self, segments: List[VisualSegment]) -> List[VisualSegment]:
        if not segments or self.total_duration <= FIRST_ATTENTION_CUT_MAX_SECONDS + 1.0:
            return segments
        first = segments[0]
        if FIRST_ATTENTION_CUT_MIN_SECONDS <= first["slot_start"] <= FIRST_ATTENTION_CUT_MAX_SECONDS:
            return segments
        duration = max(MIN_BROLL_SEGMENT_SECONDS, first["slot_end"] - first["slot_start"])
        first["slot_start"] = round(FIRST_ATTENTION_CUT_MIN_SECONDS, 1)
        first["slot_end"] = round(min(self.total_duration, FIRST_ATTENTION_CUT_MIN_SECONDS + duration), 1)
        if first["slot_end"] - first["slot_start"] < 0.5:
            return segments[1:]
        first["reason"] = f"{first.get('reason', '')}; forced_first_cut".strip("; ")
        return self._resolve_overlaps(segments)

    def _enforce_coverage_limit(self, segments: List[VisualSegment]) -> List[VisualSegment]:
        coverage_target = self.config.coverage_percent
        if not segments or self.total_duration <= 0 or coverage_target >= 95.0:
            return segments
        max_allowed = self.total_duration * (min(coverage_target + 15.0, 100.0) / 100.0)
        def dur(s): return s["slot_end"] - s["slot_start"]
        current_total = sum(dur(s) for s in segments)
        if current_total <= max_allowed: return segments
        droppable = [i for i, s in enumerate(segments) if i > 0 and s.get("asset_type") != "product_video"]
        if not droppable: return segments
        excess = current_total - max_allowed
        avg_dur = sum(dur(segments[i]) for i in droppable) / len(droppable)
        num_to_drop = min(len(droppable), max(1, round(excess / (avg_dur or 1.0))))
        drop_indices = set()
        stride = len(droppable) / num_to_drop
        for k in range(num_to_drop):
            pick = min(int(k * stride + stride / 2), len(droppable) - 1)
            drop_indices.add(droppable[pick])
        while sum(dur(s) for i, s in enumerate(segments) if i not in drop_indices) > max_allowed and len(drop_indices) < len(droppable):
            for idx in droppable:
                if idx not in drop_indices:
                    drop_indices.add(idx)
                    break
        return [s for i, s in enumerate(segments) if i not in drop_indices]

    def _enforce_minimum_durations(self, segments: List[VisualSegment]) -> List[VisualSegment]:
        for i, seg in enumerate(segments):
            start, end = seg["slot_start"], seg["slot_end"]
            min_dur = MIN_PRODUCT_SEGMENT_SECONDS if seg.get("asset_type") == "product_video" else MIN_BROLL_SEGMENT_SECONDS
            if end - start >= min_dur - 0.01: continue
            prev_end = segments[i-1]["slot_end"] if i > 0 else 0.0
            next_start = segments[i+1]["slot_start"] if i+1 < len(segments) else self.total_duration
            needed = min_dur - (end - start)
            ext_right = min(needed, next_start - end)
            end += ext_right
            needed -= ext_right
            if needed > 0:
                shift_left = min(needed, start - prev_end)
                start -= shift_left
            seg["slot_start"], seg["slot_end"] = round(start, 1), round(min(end, self.total_duration), 1)
        return segments

# --- PROMPT BUILDER ---

class VisualPromptBuilder:
    def __init__(self, config: GenerationConfig):
        self.config = config

    def build_system_prompt(self, scenario_text: str) -> str:
        prompt = f"""SYSTEM:
Ты — эксперт по видеомонтажу и UGC. Твоя задача — отобрать визуальные образы из сценария.
Сценарий: {scenario_text}

ГЛАВНАЯ ДИРЕКТИВА:
- Визуализируй прямой смысл (Literal Meaning).
- Кадр строго 9:16 Cinematic Flow.
- Никаких брендов и логотипов.

ИНСТРУКЦИИ:
- keyword: Главный объект (RU)
- phrase: Действие или контекст        - **visual_intent**: A technical description for the video generator (EN). 
          Structure: [Shot Scale (CU/MS/WS)] + [Subject & Action] + [Cinematography/Lighting].
          Example: "CU of a hand holding a gold credit card, Dolly In, warm Rembrandt lighting, 4K textures."

    **TECHNICAL GUIDELINES (Veo-3 Meta-Framework):**
    - **Cinematography**: Use Dolly, Truck, Pan, Tilt, Arc movements.
    - **Shot Scales**: CU (Close-up), MS (Medium Shot), WS (Wide Shot), POV (Point of View), Over-shoulder.
    - **Lighting**: Golden hour, Volumetric, Rembrandt, Soft diffused, Neon reflections.
    - **No Vague Words**: Avoid "cinematic", "amazing", "beautiful". Use physical facts.
    - **Appearance**: Visible people must be European-looking (light skin).
"""
        if self.config.learned_rules:
            prompt += f"\nДОПОЛНИТЕЛЬНЫЕ ПРАВИЛА ОТ ПОЛЬЗОВАТЕЛЯ:\n{self.config.learned_rules}\n"
        return prompt

    def build_user_prompt(self, transcript: str, slots: List[TimingSlot]) -> str:
        return f"""TRANSCRIPT: {transcript}
SLOTS: {json.dumps(slots)}
ВЕРНИ JSON: {{ "segments": [...] }}"""

# --- ORCHESTRATOR ---

def extract_visual_keyword_segments(scenario_text: str, tts_text: str, transcript: str, words: List[Dict[str, Any]], **kwargs) -> Dict[str, Any]:
    try:
        config = GenerationConfig(
            interval=kwargs.get("broll_interval_seconds", 3.0),
            timing_mode=kwargs.get("broll_timing_mode", "semantic_pause"),
            pacing_profile=kwargs.get("broll_pacing_profile", "balanced"),
            coverage_percent=kwargs.get("broll_coverage_percent", 35.0),
            product_keyword=kwargs.get("product_keyword"),
            product_video_url=kwargs.get("product_video_url"),
            product_media_assets=kwargs.get("product_media_assets"),
            learned_rules=kwargs.get("learned_rules_visual"),
            product_clip_policy=kwargs.get("product_clip_policy", "contextual")
        )
        engine = TimingEngine(config)
        norm_words = engine.normalize_words(words)
        if not norm_words: return {"segments": [], "updated_at": datetime.now(timezone.utc).isoformat()}
        slots = engine.build_slots(norm_words)
        total_dur = norm_words[-1]["end"]
        
        # 1. Build LLM Segments
        segments = _build_semantic_llm_segments(config, scenario_text, transcript, slots)
        if not segments:
            segments = _fallback_segments(norm_words, slots)
            
        # 2. Handle product assets
        asset_mgr = ProductAssetManager(config)
        segments = asset_mgr.apply_assets(segments, norm_words, slots)
        
        # 3. Final Guardrails
        processor = VisualSegmentProcessor(config, total_dur)
        final_segments = processor.process(segments)
        
        return {"segments": final_segments, "updated_at": datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        logger.error(f"Failed to extract segments: {e}")
        return {"segments": [], "updated_at": datetime.now(timezone.utc).isoformat()}

def _build_semantic_llm_segments(config: GenerationConfig, scenario: str, transcript: str, slots: List[TimingSlot]) -> Optional[List[VisualSegment]]:
    try:
        builder = VisualPromptBuilder(config)
        client = _openrouter_client()
        response = client.chat.completions.create(
            model="google/gemini-2.5-flash",
            messages=[
                {"role": "system", "content": builder.build_system_prompt(scenario)},
                {"role": "user", "content": builder.build_user_prompt(transcript, slots)}
            ],
            response_format={"type": "json_object"}
        )
        data = json.loads(response.choices[0].message.content)
        return data.get("segments")
    except Exception as e:
        logger.warning(f"LLM extraction failed: {e}")
        return None

def _fallback_segments(words: List[Word], slots: List[TimingSlot]) -> List[VisualSegment]:
    segments: List[VisualSegment] = []
    for slot in slots:
        slot_words = [w for w in words if w["start"] >= slot["slot_start"] and w["start"] < slot["slot_end"]]
        if not slot_words: continue
        chosen = max(slot_words, key=lambda w: len(w["word"]))
        segments.append({
            "slot_start": slot["slot_start"],
            "slot_end": slot["slot_end"],
            "keyword": chosen["word"],
            "phrase": " ".join(w["word"] for w in slot_words[:5]),
            "word_start": chosen["start"],
            "word_end": chosen["end"],
            "reason": "fallback"
        })
    return segments
