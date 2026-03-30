import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List

from openai import OpenAI

logger = logging.getLogger(__name__)

STRONG_BOUNDARY_RE = re.compile(r"[.!?;:]$")
SOFT_BOUNDARY_RE = re.compile(r"[,)]$")
MIN_BROLL_SEGMENT_SECONDS = 2.0
MIN_PRODUCT_SEGMENT_SECONDS = 3.0
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
    return normalized if normalized in {"fixed", "semantic_pause"} else "semantic_pause"


def _normalize_broll_pacing_profile(value: Any) -> str:
    normalized = str(value or "balanced").strip().lower()
    return normalized if normalized in PACING_PRESETS else "balanced"


def _normalize_pause_threshold_seconds(value: Any) -> float:
    try:
        normalized = round(float(value or 0.45), 2)
    except (TypeError, ValueError):
        normalized = 0.45
    return max(0.15, min(normalized, 1.2))


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
    current = interval
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
        start_boundary = _select_boundary(
            boundaries=boundaries,
            min_time=timeline_cursor + min_avatar_gap,
            target_time=timeline_cursor + target_avatar_gap,
            max_time=min(timeline_cursor + max_avatar_gap, max_end - slot_min),
            fallback_extension=0.9,
        )
        if not start_boundary:
            break

        slot_start = round(start_boundary["time"], 2)
        if slot_start <= timeline_cursor + 0.25:
            timeline_cursor = round(slot_start + 0.25, 2)
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


def build_keyword_slots(
    words: List[Dict[str, Any]],
    broll_interval_seconds: float = 3.0,
    broll_timing_mode: str = "semantic_pause",
    broll_pacing_profile: str = "balanced",
    broll_pause_threshold_seconds: float = 0.45,
) -> List[Dict[str, float]]:
    timing_mode = _normalize_broll_timing_mode(broll_timing_mode)
    interval = _normalize_broll_interval_seconds(broll_interval_seconds)
    pause_threshold = _normalize_pause_threshold_seconds(broll_pause_threshold_seconds)
    profile = _normalize_broll_pacing_profile(broll_pacing_profile)

    if timing_mode == "fixed":
        return _build_fixed_keyword_slots(words, interval)

    return _build_semantic_keyword_slots(words, interval, profile, pause_threshold)


def _fallback_segments(words: List[Dict[str, Any]], slots: List[Dict[str, float]]) -> List[Dict[str, Any]]:
    segments: List[Dict[str, Any]] = []
    for slot in slots:
        slot_words = [
            word for word in (words or [])
            if isinstance(word, dict) and _safe_float(word.get("start")) >= slot["slot_start"] and _safe_float(word.get("start")) < slot["slot_end"]
        ]
        if not slot_words:
            continue

        chosen = next((word for word in slot_words if len((word.get("word") or "").strip()) > 3), slot_words[0])
        keyword = (chosen.get("word") or "").strip()
        if not keyword:
            continue

        segments.append({
            "slot_start": slot["slot_start"],
            "slot_end": slot["slot_end"],
            "keyword": keyword,
            "phrase": chosen.get("punctuated_word") or keyword,
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


def _build_phrase_from_slot(slot_words: List[Dict[str, Any]], max_words: int = 8) -> str:
    parts: List[str] = []
    for word in slot_words[:max_words]:
        token = (word.get("punctuated_word") or word.get("word") or "").strip()
        if token:
            parts.append(token)
    return _compact_spaces(" ".join(parts))


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
        combined = _normalize_match_text(" ".join((w.get("word") or "") for w in slot_words))
        if normalized_keyword not in combined:
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


def _apply_product_asset(
    segments: List[Dict[str, Any]],
    product_keyword: str | None,
    product_video_url: str | None,
    words: List[Dict[str, Any]] | None = None,
    slots: List[Dict[str, float]] | None = None,
) -> List[Dict[str, Any]]:
    normalized_keyword = _normalize_match_text(product_keyword or "").strip()
    if not normalized_keyword:
        return segments

    result = []
    for segment in segments:
        keyword_text = _normalize_match_text(segment.get("keyword", ""))
        phrase_text = _normalize_match_text(segment.get("phrase", ""))
        combined = f"{keyword_text} {phrase_text}"
        if normalized_keyword in combined:
            result.append({
                **segment,
                "asset_type": "product_video",
                "asset_url": product_video_url,
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
    if not has_product_segment and words and slots:
        forced_segment = _find_product_segment(words, slots, product_keyword or "")
        if forced_segment:
            forced_segment["asset_url"] = product_video_url
            result.append(forced_segment)

    total_duration = _get_total_duration(words, slots) or max((_safe_float(item.get("slot_end")) for item in result), default=0.0)
    generalized = [_generalize_consumer_good_segment(item) for item in result]
    return _enforce_minimum_segment_durations(generalized, total_duration)


def _build_timing_logic_text(
    slots: List[Dict[str, float]],
    timing_mode: str,
    interval: float,
    pacing_profile: str,
    pause_threshold_seconds: float,
) -> str:
    if timing_mode == "fixed":
        return f"""
- монтажный режим legacy: жёсткий интервал {interval:.1f} секунды
- слоты ниже уже рассчитаны по фиксированному шагу
- работай только внутри этих окон:
  {json.dumps(slots, ensure_ascii=False)}
"""

    return f"""
- монтажный режим: смысловые окна по паузам и концам фраз
- профиль темпа: {pacing_profile}
- целевой средний интервал до следующей перебивки: {interval:.1f} секунды
- минимальная пауза для сильной точки: {pause_threshold_seconds:.2f} секунды
- слоты ниже уже подобраны алгоритмом, который ищет профессиональные точки склейки по речи
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
    product_keyword: str | None = None,
    product_video_url: str | None = None,
) -> Dict[str, Any]:
    interval = _normalize_broll_interval_seconds(broll_interval_seconds)
    timing_mode = _normalize_broll_timing_mode(broll_timing_mode)
    pacing_profile = _normalize_broll_pacing_profile(broll_pacing_profile)
    pause_threshold_seconds = _normalize_pause_threshold_seconds(broll_pause_threshold_seconds)

    slots = build_keyword_slots(
        words=words,
        broll_interval_seconds=interval,
        broll_timing_mode=timing_mode,
        broll_pacing_profile=pacing_profile,
        broll_pause_threshold_seconds=pause_threshold_seconds,
    )
    if not slots:
        return {"segments": [], "updated_at": None}

    timing_logic = _build_timing_logic_text(
        slots=slots,
        timing_mode=timing_mode,
        interval=interval,
        pacing_profile=pacing_profile,
        pause_threshold_seconds=pause_threshold_seconds,
    )

    prompt = f"""
SYSTEM:
Ты редактор short-form видео и visual researcher.
Нужно извлечь ключевые слова и короткие фразы для video b-roll.

ЛОГИКА СЛОТОВ:
{timing_logic}
- для каждого слота верни ровно 1 лучший визуальный якорь, если в слоте есть подходящий материал

ПРАВИЛА:
- анализируй общий смысл сценария, а не отдельные слова в отрыве от темы
- выбирай визуально понятные смысловые фразы, а не общие одиночные слова
- phrase обычно должна быть длиной 2-6 слов и звучать как готовый визуальный сюжет
- если сценарий завязан на конкретной локации, бренде, событии, сезоне или сущности, phrase должна сохранять этот якорь внутри себя
- generic слова вроде "курорт", "море", "тайфун", "отель", "туристы" без контекста почти всегда плохой выбор; лучше "сезон дождей на Хайнане", "спокойное море в октябре на Хайнане", "толпы туристов на Хайнане зимой"
- keyword тоже должен быть максимально предметным; если можно, предпочитай конкретную тему окна, а не абстрактный класс объектов
- если в тексте упоминается обычный потребительский товар, но у нас нет готового реального ассета для него, не формулируй якорь как точный предмет "вот этот спрей" или "конкретный крем"; вместо этого обобщай до категории или use-case: "средство от комаров в дорожной аптечке", "солнцезащитный крем в пляжной сумке", "капсулы для пищеварения в поездке"
- для таких товаров избегай брендов, читаемых упаковок, claims про точную банку или ощущение, что зритель обязан увидеть именно тот же самый физический товар из речи
- phrase должна быть полноценной и полезной для будущего video prompt, а не обрывком слова в неправильном падеже
- если нужно, дополни phrase до естественного и законченного смыслового якоря, но не выдумывай новую тему вне сценария
- phrase должна помогать построить промпт для видео-перебивки и быть напрямую связана с темой повествования
- избегай служебных слов, местоимений, союзов и абстракций без визуального образа
- избегай обрывков вроде "границей", "картинкам", "реальными людьми" без контекста; вместо этого возвращай завершённые фразы вроде "переезд за границу", "красивые картинки в Инстаграме", "общение с реальными людьми"
- если в точном окне нет сильного кандидата, можно взять ближайшую короткую фразу внутри этого же слота
- цель: подготовить основу для профессиональных видео-перебивок поверх talking-head видео
- не возвращай соседние интервалы вне списка SLOTS
- если в слоте есть упоминание product keyword, оно имеет приоритет над обычными кандидатами
- product keyword нужно обязательно вывести как минимум в одном сегменте, если оно встречается в тексте

ПЛОХО -> ХОРОШО:
- "курорт" -> "Хайнань как круглогодичный курорт"
- "тайфун" -> "тайфуны на Хайнане летом"
- "море" -> "спокойное море на Хайнане в октябре"
- "цены" -> "дорогие отели на Хайнане зимой"

RETURN:
Только JSON объект вида:
{{
  "segments": [
    {{
      "slot_start": {slots[0]["slot_start"]},
      "slot_end": {slots[0]["slot_end"]},
      "keyword": "эмиграция",
      "phrase": "переезд за границу",
      "word_start": 1.24,
      "word_end": 1.88,
      "visual_intent": "аэропорт, чемоданы, перелет, новая страна",
      "reason": "сильный визуальный якорь внутри смыслового окна"
    }}
  ]
}}

PRODUCT KEYWORD:
{product_keyword or ""}

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
        segments = payload.get("segments") if isinstance(payload, dict) else []
        if not isinstance(segments, list):
            segments = []

        return {
            "segments": _apply_product_asset(segments, product_keyword, product_video_url, words, slots),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as error:
        logger.error("Failed to extract visual keyword segments: %s", error)
        return {
            "segments": _apply_product_asset(_fallback_segments(words, slots), product_keyword, product_video_url, words, slots),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
