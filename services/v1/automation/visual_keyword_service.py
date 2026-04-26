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
    asset_duration_seconds: Optional[float]
    generate_video: bool

@dataclass
class GenerationConfig:
    interval: float = 3.0
    timing_mode: str = "coverage_percent"
    pacing_profile: str = "balanced"
    pause_threshold: float = 0.45
    coverage_percent: float = 55.0
    relevance_priority: str = "balanced"
    product_clip_policy: str = "contextual"
    product_keyword: Optional[str] = None
    product_video_url: Optional[str] = None
    product_media_assets: Optional[List[Dict[str, Any]]] = None
    learned_rules: Optional[str] = None

# --- CONSTANTS ---

STRONG_BOUNDARY_RE = re.compile(r"[.!?;:]$")
SOFT_BOUNDARY_RE = re.compile(r"[,)]$")
PRODUCT_KEYWORD_SPLIT_RE = re.compile(r"[,\n;]+")
NON_ALNUM_RE = re.compile(r"[^0-9a-zA-Zа-яА-ЯёЁ]+")
AVATAR_ONLY_HOOK_SECONDS = 2.8
MIN_BROLL_SEGMENT_SECONDS = 2.0
MIN_PRODUCT_SEGMENT_SECONDS = 3.0
FIRST_ATTENTION_CUT_MIN_SECONDS = AVATAR_ONLY_HOOK_SECONDS
PRODUCT_CLIP_LEAD_SECONDS = 0.2
PRODUCT_CLIP_DEFAULT_SECONDS = 4.0
PRODUCT_CLIP_MAX_SECONDS = 5.0
PRODUCT_CLIP_COOLDOWN_SECONDS = 12.0
PRODUCT_CLIP_MERGE_GAP_SECONDS = 1.0

RUSSIAN_STEM_SUFFIXES = (
    "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими", "его", "ее",
    "ая", "яя", "ое", "ее", "ов", "ев", "ом", "ем", "ой", "ей", "ам", "ям",
    "ах", "ях", "ую", "юю", "ия", "ья", "ию", "ью", "ий", "ый", "ой", "ых", "их",
    "а", "я", "ы", "и", "е", "у", "ю", "о",
)

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


def _normalize_text(value: str) -> str:
    cleaned = NON_ALNUM_RE.sub(" ", (value or "").lower().replace("ё", "е"))
    return " ".join(cleaned.split())


def _parse_product_keywords(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    seen: set[str] = set()
    result: List[str] = []
    for item in PRODUCT_KEYWORD_SPLIT_RE.split(raw):
        phrase = " ".join(str(item or "").strip().split())
        if not phrase:
            continue
        norm = _normalize_text(phrase)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        result.append(phrase)
    return result


def _stem_token(token: str) -> str:
    t = token.strip()
    if len(t) <= 3:
        return t
    for suffix in RUSSIAN_STEM_SUFFIXES:
        if t.endswith(suffix) and len(t) - len(suffix) >= 3:
            return t[: -len(suffix)]
    return t


def _tokenize(value: str) -> List[str]:
    normalized = _normalize_text(value)
    if not normalized:
        return []
    return normalized.split()


def _contains_contiguous_sequence(haystack: List[str], needle: List[str]) -> bool:
    if not haystack or not needle or len(needle) > len(haystack):
        return False
    window = len(needle)
    for index in range(0, len(haystack) - window + 1):
        if haystack[index:index + window] == needle:
            return True
    return False


def _get_timestamped_transcript(words: List[Word]) -> str:
    """Creates a transcript string with embedded timestamps for the LLM."""
    chunks = []
    for w in words:
        chunks.append(f"{w['word']} ({w['start']}s)")
    return " ".join(chunks)


def _keyword_matches_phrase(keyword: str, phrase: str) -> bool:
    keyword_tokens = _tokenize(keyword)
    phrase_tokens = _tokenize(phrase)
    if not keyword_tokens or not phrase_tokens:
        return False

    # For multi-word product keys require contiguous phrase match in the same order.
    if len(keyword_tokens) > 1:
        if _contains_contiguous_sequence(phrase_tokens, keyword_tokens):
            return True
        keyword_stems = [_stem_token(token) for token in keyword_tokens]
        phrase_stems = [_stem_token(token) for token in phrase_tokens]
        return _contains_contiguous_sequence(phrase_stems, keyword_stems)

    keyword_token = keyword_tokens[0]
    if keyword_token in phrase_tokens:
        return True

    keyword_stem = _stem_token(keyword_token)
    return any(_stem_token(token) == keyword_stem for token in phrase_tokens)


def _find_matching_product_keyword(product_keywords: List[str], phrase: str) -> Optional[str]:
    for keyword in product_keywords:
        if _keyword_matches_phrase(keyword, phrase):
            return keyword
    return None


def _resolve_primary_product_duration_seconds(config: GenerationConfig) -> float:
    primary_url = str(config.product_video_url or "").strip()
    assets = config.product_media_assets or []

    if isinstance(assets, list):
        if primary_url:
            for asset in assets:
                if not isinstance(asset, dict):
                    continue
                if str(asset.get("url") or "").strip() != primary_url:
                    continue
                duration = _safe_float(asset.get("duration_seconds"), 0.0)
                if duration > 0:
                    return duration
        for asset in assets:
            if not isinstance(asset, dict):
                continue
            if str(asset.get("source_type") or "video").strip().lower() == "image":
                continue
            duration = _safe_float(asset.get("duration_seconds"), 0.0)
            if duration > 0:
                return duration

    if primary_url:
        return 4.0
    return 0.0

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
        # Timing mode is intentionally unified to coverage-based selection.
        return self._build_coverage_slots(words)

    def _build_fixed_slots(self, words: List[Word]) -> List[TimingSlot]:
        interval = self.config.interval
        max_end = max((w["end"] for w in words), default=0.0)
        slots: List[TimingSlot] = []
        current = max(interval, 2.0)
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

    def pick_asset(self, exclude_ids: Optional[set[str]] = None) -> Optional[Dict[str, Any]]:
        assets = self.config.product_media_assets or []
        normalized: List[Dict[str, Any]] = []
        for asset in assets:
            if not isinstance(asset, dict): continue
            url = str(asset.get("url") or "").strip()
            aid = str(asset.get("id") or url).strip()
            if not url: continue
            if exclude_ids and aid in exclude_ids and len(assets) > len(exclude_ids):
                continue
            normalized.append({
                "id": aid,
                "url": url,
                "name": str(asset.get("name") or asset.get("id") or "Product Asset").strip(),
                "source_type": str(asset.get("source_type") or "video").strip(),
                "duration_seconds": _safe_float(asset.get("duration_seconds"), 0.0),
            })

        primary_url = str(self.config.product_video_url or "").strip()
        if primary_url and (not exclude_ids or primary_url not in exclude_ids):
            primary_asset = next((asset for asset in normalized if str(asset.get("url") or "").strip() == primary_url), None)
            if primary_asset:
                return primary_asset
            return {
                "id": primary_url,
                "url": primary_url,
                "name": "Product Video",
                "source_type": "video",
                # Default upload duration in this workspace is 4s; keep full clip by default.
                "duration_seconds": 4.0,
            }

        video_assets = [asset for asset in normalized if str(asset.get("source_type") or "").strip().lower() != "image"]
        if video_assets:
            return random.choice(video_assets)

        if normalized:
            return random.choice(normalized)

        return None

    def _resolve_product_clip_duration(self, asset: Optional[Dict[str, Any]] = None) -> float:
        duration = _safe_float((asset or {}).get("duration_seconds"), 0.0)
        if duration <= 0:
            duration = _resolve_primary_product_duration_seconds(self.config)
        if duration <= 0:
            duration = PRODUCT_CLIP_DEFAULT_SECONDS
        return min(max(duration, MIN_PRODUCT_SEGMENT_SECONDS), PRODUCT_CLIP_MAX_SECONDS)

    def _build_product_mention_segments(self, words: List[Word], total_duration: float) -> List[VisualSegment]:
        product_keywords = _parse_product_keywords(self.config.product_keyword)
        if not product_keywords or not words or total_duration <= AVATAR_ONLY_HOOK_SECONDS:
            return []

        mentions: List[VisualSegment] = []
        used_asset_ids: set[str] = set()
        last_product_end = -100.0
        word_tokens = [_tokenize(w["word"]) for w in words]
        word_stems = [[_stem_token(token) for token in tokens] for tokens in word_tokens]

        for keyword in product_keywords:
            keyword_tokens = _tokenize(keyword)
            if not keyword_tokens:
                continue
            keyword_stems = [_stem_token(token) for token in keyword_tokens]
            window = len(keyword_stems)
            if window <= 0 or window > len(words):
                continue

            for index in range(0, len(words) - window + 1):
                candidate = [stems[0] if stems else "" for stems in word_stems[index:index + window]]
                if candidate != keyword_stems:
                    continue

                keyword_start = _safe_float(words[index].get("start"), 0.0)
                keyword_end = _safe_float(words[index + window - 1].get("end"), keyword_start)
                start = max(AVATAR_ONLY_HOOK_SECONDS, keyword_start - PRODUCT_CLIP_LEAD_SECONDS)
                if start < last_product_end + PRODUCT_CLIP_COOLDOWN_SECONDS:
                    continue

                asset = self.pick_asset(exclude_ids=used_asset_ids)
                if not asset:
                    continue

                used_asset_ids.add(asset["id"])
                duration = self._resolve_product_clip_duration(asset)
                end = min(total_duration, start + duration)
                if end - start < MIN_PRODUCT_SEGMENT_SECONDS:
                    start = max(AVATAR_ONLY_HOOK_SECONDS, end - MIN_PRODUCT_SEGMENT_SECONDS)
                if end - start < MIN_PRODUCT_SEGMENT_SECONDS:
                    continue

                mention_words = words[index:index + window]
                phrase = " ".join(w["punctuated_word"] or w["word"] for w in mention_words)
                mentions.append({
                    "slot_start": round(start, 2),
                    "slot_end": round(end, 2),
                    "word_start": round(keyword_start, 2),
                    "word_end": round(keyword_end, 2),
                    "keyword": keyword,
                    "phrase": phrase,
                    "visual_intent": "product proof clip timed to the spoken product mention",
                    "asset_type": "product_video",
                    "asset_url": asset["url"],
                    "asset_id": asset["id"],
                    "asset_name": asset["name"],
                    "asset_duration_seconds": _safe_float(asset.get("duration_seconds"), duration),
                    "generate_video": False,
                    "clip_role": "product_demo",
                    "reason": "direct_product_mention_timing",
                })
                last_product_end = end

        return self._merge_product_segments(sorted(mentions, key=lambda seg: (seg["slot_start"], seg["slot_end"])))

    def _merge_product_segments(self, segments: List[VisualSegment]) -> List[VisualSegment]:
        merged: List[VisualSegment] = []
        for seg in segments:
            prev = merged[-1] if merged else None
            if (
                prev
                and _safe_float(seg.get("slot_start"), 0.0) <= _safe_float(prev.get("slot_end"), 0.0) + PRODUCT_CLIP_MERGE_GAP_SECONDS
                and str(prev.get("asset_url") or "") == str(seg.get("asset_url") or "")
            ):
                prev["slot_end"] = round(max(_safe_float(prev.get("slot_end"), 0.0), _safe_float(seg.get("slot_end"), 0.0)), 2)
                prev["word_end"] = round(max(_safe_float(prev.get("word_end"), 0.0), _safe_float(seg.get("word_end"), 0.0)), 2)
                prev["phrase"] = " ".join(filter(None, [str(prev.get("phrase") or ""), str(seg.get("phrase") or "")])).strip()
                prev["reason"] = f"{prev.get('reason', '')}; merged_direct_product_mention".strip("; ")
                continue
            merged.append(dict(seg))
        return merged

    def _subtract_product_windows(self, segment: VisualSegment, product_segments: List[VisualSegment]) -> List[VisualSegment]:
        fragments: List[VisualSegment] = [dict(segment)]
        for product in product_segments:
            product_start = _safe_float(product.get("slot_start"), 0.0)
            product_end = _safe_float(product.get("slot_end"), 0.0)
            next_fragments: List[VisualSegment] = []
            for fragment in fragments:
                start = _safe_float(fragment.get("slot_start"), 0.0)
                end = _safe_float(fragment.get("slot_end"), start)
                if product_end <= start or product_start >= end:
                    next_fragments.append(fragment)
                    continue
                if product_start > start:
                    left = dict(fragment)
                    left["slot_end"] = round(product_start, 2)
                    if left["slot_end"] - start >= MIN_BROLL_SEGMENT_SECONDS:
                        next_fragments.append(left)
                if product_end < end:
                    right = dict(fragment)
                    right["slot_start"] = round(product_end, 2)
                    if end - right["slot_start"] >= MIN_BROLL_SEGMENT_SECONDS:
                        next_fragments.append(right)
            fragments = next_fragments
            if not fragments:
                break
        return fragments

    def apply_assets(self, segments: List[VisualSegment], words: List[Word], slots: List[TimingSlot]) -> List[VisualSegment]:
        product_keywords = _parse_product_keywords(self.config.product_keyword)
        total_duration = words[-1]["end"] if words else 0.0
        direct_product_segments = self._build_product_mention_segments(words, total_duration)
        if not product_keywords:
            return segments
        
        policy = self.config.product_clip_policy # "required" or "contextual"
        result: List[VisualSegment] = []
        
        last_product_end = -100.0 # Track when the last product clip ended
        used_asset_ids: set[str] = set()
        product_cooldown = PRODUCT_CLIP_COOLDOWN_SECONDS # Minimum gap between two product clips
        merge_adjacent_product_gap = PRODUCT_CLIP_MERGE_GAP_SECONDS # Merge adjacent/near product mentions into one clip window
        
        for seg in segments:
            # Check LLM's identified keyword and phrase, and the actual transcript words in this slot
            phrase = str(seg.get("phrase") or "")
            segment_keyword = str(seg.get("keyword") or "")
            slot_start = float(seg.get("slot_start", 0.0))
            
            # 1. Match against LLM fields
            matched_keyword = _find_matching_product_keyword(product_keywords, phrase)
            if not matched_keyword:
                matched_keyword = _find_matching_product_keyword(product_keywords, segment_keyword)
            
            # 2. Safety net: Match against actual words spoken in this segment
            if not matched_keyword and words:
                slot_words = [w["word"] for w in words if w["start"] >= slot_start and w["start"] < seg.get("slot_end", slot_start + 3.0)]
                combined_transcript = " ".join(slot_words)
                matched_keyword = _find_matching_product_keyword(product_keywords, combined_transcript)

            keyword_match = matched_keyword is not None
            
            # Logic:
            # REQUIRED -> If word in text, MUST be product.
            # CONTEXTUAL -> If AI recommended it OR (word in text AND AI matched it)
            
            use_product = False
            if policy == "required":
                use_product = keyword_match
            else: # contextual
                use_product = bool(seg.get("should_use_product_clip", False) or keyword_match)

            # --- COOLDOWN & DUPLICATE PROTECTION ---
            if use_product:
                # If we are in cooldown, force back to generated video unless it's 'required' and we have no choice
                if (slot_start < last_product_end + product_cooldown) and policy != "required":
                    use_product = False
                    seg["reason"] = f"{seg.get('reason', '')}; product_cooldown_active".strip("; ")

            if use_product:
                # Merge consecutive product mentions into a single product segment
                # so montage uses one full clip instead of duplicated back-to-back inserts.
                if result and result[-1].get("asset_type") == "product_video":
                    prev = result[-1]
                    prev_end = _safe_float(prev.get("slot_end"), slot_start)
                    current_end = _safe_float(seg.get("slot_end"), slot_start + MIN_PRODUCT_SEGMENT_SECONDS)
                    gap = slot_start - prev_end
                    prev_keyword_norm = _normalize_text(str(prev.get("keyword") or ""))
                    curr_keyword_norm = _normalize_text(str(matched_keyword or segment_keyword or self.config.product_keyword or ""))
                    same_keyword = bool(prev_keyword_norm and curr_keyword_norm and prev_keyword_norm == curr_keyword_norm)

                    if gap <= merge_adjacent_product_gap or (same_keyword and gap <= 3.0):
                        prev["slot_end"] = round(max(prev_end, current_end), 2)
                        prev_word_end = _safe_float(prev.get("word_end"), prev_end)
                        curr_word_end = _safe_float(seg.get("word_end"), current_end)
                        prev["word_end"] = round(max(prev_word_end, curr_word_end), 2)
                        prev["reason"] = f"{prev.get('reason', '')}; merged_adjacent_product_segment".strip("; ")
                        last_product_end = _safe_float(prev.get("slot_end"), last_product_end)
                        continue

                asset = self.pick_asset(exclude_ids=used_asset_ids)
                if asset:
                    used_asset_ids.add(asset["id"])
                    last_product_end = float(seg.get("slot_end", slot_start + 3.0))
                    seg.update({
                        "asset_type": "product_video",
                        "asset_url": asset["url"],
                        "asset_id": asset["id"],
                        "asset_name": asset["name"],
                        "asset_duration_seconds": _safe_float(asset.get("duration_seconds"), 0.0),
                        "generate_video": False,
                        "keyword": matched_keyword or self.config.product_keyword,
                        "clip_role": "product_demo",
                    })
                else:
                    # No more unique assets or failed to pick one? Fallback to generation
                    use_product = False

            if not use_product:
                seg.update({"asset_type": "generated_video", "generate_video": True})
            
            result.append(seg)

        product_segments = self._merge_product_segments([
            *[dict(seg) for seg in result if seg.get("asset_type") == "product_video"],
            *direct_product_segments,
        ])
        non_product_segments = [dict(seg) for seg in result if seg.get("asset_type") != "product_video"]

        carved_non_products: List[VisualSegment] = []
        for seg in non_product_segments:
            carved_non_products.extend(self._subtract_product_windows(seg, product_segments))

        return sorted([*product_segments, *carved_non_products], key=lambda seg: (_safe_float(seg.get("slot_start"), 0.0), _safe_float(seg.get("slot_end"), 0.0)))

    def _find_forced_product_segment(self, words: List[Word], slots: List[TimingSlot], keyword: str) -> Optional[VisualSegment]:
        normalized_keywords = _parse_product_keywords(keyword)
        if not normalized_keywords:
            return None
        for slot in slots:
            slot_words = [w for w in words if w["start"] >= slot["slot_start"] and w["start"] < slot["slot_end"]]
            combined = " ".join(w["word"] for w in slot_words)
            matched_keyword = _find_matching_product_keyword(normalized_keywords, combined)
            if matched_keyword:
                return {
                    "slot_start": slot["slot_start"],
                    "slot_end": slot["slot_end"],
                    "keyword": matched_keyword,
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
        after_hook = self._enforce_avatar_only_hook(segments)
        ordered = self._resolve_overlaps(after_hook)
        capped = self._enforce_coverage_limit(ordered)
        final = self._enforce_minimum_durations(capped)
        return final

    def _enforce_avatar_only_hook(self, segments: List[VisualSegment]) -> List[VisualSegment]:
        if not segments:
            return []
        results: List[VisualSegment] = []
        for seg in segments:
            item = dict(seg)
            start = _safe_float(item.get("slot_start"), 0.0)
            end = _safe_float(item.get("slot_end"), start)
            if end <= AVATAR_ONLY_HOOK_SECONDS:
                item["reason"] = f"{item.get('reason', '')}; dropped_inside_avatar_hook".strip("; ")
                continue
            if start < AVATAR_ONLY_HOOK_SECONDS:
                item["slot_start"] = round(AVATAR_ONLY_HOOK_SECONDS, 2)
                item["reason"] = f"{item.get('reason', '')}; shifted_after_avatar_hook".strip("; ")
            results.append(item)
        return results

    def _resolve_overlaps(self, segments: List[VisualSegment]) -> List[VisualSegment]:
        if not segments: return []
        min_avatar_len = 2.0
        min_slot_len = self.profile["slot_min"]
        ordered = sorted((dict(s) for s in segments), key=lambda x: (float(x.get("slot_start", 0)), float(x.get("slot_end", 0))))
        resolved: List[VisualSegment] = []
        for seg in ordered:
            start = seg["slot_start"]
            end = seg.get("slot_end", start + min_slot_len)
            if resolved:
                prev_end = resolved[-1]["slot_end"]
                if start < prev_end + min_avatar_len:
                    if seg.get("asset_type") == "product_video" and resolved[-1].get("asset_type") != "product_video":
                        prev = resolved[-1]
                        prev_min_len = MIN_PRODUCT_SEGMENT_SECONDS if prev.get("asset_type") == "product_video" else MIN_BROLL_SEGMENT_SECONDS
                        if start - prev["slot_start"] >= prev_min_len:
                            prev["slot_end"] = round(start, 2)
                        else:
                            resolved.pop()
                    elif start < prev_end or (start - prev_end < min_avatar_len):
                        start = prev_end
                if end - start < min_slot_len:
                    end = min(self.total_duration, start + min_slot_len)
            if end - start < min_slot_len or start >= self.total_duration:
                continue
            seg["slot_start"], seg["slot_end"] = round(start, 2), round(min(end, self.total_duration), 2)
            resolved.append(seg)
        return resolved

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
            product_asset_dur = _safe_float(seg.get("asset_duration_seconds"), 0.0)
            if seg.get("asset_type") == "product_video":
                min_dur = max(MIN_PRODUCT_SEGMENT_SECONDS, product_asset_dur if product_asset_dur > 0 else 0.0)
            else:
                min_dur = MIN_BROLL_SEGMENT_SECONDS
            if end - start >= min_dur - 0.01: continue
            next_start = segments[i+1]["slot_start"] if i+1 < len(segments) else self.total_duration
            needed = min_dur - (end - start)
            if seg.get("asset_type") == "product_video":
                ext_right = min(needed, self.total_duration - end)
            else:
                ext_right = min(needed, next_start - end)
            end += ext_right
            seg["slot_start"], seg["slot_end"] = round(start, 2), round(min(end, self.total_duration), 2)
        return segments

# --- PROMPT BUILDER ---

class VisualPromptBuilder:
    def __init__(self, config: GenerationConfig):
        self.config = config

    def build_system_prompt(self, scenario_text: str) -> str:
        product_keywords = _parse_product_keywords(self.config.product_keyword)
        prompt = f"""SYSTEM:
Ты — extraction-движок для тайминга визуальных сегментов (не креативный копирайтер).
Твоя цель: стабильно вернуть корректные таймкоды и короткие фразы для визуализации.

СЦЕНАРИЙ:
{scenario_text}

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
1. Не выдумывай факты, слова и тайминги. Используй только то, что есть в transcript с timestamp.
2. Возвращай только валидный JSON без markdown и комментариев.
3. Для каждого сегмента обязательно заполняй: slot_start, slot_end, word_start, word_end, keyword, phrase, visual_intent.
4. keyword — 1-3 слова на русском; phrase — короткая фраза 2-8 слов на русском.
5. visual_intent — короткая техническая фраза на английском для video model (shot + subject/action + camera/light).
6. Первые {AVATAR_ONLY_HOOK_SECONDS:.1f}s всегда остаются за аватаром с лицом; B-roll не должен начинаться раньше.
7. Времена должны быть в секундах, не отрицательные, slot_end > slot_start, word_end >= word_start.
"""
        if product_keywords:
            keywords_hint = ", ".join([f"'{k}'" for k in product_keywords])
            prompt += (
                "\nPRODUCT_KEYWORDS (high priority): "
                f"{keywords_hint}."
                " Обязательно выделяй сегменты, где реально произнесены эти ключи в transcript.\n"
            )
        
        if self.config.learned_rules:
            prompt += f"\nДОПОЛНИТЕЛЬНЫЕ ПРАВИЛА ОТ ПОЛЬЗОВАТЕЛЯ (УЧТИ ОБЯЗАТЕЛЬНО):\n{self.config.learned_rules}\n"
        return prompt

    def build_user_prompt(self, words: List[Word], slots: List[TimingSlot]) -> str:
        product_keywords = _parse_product_keywords(self.config.product_keyword)
        product_clip_duration = _resolve_primary_product_duration_seconds(self.config)
        timestamped_transcript = _get_timestamped_transcript(words)
        
        user_msg = f"""TRANSCRIPT WITH TIMESTAMPS:
{timestamped_transcript}

AVAILABLE SLOTS (reference windows):
{json.dumps(slots)}

TASK:
1. Return up to {len(slots)} segments.
2. Extract exact word timing from transcript: word_start/word_end.
3. Set slot_start/slot_end close to word timing and within sensible window.
4. First segment MUST start after {AVATAR_ONLY_HOOK_SECONDS:.1f}s because the opening hook is always avatar-only.
5. If uncertain, prefer fewer segments over guessed segments.

STRICT VALIDATION TARGET:
- All timestamps are numbers in seconds.
- slot_end > slot_start.
- word_end >= word_start.
- No duplicate segments with the same timing.
"""
        if product_keywords:
            keywords_hint = ", ".join([f"'{k}'" for k in product_keywords])
            user_msg += (
                "PRODUCT_KEYWORDS: обязательно выдели реальные упоминания: "
                f"{keywords_hint}.\n"
            )
            if product_clip_duration > 0:
                user_msg += (
                    "If should_use_product_clip=true, target slot duration should be at least "
                    f"{product_clip_duration:.2f}s for that segment.\n"
                )
        
        user_msg += f"""Return ONLY JSON in this format:
{{
  "segments": [
    {{
      "slot_start": <start of the best matching slot>,
      "slot_end": <end of the best matching slot>,
      "word_start": <exact start timestamp of the keyword mention>,
      "word_end": <exact end timestamp of the keyword mention>,
      "keyword": "<main subject RU>",
      "phrase": "<short phrase RU>",
      "visual_intent": "<VEO-3 Technical details in EN>",
      "should_use_product_clip": <boolean>,
      "reason": "<why this keyword fits this timing>"
    }}
  ]
}}"""
        return user_msg


def _coerce_llm_segments(raw_segments: Any, total_dur: float) -> List[VisualSegment]:
    if not isinstance(raw_segments, list):
        return []
    result: List[VisualSegment] = []
    for item in raw_segments:
        if not isinstance(item, dict):
            continue
        slot_start = _safe_float(item.get("slot_start"), -1.0)
        slot_end = _safe_float(item.get("slot_end"), -1.0)
        word_start = _safe_float(item.get("word_start"), slot_start)
        word_end = _safe_float(item.get("word_end"), slot_end)
        if slot_start < 0 or slot_end <= slot_start:
            if word_start >= 0 and word_end > word_start:
                slot_start, slot_end = word_start, word_end
            else:
                continue

        slot_start = round(max(0.0, min(slot_start, total_dur)), 2)
        slot_end = round(min(total_dur, max(slot_end, slot_start + 0.1)), 2)
        word_start = round(max(0.0, min(word_start, total_dur)), 2)
        word_end = round(min(total_dur, max(word_end, word_start)), 2)

        result.append({
            "slot_start": slot_start,
            "slot_end": slot_end,
            "word_start": word_start,
            "word_end": word_end,
            "keyword": str(item.get("keyword") or "").strip(),
            "phrase": str(item.get("phrase") or "").strip(),
            "visual_intent": str(item.get("visual_intent") or "").strip(),
            "should_use_product_clip": bool(item.get("should_use_product_clip", False)),
            "reason": str(item.get("reason") or "llm").strip(),
        })
    result.sort(key=lambda seg: (float(seg.get("slot_start", 0.0)), float(seg.get("slot_end", 0.0))))
    return result


def _enforce_first_segment_window(segments: List[VisualSegment], total_dur: float) -> None:
    if not segments or total_dur <= AVATAR_ONLY_HOOK_SECONDS:
        return
    for segment in segments:
        start = _safe_float(segment.get("slot_start"), 0.0)
        end = _safe_float(segment.get("slot_end"), start)
        if end <= AVATAR_ONLY_HOOK_SECONDS:
            segment["slot_start"] = AVATAR_ONLY_HOOK_SECONDS
            segment["slot_end"] = AVATAR_ONLY_HOOK_SECONDS
            segment["reason"] = f"{segment.get('reason', '')}; dropped_inside_avatar_hook".strip("; ")
            continue
        if start < AVATAR_ONLY_HOOK_SECONDS:
            segment["slot_start"] = round(AVATAR_ONLY_HOOK_SECONDS, 2)
            segment["reason"] = f"{segment.get('reason', '')}; shifted_after_avatar_hook".strip("; ")

# --- ORCHESTRATOR ---

def extract_visual_keyword_segments(scenario_text: str, tts_text: str, transcript: str, words: List[Dict[str, Any]], **kwargs) -> Dict[str, Any]:
    try:
        config = GenerationConfig(
            interval=float(kwargs.get("broll_interval_seconds") or 3.5),
            timing_mode="coverage_percent",
            pacing_profile=kwargs.get("broll_pacing_profile", "balanced"),
            pause_threshold=float(kwargs.get("broll_pause_threshold_seconds") or 0.45),
            coverage_percent=float(kwargs.get("broll_coverage_percent") or 55.0),
            relevance_priority=kwargs.get("broll_semantic_relevance_priority", "balanced"),
            product_clip_policy=kwargs.get("broll_product_clip_policy", "contextual"),
            product_keyword=kwargs.get("product_keyword"),
            product_video_url=kwargs.get("product_video_url"),
            product_media_assets=kwargs.get("product_media_assets"),
            learned_rules=kwargs.get("learned_rules_visual"),
        )
        engine = TimingEngine(config)
        norm_words = engine.normalize_words(words)
        if not norm_words: return {"segments": [], "updated_at": datetime.now(timezone.utc).isoformat()}
        slots = engine.build_slots(norm_words)
        total_dur = norm_words[-1]["end"]
        
        # 1. Build LLM Segments
        llm_segments = _build_semantic_llm_segments(config, scenario_text, norm_words, slots)
        segments = _coerce_llm_segments(llm_segments, total_dur)
        
        # 1.5. Fix LLM Hallucinations in Timings
        if segments:
            _fix_llm_hallucinated_timings(segments, norm_words)
        
        # 3. Post-LLM: Adjust slots to actually match word timings if returned
        for seg in (segments or []):
            w_start = seg.get("word_start")
            w_end = seg.get("word_end")
            if isinstance(w_start, (int, float)) and isinstance(w_end, (int, float)):
                # Keep a strict anchor to the spoken word timing.
                # We may only extend to the right for minimum-duration guardrails.
                new_start = round(max(0.0, float(w_start)), 2)
                new_end = round(min(total_dur, float(w_end)), 2)
                
                # Enforce minimum duration constraints
                min_dur = MIN_PRODUCT_SEGMENT_SECONDS if seg.get("asset_type") == "product_video" else MIN_BROLL_SEGMENT_SECONDS
                if (new_end - new_start) < min_dur:
                    # Expand only to the right to avoid early trigger before the spoken keyword.
                    new_end = round(min(total_dur, new_start + min_dur), 2)
                
                # Update slot to match reality
                seg["slot_start"] = new_start
                seg["slot_end"] = new_end
        
        _enforce_first_segment_window(segments, total_dur)

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

def _build_semantic_llm_segments(config: GenerationConfig, scenario: str, words: List[Word], slots: List[TimingSlot]) -> Optional[List[VisualSegment]]:
    try:
        builder = VisualPromptBuilder(config)
        client = _openrouter_client()
        model = os.getenv("SCENARIO_MODEL", "google/gemini-2.5-flash")
        temperature = _safe_float(os.getenv("VISUAL_SEGMENTS_TEMPERATURE"), 0.1)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": builder.build_system_prompt(scenario)},
                {"role": "user", "content": builder.build_user_prompt(words, slots)}
            ],
            response_format={"type": "json_object"},
            temperature=max(0.0, min(temperature, 0.3)),
        )
        content = (response.choices[0].message.content or "").strip()
        if "```json" in content:
            content = content.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in content:
            content = content.split("```", 1)[1].split("```", 1)[0].strip()

        data = json.loads(content) if content else {}
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

def _fix_llm_hallucinated_timings(segments: List[VisualSegment], words: List[Word]) -> None:
    if not words:
        return
    word_stems = [_stem_token(w["word"]) for w in words]

    for seg in segments:
        target_text = str(seg.get("phrase") or seg.get("keyword") or "")
        target_tokens = _tokenize(target_text)
        if not target_tokens:
            continue
            
        target_stems = [_stem_token(t) for t in target_tokens]
        window = len(target_stems)
        
        llm_start = float(seg.get("word_start", seg.get("slot_start", 0.0)))
        
        best_idx = -1
        min_dist = float('inf')
        
        # 1. Try to match the exact phrase stems contiguous sequence
        if window > 0 and window <= len(word_stems):
            for i in range(len(word_stems) - window + 1):
                if word_stems[i:i+window] == target_stems:
                    dist = abs(words[i]["start"] - llm_start)
                    if dist < min_dist:
                        min_dist = dist
                        best_idx = i
                    
        match_len = window
        
        # 2. If phrase not found, try to match just the keyword
        if best_idx == -1 and seg.get("keyword"):
            kw_tokens = _tokenize(str(seg["keyword"]))
            if kw_tokens:
                kw_stems = [_stem_token(t) for t in kw_tokens]
                kw_window = len(kw_stems)
                if kw_window > 0 and kw_window <= len(word_stems):
                    for i in range(len(word_stems) - kw_window + 1):
                        if word_stems[i:i+kw_window] == kw_stems:
                            dist = abs(words[i]["start"] - llm_start)
                            # Be more lenient for the keyword, if it's the only match we'll take it
                            if dist < min_dist:
                                min_dist = dist
                                best_idx = i
                                match_len = kw_window

        if best_idx != -1:
            try:
                seg["word_start"] = words[best_idx]["start"]
                # Safeguard against index out of bounds
                end_idx = min(best_idx + match_len - 1, len(words) - 1)
                seg["word_end"] = words[end_idx]["end"]
            except Exception as e:
                logger.warning(f"Failed to apply fixed timing: {e}")
