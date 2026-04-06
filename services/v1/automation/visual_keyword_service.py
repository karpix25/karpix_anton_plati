import json
import logging
import os
import re
import random
from datetime import datetime, timezone
from typing import Any, Dict, List

from openai import OpenAI

logger = logging.getLogger(__name__)

STRONG_BOUNDARY_RE = re.compile(r"[.!?;:]$")
SOFT_BOUNDARY_RE = re.compile(r"[,)]$")
MIN_BROLL_SEGMENT_SECONDS = 2.0
MIN_PRODUCT_SEGMENT_SECONDS = 3.0
FIRST_ATTENTION_CUT_MIN_SECONDS = 2.6
FIRST_ATTENTION_CUT_MAX_SECONDS = 3.0
DEMONSTRATIVE_RE = re.compile(r"\b(этот|эта|это|эти|тот|та|то|те|same|this|that|these|those)\b", re.IGNORECASE)
CONSUMER_GOOD_GENERALIZATION_RULES = [
    {
        "pattern": re.compile(r"(спрей|репеллент|комар)"),
        "keyword": "средство от комаров",
        "phrase": "средство от комаров в дорожной аптечке",
        "visual_intent": "unbranded mosquito repellent in a travel pouch or being applied before going outside",
    },
    {
        "pattern": re.compile(r"(пробиот|капсул.*пищевар|желуд|отравл)"),
        "keyword": "капсулы для пищеварения",
        "phrase": "капсулы для пищеварения в дорожной аптечке",
        "visual_intent": "unbranded digestive support capsules in a travel medicine kit, no readable labels",
    },
    {
        "pattern": re.compile(r"(мелатонин|сон|бессонниц)"),
        "keyword": "капсулы для сна",
        "phrase": "капсулы для сна в дорожной аптечке",
        "visual_intent": "unbranded sleep-support capsules on a bedside table or in a travel pouch, no readable labels",
    },
    {
        "pattern": re.compile(r"(spf|солнцезащит|крем от солнца|санскрин|sunblock|sunscreen)"),
        "keyword": "солнцезащитный крем",
        "phrase": "солнцезащитный крем в пляжной сумке",
        "visual_intent": "unbranded sunscreen tube in a beach bag or being applied before sun exposure, no readable labels",
    },
]

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
        "slot_target": 2.4,
        "slot_max": 3.0,
    },
    "dynamic": {
        "min_avatar_gap_factor": 0.65,
        "target_avatar_gap_factor": 0.9,
        "max_avatar_gap_factor": 1.35,
        "min_avatar_gap_floor": 1.8,
        "target_avatar_gap_floor": 2.4,
        "max_avatar_gap_floor": 3.5,
        "slot_min": 2.0,
        "slot_target": 2.2,
        "slot_max": 2.8,
    },
}


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


def _normalize_broll_interval_seconds(value: Any) -> float:
    try:
        normalized = round(float(value or 3.0), 1)
    except (TypeError, ValueError):
        normalized = 3.0
    return max(MIN_BROLL_SEGMENT_SECONDS, min(normalized, 5.0))


def _normalize_broll_timing_mode(value: Any) -> str:
    normalized = str(value or "semantic_pause").strip().lower()
    return normalized if normalized in {"fixed", "semantic_pause", "coverage_percent"} else "semantic_pause"


def _normalize_broll_pacing_profile(value: Any) -> str:
    normalized = str(value or "balanced").strip().lower()
    return normalized if normalized in PACING_PRESETS else "balanced"


def _normalize_pause_threshold_seconds(value: Any) -> float:
    try:
        normalized = round(float(value or 0.45), 2)
    except (TypeError, ValueError):
        normalized = 0.45
    return max(0.15, min(normalized, 1.2))


def _normalize_broll_coverage_percent(value: Any) -> float:
    try:
        normalized = round(float(value or 35.0), 1)
    except (TypeError, ValueError):
        normalized = 35.0
    return max(0.0, min(normalized, 100.0))


def _normalize_semantic_relevance_priority(value: Any) -> str:
    normalized = str(value or "balanced").strip().lower()
    return normalized if normalized in {"precision", "balanced", "dynamic"} else "balanced"


def _normalize_product_clip_policy(value: Any) -> str:
    normalized = str(value or "contextual").strip().lower()
    return normalized if normalized in {"contextual", "prefer", "required"} else "contextual"


def _derive_automatic_pause_threshold_seconds(words: List[Dict[str, Any]]) -> float:
    normalized_words = _normalize_words(words)
    if len(normalized_words) < 2:
        return 0.3

    gaps = [
        round(max(0.0, normalized_words[index]["start"] - normalized_words[index - 1]["end"]), 2)
        for index in range(1, len(normalized_words))
    ]
    positive_gaps = sorted(gap for gap in gaps if gap > 0.0)
    if not positive_gaps:
        return 0.3

    percentile_index = min(len(positive_gaps) - 1, max(0, int(len(positive_gaps) * 0.7)))
    derived = positive_gaps[percentile_index]
    return max(0.18, min(round(derived, 2), 0.65))


def _normalize_words(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized_words: List[Dict[str, Any]] = []
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
            **word,
            "start": round(start, 2),
            "end": round(end, 2),
            "word": token,
            "punctuated_word": punctuated,
        })
    normalized_words.sort(key=lambda item: (item["start"], item["end"]))
    return normalized_words


def _register_boundary(registry: Dict[float, Dict[str, Any]], time_value: float, strength: float, reason: str) -> None:
    rounded_time = round(max(0.0, time_value), 2)
    existing = registry.get(rounded_time)
    if existing:
        existing["strength"] = max(existing["strength"], strength)
        if reason not in existing["reason"]:
            existing["reason"] = f"{existing['reason']}, {reason}"
        return

    registry[rounded_time] = {
        "time": rounded_time,
        "strength": round(strength, 2),
        "reason": reason,
    }


def _build_phrase_boundaries(words: List[Dict[str, Any]], pause_threshold_seconds: float) -> List[Dict[str, Any]]:
    normalized_words = _normalize_words(words)
    if not normalized_words:
        return []

    boundaries: Dict[float, Dict[str, Any]] = {}
    _register_boundary(boundaries, normalized_words[0]["start"], 3.0, "intro")

    soft_gap_floor = max(0.18, round(pause_threshold_seconds * 0.55, 2))
    for index in range(1, len(normalized_words)):
        current = normalized_words[index]
        previous = normalized_words[index - 1]
        gap_before = max(0.0, round(current["start"] - previous["end"], 2))
        previous_token = previous.get("punctuated_word") or previous.get("word") or ""

        strength = 0.0
        reasons: List[str] = []
        if gap_before >= pause_threshold_seconds:
            strength += 1.4 + min(1.4, gap_before / max(pause_threshold_seconds, 0.01))
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

        if strength <= 0:
            continue

        _register_boundary(boundaries, current["start"], strength, "+".join(reasons) or "phrase")

    _register_boundary(boundaries, normalized_words[-1]["end"], 3.5, "outro")
    return sorted(boundaries.values(), key=lambda item: item["time"])


def _select_boundary(
    boundaries: List[Dict[str, Any]],
    min_time: float,
    target_time: float,
    max_time: float,
    fallback_extension: float = 0.75,
) -> Dict[str, Any] | None:
    primary = [
        boundary
        for boundary in boundaries
        if min_time <= boundary["time"] <= max_time
    ]
    candidates = primary
    if not candidates:
        candidates = [
            boundary
            for boundary in boundaries
            if min_time <= boundary["time"] <= max_time + fallback_extension
        ]
    if not candidates:
        return None

    return min(
        candidates,
        key=lambda boundary: (
            abs(boundary["time"] - target_time)
            + (0.8 if boundary["time"] > max_time else 0.0)
            - (boundary.get("strength", 0.0) * 0.3)
        ),
    )


def _build_fixed_keyword_slots(words: List[Dict[str, Any]], broll_interval_seconds: float) -> List[Dict[str, float]]:
    interval = _normalize_broll_interval_seconds(broll_interval_seconds)
    max_end = max((_safe_float(word.get("end")) for word in words or [] if isinstance(word, dict)), default=0.0)

    slots: List[Dict[str, float]] = []
    current = max(interval, FIRST_ATTENTION_CUT_MIN_SECONDS)
    while current <= max_end + 0.01:
        slots.append({
            "slot_start": round(current, 1),
            "slot_end": round(min(current + interval, max_end), 1),
        })
        current += interval * 2.0

    return slots


def _build_semantic_keyword_slots(
    words: List[Dict[str, Any]],
    broll_interval_seconds: float,
    broll_pacing_profile: str,
    pause_threshold_seconds: float,
) -> List[Dict[str, float]]:
    normalized_words = _normalize_words(words)
    if not normalized_words:
        return []

    boundaries = _build_phrase_boundaries(normalized_words, pause_threshold_seconds)
    if len(boundaries) < 2:
        return _build_fixed_keyword_slots(normalized_words, broll_interval_seconds)

    interval = _normalize_broll_interval_seconds(broll_interval_seconds)
    profile = PACING_PRESETS[_normalize_broll_pacing_profile(broll_pacing_profile)]
    max_end = normalized_words[-1]["end"]

    min_avatar_gap = max(profile["min_avatar_gap_floor"], round(interval * profile["min_avatar_gap_factor"], 2))
    target_avatar_gap = max(profile["target_avatar_gap_floor"], round(interval * profile["target_avatar_gap_factor"], 2))
    max_avatar_gap = max(profile["max_avatar_gap_floor"], round(interval * profile["max_avatar_gap_factor"], 2))
    slot_min = profile["slot_min"]
    slot_target = profile["slot_target"]
    slot_max = profile["slot_max"]

    slots: List[Dict[str, float]] = []
    timeline_cursor = 0.0

    while timeline_cursor + min_avatar_gap + slot_min <= max_end:
        # Enforce first attention cut for the very first slot
        current_min_gap = min_avatar_gap
        if not slots:
            current_min_gap = max(min_avatar_gap, FIRST_ATTENTION_CUT_MIN_SECONDS)

        start_boundary = _select_boundary(
            boundaries=boundaries,
            min_time=timeline_cursor + current_min_gap,
            target_time=timeline_cursor + max(current_min_gap, target_avatar_gap),
            max_time=min(timeline_cursor + max_avatar_gap, max_end - slot_min),
            fallback_extension=0.9,
        )
        if not start_boundary:
            break

        slot_start = round(start_boundary["time"], 2)
        if slot_start < timeline_cursor:
            timeline_cursor = round(slot_start + 0.05, 2)
            continue

        remaining = max_end - slot_start
        if remaining < slot_min:
            break

        end_boundary = _select_boundary(
            boundaries=boundaries,
            min_time=slot_start + slot_min,
            target_time=slot_start + slot_target,
            max_time=min(slot_start + slot_max, max_end),
            fallback_extension=0.45,
        )
        slot_end = round(end_boundary["time"], 2) if end_boundary else round(min(slot_start + slot_target, max_end), 2)

        if slot_end - slot_start < slot_min:
            slot_end = round(min(max_end, slot_start + slot_min), 2)
        if slot_end - slot_start < 0.8:
            break

        slots.append({
            "slot_start": round(slot_start, 1),
            "slot_end": round(slot_end, 1),
        })
        timeline_cursor = slot_end

    if slots:
        return slots

    return _build_fixed_keyword_slots(normalized_words, broll_interval_seconds)


def _build_coverage_keyword_slots(
    words: List[Dict[str, Any]],
    broll_pacing_profile: str,
    broll_coverage_percent: float,
) -> List[Dict[str, float]]:
    normalized_words = _normalize_words(words)
    if not normalized_words:
        return []

    pause_threshold_seconds = _derive_automatic_pause_threshold_seconds(normalized_words)
    boundaries = _build_phrase_boundaries(normalized_words, pause_threshold_seconds)
    if len(boundaries) < 2:
        return []

    profile = PACING_PRESETS[_normalize_broll_pacing_profile(broll_pacing_profile)]
    coverage_percent = _normalize_broll_coverage_percent(broll_coverage_percent)
    max_end = normalized_words[-1]["end"]
    if max_end <= MIN_BROLL_SEGMENT_SECONDS + 0.2:
        return []

    min_avatar_gap = FIRST_ATTENTION_CUT_MIN_SECONDS
    target_avatar_gap = FIRST_ATTENTION_CUT_MIN_SECONDS
    max_avatar_gap = max(FIRST_ATTENTION_CUT_MIN_SECONDS, round(profile["target_avatar_gap_floor"] * 0.65, 2))
    slot_min = profile["slot_min"]
    slot_target = profile["slot_target"]
    slot_max = min(6.0, max(profile["slot_max"], slot_target + 1.0))

    if coverage_percent >= 95.0:
        return [{"slot_start": FIRST_ATTENTION_CUT_MIN_SECONDS, "slot_end": round(max_end, 1)}]

    target_total_broll = round(max_end * (coverage_percent / 100.0), 2)
    target_total_broll = max(0.0, min(target_total_broll, max_end))
    if target_total_broll < slot_min * 0.5:
        return []
    estimated_slot_count = max(1, round(target_total_broll / max(slot_target, 0.1)))

    slots: List[Dict[str, float]] = []
    timeline_cursor = 0.0
    accumulated_broll = 0.0

    while len(slots) < estimated_slot_count and timeline_cursor + slot_min <= max_end:
        remaining_slots = estimated_slot_count - len(slots)
        remaining_broll = max(target_total_broll - accumulated_broll, 0.0)
        if remaining_broll <= 0.05:
            break
        remaining_time = max_end - timeline_cursor

        desired_gap = (remaining_time - remaining_broll) / max(remaining_slots, 1)
        desired_gap = max(min_avatar_gap, min(desired_gap, max_avatar_gap))

        start_boundary = _select_boundary(
            boundaries=boundaries,
            min_time=timeline_cursor + min_avatar_gap,
            target_time=timeline_cursor + desired_gap,
            max_time=min(timeline_cursor + max_avatar_gap, max_end - slot_min),
            fallback_extension=0.9,
        )
        if not start_boundary:
            slot_start = round(timeline_cursor, 2)
        else:
            slot_start = round(start_boundary["time"], 2)

        if slot_start <= timeline_cursor + 0.25:
            timeline_cursor = round(slot_start + 0.25, 2)
            continue

        remaining_after_start = max_end - slot_start
        if remaining_after_start < slot_min:
            break

        dynamic_slot_target = remaining_broll / max(remaining_slots, 1)
        dynamic_slot_target = max(slot_min, min(dynamic_slot_target, slot_max))
        dynamic_slot_max = min(5.0, max(dynamic_slot_target + 0.6, slot_max))

        end_boundary = _select_boundary(
            boundaries=boundaries,
            min_time=slot_start + slot_min,
            target_time=slot_start + dynamic_slot_target,
            max_time=min(slot_start + dynamic_slot_max, max_end),
            fallback_extension=0.5,
        )
        slot_end = round(end_boundary["time"], 2) if end_boundary else round(min(slot_start + dynamic_slot_target, max_end), 2)

        if slot_end - slot_start < slot_min:
            slot_end = round(min(max_end, slot_start + slot_min), 2)
        if slot_end - slot_start < 0.8:
            break

        slots.append({
            "slot_start": round(slot_start, 1),
            "slot_end": round(slot_end, 1),
        })
        accumulated_broll += slot_end - slot_start
        timeline_cursor = slot_end

        if accumulated_broll >= target_total_broll - 0.15:
            break

    if slots:
        return slots

    return _build_semantic_keyword_slots(
        normalized_words,
        broll_interval_seconds=3.0,
        broll_pacing_profile=broll_pacing_profile,
        pause_threshold_seconds=pause_threshold_seconds,
    )


def build_keyword_slots(
    words: List[Dict[str, Any]],
    broll_interval_seconds: float = 3.0,
    broll_timing_mode: str = "semantic_pause",
    broll_pacing_profile: str = "balanced",
    broll_pause_threshold_seconds: float = 0.45,
    broll_coverage_percent: float = 35.0,
) -> List[Dict[str, float]]:
    timing_mode = _normalize_broll_timing_mode(broll_timing_mode)
    interval = _normalize_broll_interval_seconds(broll_interval_seconds)
    pause_threshold = _normalize_pause_threshold_seconds(broll_pause_threshold_seconds)
    profile = _normalize_broll_pacing_profile(broll_pacing_profile)
    coverage_percent = _normalize_broll_coverage_percent(broll_coverage_percent)

    if timing_mode == "fixed":
        return _build_fixed_keyword_slots(words, interval)
    if timing_mode == "coverage_percent":
        return _build_coverage_keyword_slots(words, profile, coverage_percent)

    return _build_semantic_keyword_slots(words, interval, profile, pause_threshold)


def _fallback_segments(
    words: List[Dict[str, Any]],
    slots: List[Dict[str, float]],
    meaning_windows: List[Dict[str, float]] | None = None,
) -> List[Dict[str, Any]]:
    segments: List[Dict[str, Any]] = []
    window_by_slot = {
        (round(_safe_float(window.get("slot_start")), 1), round(_safe_float(window.get("slot_end")), 1)): window
        for window in (meaning_windows or [])
        if isinstance(window, dict)
    }

    for slot in slots:
        lookup_key = (round(_safe_float(slot.get("slot_start")), 1), round(_safe_float(slot.get("slot_end")), 1))
        meaning_window = window_by_slot.get(lookup_key)
        extraction_start = _safe_float(meaning_window.get("meaning_start")) if meaning_window else slot["slot_start"]
        extraction_end = _safe_float(meaning_window.get("meaning_end")) if meaning_window else slot["slot_end"]

        slot_words = [
            word for word in (words or [])
            if isinstance(word, dict) and _safe_float(word.get("start")) >= extraction_start and _safe_float(word.get("start")) < extraction_end
        ]
        if not slot_words:
            continue

        content_words = [word for word in slot_words if len((word.get("word") or "").strip()) > 3]
        chosen = max(content_words, key=lambda word: len((word.get("word") or "").strip()), default=slot_words[0])
        keyword = (chosen.get("word") or "").strip()
        if not keyword:
            continue

        segments.append({
            "slot_start": slot["slot_start"],
            "slot_end": slot["slot_end"],
            "keyword": keyword,
            "phrase": _build_phrase_from_slot(slot_words, max_words=6) or chosen.get("punctuated_word") or keyword,
            "word_start": round(_safe_float(chosen.get("start")), 2),
            "word_end": round(_safe_float(chosen.get("end")), 2),
            "visual_intent": "",
            "reason": "fallback_from_word_timestamps",
        })

    return segments


def _normalize_match_text(value: str) -> str:
    return (
        (value or "")
        .lower()
        .replace("«", " ")
        .replace("»", " ")
        .replace('"', " ")
        .replace("ё", "е")
        .replace("-", " ")
    )


def _tokenize_match_text(value: str) -> List[str]:
    normalized = _normalize_match_text(value)
    return [token for token in re.split(r"[^\w]+", normalized, flags=re.UNICODE) if token]


def _contains_exact_keyword_sequence(text: str, keyword: str) -> bool:
    keyword_tokens = _tokenize_match_text(keyword)
    if not keyword_tokens:
        return False

    text_tokens = _tokenize_match_text(text)
    if len(text_tokens) < len(keyword_tokens):
        return False

    target_length = len(keyword_tokens)
    return any(
        text_tokens[index : index + target_length] == keyword_tokens
        for index in range(len(text_tokens) - target_length + 1)
    )


def _compact_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _remove_demonstratives(value: str) -> str:
    return _compact_spaces(DEMONSTRATIVE_RE.sub(" ", value or ""))


def _generalize_consumer_good_segment(segment: Dict[str, Any]) -> Dict[str, Any]:
    if segment.get("asset_type") == "product_video":
        return segment

    keyword_text = _normalize_match_text(str(segment.get("keyword") or ""))
    phrase_text = _normalize_match_text(str(segment.get("phrase") or ""))
    visual_intent_text = _normalize_match_text(str(segment.get("visual_intent") or ""))
    combined = f"{keyword_text} {phrase_text} {visual_intent_text}"

    for rule in CONSUMER_GOOD_GENERALIZATION_RULES:
        if not rule["pattern"].search(combined):
            continue

        return {
            **segment,
            "keyword": rule["keyword"],
            "phrase": rule["phrase"],
            "visual_intent": rule["visual_intent"],
            "reason": f"{segment.get('reason') or 'segment'}; generalized_consumer_good_without_ready_asset",
        }

    cleaned_phrase = _remove_demonstratives(str(segment.get("phrase") or ""))
    cleaned_intent = _remove_demonstratives(str(segment.get("visual_intent") or ""))
    if cleaned_phrase != str(segment.get("phrase") or "") or cleaned_intent != str(segment.get("visual_intent") or ""):
        return {
            **segment,
            "phrase": cleaned_phrase or segment.get("phrase"),
            "visual_intent": cleaned_intent or segment.get("visual_intent"),
        }

    return segment


def _extract_slot_words(words: List[Dict[str, Any]], slot_start: float, slot_end: float) -> List[Dict[str, Any]]:
    slot_words: List[Dict[str, Any]] = []
    for word in words or []:
        if not isinstance(word, dict):
            continue
        start = _safe_float(word.get("start"))
        if start >= slot_start and start < slot_end:
            slot_words.append(word)
    return slot_words


def _build_fixed_meaning_windows(
    words: List[Dict[str, Any]],
    slots: List[Dict[str, float]],
    pause_threshold_seconds: float,
) -> List[Dict[str, float]]:
    normalized_words = _normalize_words(words)
    if not normalized_words or not slots:
        return []

    boundaries = _build_phrase_boundaries(normalized_words, pause_threshold_seconds)
    if len(boundaries) < 2:
        return [
            {
                "slot_start": round(_safe_float(slot.get("slot_start")), 1),
                "slot_end": round(_safe_float(slot.get("slot_end")), 1),
                "meaning_start": round(_safe_float(slot.get("slot_start")), 1),
                "meaning_end": round(_safe_float(slot.get("slot_end")), 1),
            }
            for slot in slots
        ]

    total_duration = normalized_words[-1]["end"]
    windows: List[Dict[str, float]] = []

    for slot in slots:
        slot_start = round(_safe_float(slot.get("slot_start")), 1)
        slot_end = round(_safe_float(slot.get("slot_end")), 1)
        slot_length = max(0.1, slot_end - slot_start)
        slot_center = round(slot_start + slot_length / 2.0, 2)

        search_start = max(0.0, round(slot_start - slot_length * 1.4, 2))
        search_end = min(total_duration, round(slot_end + slot_length * 1.0, 2))

        left_candidates = [boundary for boundary in boundaries if search_start <= boundary["time"] <= slot_center]
        right_candidates = [boundary for boundary in boundaries if slot_center <= boundary["time"] <= search_end]

        left_boundary = max(
            left_candidates,
            key=lambda boundary: (boundary.get("strength", 0.0), boundary["time"]),
            default=None,
        )
        right_boundary = min(
            right_candidates,
            key=lambda boundary: abs(boundary["time"] - slot_center) - boundary.get("strength", 0.0) * 0.2,
            default=None,
        )

        meaning_start = round(left_boundary["time"], 1) if left_boundary else round(search_start, 1)
        meaning_end = round(right_boundary["time"], 1) if right_boundary else round(search_end, 1)

        if meaning_end - meaning_start < 1.0:
            meaning_start = round(max(0.0, slot_center - slot_length * 0.7), 1)
            meaning_end = round(min(total_duration, slot_center + slot_length * 0.7), 1)

        windows.append(
            {
                "slot_start": slot_start,
                "slot_end": slot_end,
                "meaning_start": round(max(0.0, meaning_start), 1),
                "meaning_end": round(min(total_duration, meaning_end), 1),
            }
        )

    return windows


def _build_phrase_from_slot(slot_words: List[Dict[str, Any]], max_words: int = 8) -> str:
    parts: List[str] = []
    for word in slot_words[:max_words]:
        token = (word.get("punctuated_word") or word.get("word") or "").strip()
        if token:
            parts.append(token)
    return _compact_spaces(" ".join(parts))


def _extract_enumerated_anchor_segments(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized_words = _normalize_words(words)
    anchors: List[Dict[str, Any]] = []

    for index, word in enumerate(normalized_words):
        punctuated = (word.get("punctuated_word") or word.get("word") or "").strip()
        keyword = punctuated.rstrip(":").strip()
        if not punctuated.endswith(":") or len(keyword) < 3:
            continue

        phrase_words = [word]
        for next_word in normalized_words[index + 1 : index + 7]:
            phrase_words.append(next_word)
            next_token = (next_word.get("punctuated_word") or next_word.get("word") or "").strip()
            if STRONG_BOUNDARY_RE.search(next_token):
                break

        phrase = _build_phrase_from_slot(phrase_words, max_words=6) or keyword
        anchors.append(
            {
                "keyword": keyword,
                "phrase": phrase,
                "word_start": round(_safe_float(word.get("start")), 2),
                "word_end": round(max((_safe_float(item.get("end")) for item in phrase_words), default=_safe_float(word.get("end"))), 2),
            }
        )

    unique_anchors: List[Dict[str, Any]] = []
    seen_keywords = set()
    for anchor in anchors:
        normalized_keyword = _normalize_match_text(anchor["keyword"])
        if normalized_keyword in seen_keywords:
            continue
        seen_keywords.add(normalized_keyword)
        unique_anchors.append(anchor)

    return unique_anchors


def _apply_fixed_enumeration_priority(
    segments: List[Dict[str, Any]],
    words: List[Dict[str, Any]],
    slots: List[Dict[str, float]],
    product_keyword: str | None = None,
) -> List[Dict[str, Any]]:
    anchors = _extract_enumerated_anchor_segments(words)
    if len(anchors) < 2 or not slots:
        return segments

    normalized_product_keyword = _normalize_match_text(product_keyword or "").strip()
    filtered_anchors = [
        anchor
        for anchor in anchors
        if not normalized_product_keyword
        or not _contains_exact_keyword_sequence(f"{anchor['keyword']} {anchor['phrase']}", normalized_product_keyword)
    ]
    if len(filtered_anchors) < 2:
        return segments

    ordered_slots = sorted((dict(slot) for slot in slots), key=lambda item: _safe_float(item.get("slot_start")))
    ordered_segments = sorted((dict(segment) for segment in segments), key=lambda item: _safe_float(item.get("slot_start")))
    segment_by_slot = {
        (round(_safe_float(segment.get("slot_start")), 1), round(_safe_float(segment.get("slot_end")), 1)): segment
        for segment in ordered_segments
    }

    result: List[Dict[str, Any]] = []
    target_count = min(len(ordered_slots), len(filtered_anchors))
    for index in range(target_count):
        slot = ordered_slots[index]
        anchor = filtered_anchors[index]
        existing = segment_by_slot.get((round(_safe_float(slot.get("slot_start")), 1), round(_safe_float(slot.get("slot_end")), 1)), {})
        result.append(
            {
                **existing,
                "slot_start": round(_safe_float(slot.get("slot_start")), 1),
                "slot_end": round(_safe_float(slot.get("slot_end")), 1),
                "keyword": anchor["keyword"],
                "phrase": anchor["phrase"],
                "word_start": anchor["word_start"],
                "word_end": anchor["word_end"],
                "visual_intent": existing.get("visual_intent") or anchor["phrase"],
                "reason": f"{existing.get('reason') or 'segment'}; fixed_enumeration_priority",
            }
        )

    for slot in ordered_slots[target_count:]:
        existing = segment_by_slot.get((round(_safe_float(slot.get("slot_start")), 1), round(_safe_float(slot.get("slot_end")), 1)))
        if existing:
            result.append(existing)

    return result or segments


def _get_total_duration(words: List[Dict[str, Any]] | None, slots: List[Dict[str, float]] | None = None) -> float:
    word_max = max((_safe_float(word.get("end")) for word in (words or []) if isinstance(word, dict)), default=0.0)
    slot_max = max((_safe_float(slot.get("slot_end")) for slot in (slots or []) if isinstance(slot, dict)), default=0.0)
    return max(word_max, slot_max)


def _enforce_minimum_segment_durations(
    segments: List[Dict[str, Any]],
    total_duration: float,
) -> List[Dict[str, Any]]:
    if not segments:
        return []

    ordered = sorted((dict(segment) for segment in segments), key=lambda item: _safe_float(item.get("slot_start")))

    for index, segment in enumerate(ordered):
        start = _safe_float(segment.get("slot_start"))
        end = _safe_float(segment.get("slot_end"))
        current_duration = end - start
        minimum_duration = MIN_PRODUCT_SEGMENT_SECONDS if segment.get("asset_type") == "product_video" else MIN_BROLL_SEGMENT_SECONDS

        if current_duration + 0.01 >= minimum_duration:
            continue

        previous_end = _safe_float(ordered[index - 1].get("slot_end")) if index > 0 else 0.0
        next_start = _safe_float(ordered[index + 1].get("slot_start"), total_duration) if index + 1 < len(ordered) else total_duration
        needed = minimum_duration - current_duration

        extend_right = min(needed, max(0.0, next_start - end))
        end += extend_right
        needed -= extend_right

        if needed > 0:
            shift_left = min(needed, max(0.0, start - previous_end))
            start -= shift_left
            needed -= shift_left

        segment["slot_start"] = round(start, 1)
        segment["slot_end"] = round(min(end, total_duration), 1)

    return ordered


def _find_product_segment(
    words: List[Dict[str, Any]],
    slots: List[Dict[str, float]],
    product_keyword: str,
) -> Dict[str, Any] | None:
    normalized_keyword = _normalize_match_text(product_keyword).strip()
    if not normalized_keyword:
        return None

    for slot in slots:
        slot_words = _extract_slot_words(words, slot["slot_start"], slot["slot_end"])
        combined = " ".join((w.get("word") or "") for w in slot_words)
        if not _contains_exact_keyword_sequence(combined, normalized_keyword):
            continue

        start_candidates = [_safe_float(w.get("start")) for w in slot_words if isinstance(w, dict)]
        end_candidates = [_safe_float(w.get("end")) for w in slot_words if isinstance(w, dict)]
        return {
            "slot_start": slot["slot_start"],
            "slot_end": slot["slot_end"],
            "keyword": product_keyword,
            "phrase": _build_phrase_from_slot(slot_words) or product_keyword,
            "word_start": round(min(start_candidates), 2) if start_candidates else slot["slot_start"],
            "word_end": round(max(end_candidates), 2) if end_candidates else slot["slot_end"],
            "visual_intent": f"брендовый продуктовый кадр: {product_keyword}",
            "reason": "product_keyword_priority",
            "asset_type": "product_video",
            "asset_url": None,
            "generate_video": False,
        }

    return None


def _normalize_product_media_assets(product_media_assets: List[Dict[str, Any]] | None) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for asset in product_media_assets or []:
        if not isinstance(asset, dict):
            continue
        url = str(asset.get("url") or "").strip()
        if not url:
            continue
        normalized.append({
            "id": str(asset.get("id") or url).strip(),
            "url": url,
            "name": str(asset.get("name") or asset.get("id") or "Product Asset").strip(),
            "source_type": str(asset.get("source_type") or "video").strip(),
        })
    return normalized


def _pick_product_asset(product_media_assets: List[Dict[str, Any]] | None, product_video_url: str | None) -> Dict[str, Any] | None:
    normalized_assets = _normalize_product_media_assets(product_media_assets)
    if normalized_assets:
        return random.choice(normalized_assets)

    fallback_url = str(product_video_url or "").strip()
    if not fallback_url:
        return None

    return {
        "id": fallback_url,
        "url": fallback_url,
        "name": "Product Video",
        "source_type": "video",
    }


def _apply_product_asset(
    segments: List[Dict[str, Any]],
    product_keyword: str | None,
    product_video_url: str | None,
    product_media_assets: List[Dict[str, Any]] | None = None,
    words: List[Dict[str, Any]] | None = None,
    slots: List[Dict[str, float]] | None = None,
    force_product_segment: bool = True,
) -> List[Dict[str, Any]]:
    normalized_keyword = _normalize_match_text(product_keyword or "").strip()
    if not normalized_keyword:
        return segments

    result = []
    for segment in segments:
        keyword_text = _normalize_match_text(segment.get("keyword", ""))
        phrase_text = _normalize_match_text(segment.get("phrase", ""))
        combined = f"{keyword_text} {phrase_text}"
        if _contains_exact_keyword_sequence(combined, normalized_keyword):
            selected_asset = _pick_product_asset(product_media_assets, product_video_url)
            result.append({
                **segment,
                "asset_type": "product_video",
                "asset_url": selected_asset["url"] if selected_asset else product_video_url,
                "asset_id": selected_asset["id"] if selected_asset else None,
                "asset_name": selected_asset["name"] if selected_asset else None,
                "generate_video": False,
                "keyword": product_keyword,
                "phrase": segment.get("phrase") or product_keyword,
            })
        else:
            result.append({
                **segment,
                "asset_type": "generated_video",
                "asset_url": None,
                "generate_video": True,
            })

    has_product_segment = any(item.get("asset_type") == "product_video" for item in result)
    if force_product_segment and not has_product_segment and words and slots:
        forced_segment = _find_product_segment(words, slots, product_keyword or "")
        if forced_segment:
            selected_asset = _pick_product_asset(product_media_assets, product_video_url)
            forced_segment["asset_url"] = selected_asset["url"] if selected_asset else product_video_url
            forced_segment["asset_id"] = selected_asset["id"] if selected_asset else None
            forced_segment["asset_name"] = selected_asset["name"] if selected_asset else None
            result.append(forced_segment)

    total_duration = _get_total_duration(words, slots) or max((_safe_float(item.get("slot_end")) for item in result), default=0.0)
    generalized = [_generalize_consumer_good_segment(item) for item in result]
    return _enforce_minimum_segment_durations(generalized, total_duration)


def _semantic_duration_bounds(pacing_profile: str) -> Dict[str, float]:
    profile = PACING_PRESETS[_normalize_broll_pacing_profile(pacing_profile)]
    return {
        "min": round(profile["slot_min"], 1),
        "target": round(profile["slot_target"], 1),
        "max": round(max(profile["slot_max"], profile["slot_target"] + 0.6), 1),
    }


def _normalize_segment_candidate(segment: Dict[str, Any], total_duration: float, pacing_profile: str) -> Dict[str, Any] | None:
    bounds = _semantic_duration_bounds(pacing_profile)
    start = round(max(0.0, _safe_float(segment.get("slot_start"))), 2)
    end = round(min(total_duration, _safe_float(segment.get("slot_end"), start)), 2)

    if end <= start:
        return None

    duration = end - start
    if duration < bounds["min"]:
        end = round(min(total_duration, start + bounds["min"]), 2)
    if end - start > bounds["max"]:
        end = round(min(total_duration, start + bounds["max"]), 2)
    if end <= start:
        return None

    keyword = _compact_spaces(str(segment.get("keyword") or ""))
    phrase = _compact_spaces(str(segment.get("phrase") or ""))
    if not keyword and not phrase:
        return None

    return {
        "slot_start": round(start, 1),
        "slot_end": round(end, 1),
        "keyword": keyword or phrase,
        "phrase": phrase or keyword,
        "word_start": round(_safe_float(segment.get("word_start"), start), 2),
        "word_end": round(_safe_float(segment.get("word_end"), min(end, total_duration)), 2),
        "visual_intent": _compact_spaces(str(segment.get("visual_intent") or "")),
        "reason": _compact_spaces(str(segment.get("reason") or "semantic_llm_selection")),
    }


def _resolve_segment_overlaps(
    segments: List[Dict[str, Any]],
    total_duration: float,
    pacing_profile: str,
) -> List[Dict[str, Any]]:
    if not segments:
        return []

    bounds = _semantic_duration_bounds(pacing_profile)
    ordered = sorted((dict(segment) for segment in segments), key=lambda item: (_safe_float(item.get("slot_start")), _safe_float(item.get("slot_end"))))
    resolved: List[Dict[str, Any]] = []

    for segment in ordered:
        start = _safe_float(segment.get("slot_start"))
        end = _safe_float(segment.get("slot_end"))
        if resolved:
            previous_end = _safe_float(resolved[-1].get("slot_end"))
            if start < previous_end:
                start = previous_end
                if end - start < bounds["min"]:
                    end = min(total_duration, start + bounds["min"])
        if end - start < bounds["min"] or start >= total_duration:
            continue
        if end > total_duration:
            end = total_duration
        segment["slot_start"] = round(start, 1)
        segment["slot_end"] = round(end, 1)
        resolved.append(segment)

    return resolved


def _enforce_first_attention_cut(
    segments: List[Dict[str, Any]],
    total_duration: float,
    pacing_profile: str,
) -> List[Dict[str, Any]]:
    if not segments or total_duration <= FIRST_ATTENTION_CUT_MAX_SECONDS + 1.0:
        return segments

    ordered = sorted((dict(segment) for segment in segments), key=lambda item: (_safe_float(item.get("slot_start")), _safe_float(item.get("slot_end"))))
    first = ordered[0]
    original_start = _safe_float(first.get("slot_start"))
    original_end = _safe_float(first.get("slot_end"), original_start)
    duration = max(0.0, original_end - original_start)
    bounds = _semantic_duration_bounds(pacing_profile)

    target_start = min(FIRST_ATTENTION_CUT_MAX_SECONDS, max(FIRST_ATTENTION_CUT_MIN_SECONDS, original_start))
    if FIRST_ATTENTION_CUT_MIN_SECONDS <= original_start <= FIRST_ATTENTION_CUT_MAX_SECONDS:
        return ordered

    if duration < bounds["min"]:
        duration = bounds["min"]
    if duration > bounds["max"]:
        duration = bounds["max"]

    next_start = _safe_float(ordered[1].get("slot_start"), total_duration) if len(ordered) > 1 else total_duration
    max_allowed_end = min(total_duration, next_start)
    adjusted_end = min(max_allowed_end, target_start + duration)
    if adjusted_end - target_start < bounds["min"]:
        adjusted_end = min(total_duration, target_start + bounds["min"])
        if adjusted_end > next_start and len(ordered) > 1:
            adjusted_end = next_start

    if adjusted_end - target_start >= bounds["min"]:
        first["slot_start"] = round(target_start, 1)
        first["slot_end"] = round(adjusted_end, 1)
        first["reason"] = f"{first.get('reason') or 'semantic_llm_selection'}; first_attention_cut_guardrail"
        ordered[0] = first

    return _resolve_segment_overlaps(ordered, total_duration, pacing_profile)


def _semantic_target_segment_count(total_duration: float, pacing_profile: str, coverage_percent: float) -> int:
    target_total = total_duration * (_normalize_broll_coverage_percent(coverage_percent) / 100.0)
    target_seconds = _semantic_duration_bounds(pacing_profile)["target"]
    return max(1, round(target_total / max(target_seconds, 0.1)))


def _build_semantic_llm_segments(
    scenario_text: str,
    tts_text: str,
    transcript: str,
    words: List[Dict[str, Any]],
    pacing_profile: str,
    coverage_percent: float,
    relevance_priority: str,
    product_clip_policy: str,
    product_keyword: str | None,
) -> List[Dict[str, Any]]:
    normalized_words = _normalize_words(words)
    total_duration = _get_total_duration(normalized_words)
    if not normalized_words or total_duration <= 0:
        return []

    bounds = _semantic_duration_bounds(pacing_profile)
    target_segment_count = _semantic_target_segment_count(total_duration, pacing_profile, coverage_percent)
    product_keyword_value = _compact_spaces(product_keyword or "")

    prompt = f"""
SYSTEM:
Ты — ведущий AI Video Artist и режиссер монтажа вертикального контента (Reels/Shorts/TikTok). Твоя задача — создать глубокие визуальные сценарии (Visual Intents), которые БУКВАЛЬНО иллюстрируют текст.

ГЛАВНАЯ ДИРЕКТИВА:
- Literal Meaning Only: Визуализируй ПРЯМОЙ смысл слов. Никаких метафор (например, НЕ показывай "лампочку" для идеи или "альбом" для воспоминаний). Если текст о путешествии — покажи самолет или туриста, а не "старый чемодан" как символ.
- No Location Hallucinations: НЕ придумывай конкретные страны или города (никаких "Morocco", "Paris"), если их нет в сценарии. Используй нейтральные премиальные локации (Modern Apartment, Luxury Office, High-end Terminal).
- Physical Context: Каждое ключевое слово (keyword) должно быть физическим объектом или действием, реально присутствующим в тексте фразы (Segment Phrase).

ХУДОЖЕСТВЕННЫЙ СТАНДАРТ (9:16 Aesthetics):
- Vertical Composition: Кадр строго 9:16. Фокус на центральном объекте или правиле третей.
- Cinematic Motion: Только One Take с плавным движением (Slow tracking, handheld sway, push-in).
- Micro-Details: Акцент на текстурах через Macro и ECU (поры кожи, ворс ткани, пылинки в свете) — но только для объектов, имеющих отношение к смыслу фразы.
- Luxury Lighting: Премиальное освещение (Golden hour, volumetric light, cinematic shadows).
- No Brands: Заменяй бренды на "High-end unbranded device".

НАСТРОЙКИ МОНТАЖА:
- Ритм монтажа: {pacing_profile}
- Целевое покрытие перебивками: {coverage_percent:.1f}%
- Приоритет точности смысла: {relevance_priority}
- Product clip policy: {product_clip_policy}
- Продуктовый keyword: {product_keyword_value or "не задан"}

TARGETING:
- Длительность ролика: {total_duration:.2f} секунды
- Желательное число перебивок: около {target_segment_count}
- Минимальная длина перебивки: {bounds["min"]:.1f} сек
- Желательная длина перебивки: около {bounds["target"]:.1f} сек
- Максимальная длина перебивки: {bounds["max"]:.1f} сек
- Первая смена кадра должна произойти примерно в окне {FIRST_ATTENTION_CUT_MIN_SECONDS:.1f}–{FIRST_ATTENTION_CUT_MAX_SECONDS:.1f} секунды, если ролик длиннее 6 секунд

RETURN JSON:
{{
  "segments": [
    {{
      "slot_start": 1.2,
      "slot_end": 3.6,
      "keyword": "название предмета (RU)",
      "phrase": "описание действия (RU)",
      "word_start": 1.45,
      "word_end": 3.2,
      "visual_intent": "Deep technical prompt (EN). Структура: [Shot Type / Macro] + [Subject & Action] + [Tactile Textures] + [Lighting & Organic Motion] + [9:16 vertical]",
      "reason": "Режиссерское обоснование: как этот визуал и макро-детали усиливают смысл."
    }}
  ]
}}

СЦЕНАРИЙ:
{scenario_text}

TTS ТЕКСТ:
{tts_text}

TRANSCRIPT:
{transcript}

WORD TIMESTAMPS:
{json.dumps(normalized_words, ensure_ascii=False)}
"""

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
    raw_segments = payload.get("segments") if isinstance(payload, dict) else []
    if not isinstance(raw_segments, list):
        return []

    normalized_segments = []
    for raw_segment in raw_segments:
        if not isinstance(raw_segment, dict):
            continue
        normalized = _normalize_segment_candidate(raw_segment, total_duration, pacing_profile)
        if normalized:
            normalized_segments.append(normalized)

    resolved_segments = _resolve_segment_overlaps(normalized_segments, total_duration, pacing_profile)
    return _enforce_first_attention_cut(resolved_segments, total_duration, pacing_profile)


def _align_segments_to_slot_grid(
    segments: List[Dict[str, Any]],
    slots: List[Dict[str, float]],
    total_duration: float,
) -> List[Dict[str, Any]]:
    if not segments or not slots:
        return segments

    available_slots = sorted(
        (
            {
                "slot_start": round(_safe_float(slot.get("slot_start")), 1),
                "slot_end": round(_safe_float(slot.get("slot_end")), 1),
            }
            for slot in slots
            if isinstance(slot, dict)
        ),
        key=lambda item: (item["slot_start"], item["slot_end"]),
    )
    if not available_slots:
        return segments

    aligned: List[Dict[str, Any]] = []
    used_indices: set[int] = set()

    for segment in sorted((dict(segment) for segment in segments), key=lambda item: (_safe_float(item.get("slot_start")), _safe_float(item.get("slot_end")))):
        start = _safe_float(segment.get("slot_start"))
        end = _safe_float(segment.get("slot_end"), start)

        best_index = None
        best_score = None
        for index, slot in enumerate(available_slots):
            if index in used_indices:
                continue
            slot_start = slot["slot_start"]
            slot_end = slot["slot_end"]
            overlap = max(0.0, min(end, slot_end) - max(start, slot_start))
            distance = abs(start - slot_start) + abs(end - slot_end)
            score = (overlap, -distance)
            if best_score is None or score > best_score:
                best_score = score
                best_index = index

        if best_index is None:
            continue

        matched_slot = available_slots[best_index]
        used_indices.add(best_index)
        aligned.append(
            {
                **segment,
                "slot_start": matched_slot["slot_start"],
                "slot_end": min(matched_slot["slot_end"], round(total_duration, 1)),
                "reason": f"{segment.get('reason') or 'semantic_llm_selection'}; aligned_to_slot_grid",
            }
        )

    return aligned


def _build_timing_logic_text(
    slots: List[Dict[str, float]],
    timing_mode: str,
    interval: float,
    pacing_profile: str,
    pause_threshold_seconds: float,
    coverage_percent: float,
    meaning_windows: List[Dict[str, float]] | None = None,
) -> str:
    if timing_mode == "fixed":
        meaning_window_text = ""
        if meaning_windows:
            meaning_window_text = f"""
- тайминг остаётся фиксированным, но keyword и phrase нужно искать по ближайшему смысловому окну, а не механически внутри fixed-границ
- используй эти смысловые окна как источник темы для fixed-слотов, но в ответе всегда сохраняй slot_start/slot_end из fixed-слотов:
  {json.dumps(meaning_windows, ensure_ascii=False)}
"""
        return f"""
- монтажный режим legacy: жёсткий интервал {interval:.1f} секунды
- слоты ниже уже рассчитаны по фиксированному шагу
- итоговое видео будет вставлено ровно в эти fixed-тайминги
{meaning_window_text}
- работай только внутри этих окон:
  {json.dumps(slots, ensure_ascii=False)}
"""

    if timing_mode == "coverage_percent":
        return f"""
- монтажный режим: целевое процентное покрытие перебивками
- профиль темпа: {pacing_profile}
- целевая доля ролика под перебивки: {coverage_percent:.1f}%
- алгоритм сам определяет, где лучше ставить окна по смыслу, фразам и естественному ритму речи
- перебивки могут идти подряд, если это лучше иллюстрирует сценарий и помогает набрать целевое покрытие
- слоты ниже уже подобраны алгоритмом так, чтобы b-roll занимал примерно нужную долю ролика без жёсткой сетки
- не придумывай новые окна и не сдвигай границы, работай только внутри этих окон:
  {json.dumps(slots, ensure_ascii=False)}
"""

    return f"""
- монтажный режим: смысловые окна по паузам и концам фраз
- профиль темпа: {pacing_profile}
- слоты ниже подобраны как страховочная сетка; приоритет у смысловых блоков сценария, а не у механических пауз
- если модель вернёт качественные тайминги, именно они станут основой монтажа
- эти слоты нужны как fallback и для пост-обработки, а не как жёсткая инструкция для выбора смысла
- не придумывай новые окна и не сдвигай границы, работай только внутри этих окон:
  {json.dumps(slots, ensure_ascii=False)}
"""


def extract_visual_keyword_segments(
    scenario_text: str,
    tts_text: str,
    transcript: str,
    words: List[Dict[str, Any]],
    broll_interval_seconds: float | None = None,
    broll_timing_mode: str | None = None,
    broll_pacing_profile: str | None = None,
    broll_pause_threshold_seconds: float | None = None,
    broll_coverage_percent: float | None = None,
    broll_semantic_relevance_priority: str | None = None,
    broll_product_clip_policy: str | None = None,
    product_keyword: str | None = None,
    product_video_url: str | None = None,
    product_media_assets: List[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    interval = _normalize_broll_interval_seconds(broll_interval_seconds)
    timing_mode = _normalize_broll_timing_mode(broll_timing_mode)
    pacing_profile = _normalize_broll_pacing_profile(broll_pacing_profile)
    pause_threshold_seconds = _normalize_pause_threshold_seconds(broll_pause_threshold_seconds)
    coverage_percent = _normalize_broll_coverage_percent(broll_coverage_percent)
    semantic_relevance_priority = _normalize_semantic_relevance_priority(broll_semantic_relevance_priority)
    product_clip_policy = _normalize_product_clip_policy(broll_product_clip_policy)

    slots = build_keyword_slots(
        words=words,
        broll_interval_seconds=interval,
        broll_timing_mode=timing_mode,
        broll_pacing_profile=pacing_profile,
        broll_pause_threshold_seconds=pause_threshold_seconds,
        broll_coverage_percent=coverage_percent,
    )
    if not slots:
        return {"segments": [], "updated_at": None}

    meaning_windows = _build_fixed_meaning_windows(words, slots, pause_threshold_seconds) if timing_mode == "fixed" else []
    total_duration = _get_total_duration(words, slots)

    if timing_mode == "semantic_pause":
        try:
            semantic_segments = _build_semantic_llm_segments(
                scenario_text=scenario_text,
                tts_text=tts_text,
                transcript=transcript,
                words=words,
                pacing_profile=pacing_profile,
                coverage_percent=coverage_percent,
                relevance_priority=semantic_relevance_priority,
                product_clip_policy=product_clip_policy,
                product_keyword=product_keyword,
            )
            force_product_segment = product_clip_policy == "required"
            return {
                "segments": _apply_product_asset(
                    semantic_segments,
                    product_keyword,
                    product_video_url,
                    product_media_assets,
                    words,
                    slots,
                    force_product_segment=force_product_segment,
                ),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as error:
            logger.error("Failed to build semantic LLM-first segments: %s", error)

    timing_logic = _build_timing_logic_text(
        slots=slots,
        timing_mode=timing_mode,
        interval=interval,
        pacing_profile=pacing_profile,
        pause_threshold_seconds=pause_threshold_seconds,
        coverage_percent=coverage_percent,
        meaning_windows=meaning_windows,
    )

    prompt = f"""
SYSTEM:
Ты — Principal AI Video Director и главный режиссер монтажа вертикального контента высокого уровня (Premium UGC/Reels/TikTok). Твоя задача — создать кинематографичные визуальные сценарии (Visual Intents), которые передают АТМОСФЕРУ и контекст фразы, избегая скучных «предметных» съемок.

ГЛАВНАЯ ДИРЕКТИВА:
- Cinematic Realism & Context: Вместо того чтобы просто показывать ПРЕДМЕТ в центре кадра, покажи ЖИВУЮ СЦЕНУ. Если текст о путешествии — покажи человека, смотрящего на взлетную полосу через стекло, или POV-вид из такси на ночной город.
- UGC Human Touch: Кадр должен выглядеть так, будто его снял реальный человек на iPhone. Добавляй признаки жизни: рука в углу кадра, отражение в стекле, движение людей на заднем плане, пар от кофе.
- No Location Hallucinations: НЕ придумывай конкретные страны, если их нет. Используй премиальные универсальные локации.

ХУДОЖЕСТВЕННЫЙ СТАНДАРТ (9:16 Cinematic Flow):
- Dynamic Shot Variety: Категорически запрещено использовать один и тот же план дважды подряд. Чередуй масштабы:
  * ECU (Extreme Close-Up): Деталь (глаз, палец на кнопке, текстура ткани).
  * MCU (Medium Close-Up): Портрет или предмет в руках (плечевой план).
  * MS (Medium Shot): Человек по пояс в среде.
  * LS (Long Shot / Wide): Атмосферный общий план (интерьер, улица).
  * POV (Point of View): Вид "из глаз", вовлекающий зрителя.
- Rule of Thirds & Framing: Избегай центрирования. Используй правило третей, фрейминг через объекты на переднем плане и "отрицательное пространство" (свободное место для текста).
- Atmospheric Lighting (The "High-End" Look): Всегда прописывай свет: "Golden hour glow", "Volumetric dust motes", "Soft rim lighting from a laptop screen", "Cinematic blue hour shadows".
- Organic Motion: Только динамика. Камера всегда в движении (Subtle handheld sway, smooth push-in, slow pan along a surface).
- No Brands & Generic Clutter: Только премиальный минимализм.

ЛОГИКА СЛОТОВ:
- Первая смена кадра должна произойти примерно в окне {FIRST_ATTENTION_CUT_MIN_SECONDS:.1f}–{FIRST_ATTENTION_CUT_MAX_SECONDS:.1f} секунды, если ролик длиннее 6 секунд. При этом первый сегмент должен быть максимально качественным и буквально передающим смысл фразы.
{timing_logic}

PRODUCT KEYWORD:
{product_keyword or ""}

SEMANTIC RELEVANCE PRIORITY:
{semantic_relevance_priority}

PRODUCT CLIP POLICY:
{product_clip_policy}

RETURN JSON:
{{
  "segments": [
    {{
      "slot_start": {slots[0]["slot_start"]},
      "slot_end": {slots[0]["slot_end"]},
      "keyword": "название предмета (RU)",
      "phrase": "описание действия (RU)",
      "word_start": 1.24,
      "word_end": 1.88,
      "visual_intent": "Deep cinematic prompt (EN). Структура: [Shot Scale] + [Subject Actions & UGC details] + [Environment & Lighting] + [9:16 vertical composition]",
      "reason": "Director's reasoning: почему выбран этот ракурс и как он создает ритм (чередование планов)."
    }}
  ]
}}

СЦЕНАРИЙ:
{scenario_text}

ТЕКСТ ДЛЯ TTS:
{tts_text}

DEEPGRAM TRANSCRIPT:
{transcript}

SLOTS:
{json.dumps(slots, ensure_ascii=False)}

WORD TIMESTAMPS:
{json.dumps(words, ensure_ascii=False)}
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
        segments = payload.get("segments") if isinstance(payload, dict) else []
        if not isinstance(segments, list):
            segments = []

        final_segments = segments
        if timing_mode == "fixed":
            final_segments = _apply_fixed_enumeration_priority(final_segments, words, slots, product_keyword)

        force_product_segment = timing_mode != "fixed" and product_clip_policy == "required"

        return {
            "segments": _enforce_first_attention_cut(
                _apply_product_asset(
                    final_segments,
                    product_keyword,
                    product_video_url,
                    product_media_assets,
                    words,
                    slots,
                    force_product_segment=force_product_segment,
                ),
                total_duration,
                pacing_profile,
            ),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as error:
        logger.error("Failed to extract visual keyword segments: %s", error)
        fallback_segments = _fallback_segments(words, slots, meaning_windows)
        if timing_mode == "fixed":
            fallback_segments = _apply_fixed_enumeration_priority(fallback_segments, words, slots, product_keyword)
        force_product_segment = timing_mode != "fixed" and product_clip_policy == "required"
        return {
            "segments": _enforce_first_attention_cut(
                _apply_product_asset(
                    fallback_segments,
                    product_keyword,
                    product_video_url,
                    product_media_assets,
                    words,
                    slots,
                    force_product_segment=force_product_segment,
                ),
                total_duration,
                pacing_profile,
            ),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
