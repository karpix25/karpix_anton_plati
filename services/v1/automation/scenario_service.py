# Copyright (c) 2025 Stephen G. Pope
#
# Scenario Service: Generates a new script based on the audit.

import os
import json
import logging
import re
import ast
import math
from openai import OpenAI

# Set up logging
logger = logging.getLogger(__name__)

from dotenv import load_dotenv
load_dotenv(override=True)


def _get_env_float(name: str, default: float, minimum: float | None = None, maximum: float | None = None) -> float:
    raw = os.getenv(name)
    try:
        value = float(raw) if raw is not None else float(default)
    except (TypeError, ValueError):
        value = float(default)

    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


# UI uses ~2.2 words/sec as operator-facing pace model; keep backend aligned.
TARGET_WORDS_PER_SECOND = _get_env_float("SCENARIO_TARGET_WORDS_PER_SECOND", 2.2, minimum=1.2, maximum=3.0)
# Keep a safety buffer so "до N сек" is respected more reliably in real TTS output.
TARGET_WORD_BUDGET_MAX_RATIO = _get_env_float("SCENARIO_TARGET_WORD_BUDGET_MAX_RATIO", 0.9, minimum=0.7, maximum=1.0)
TARGET_WORD_BUDGET_MIN_RATIO = _get_env_float("SCENARIO_TARGET_WORD_BUDGET_MIN_RATIO", 0.82, minimum=0.6, maximum=1.0)
TARGET_CHAR_BUDGET_MAX_RATIO = _get_env_float("SCENARIO_TARGET_CHAR_BUDGET_MAX_RATIO", 0.95, minimum=0.7, maximum=1.0)
TARGET_CHAR_BUDGET_MIN_RATIO = _get_env_float("SCENARIO_TARGET_CHAR_BUDGET_MIN_RATIO", 0.88, minimum=0.6, maximum=1.0)

def _openrouter_client():
    api_key = os.getenv("OPENROUTER_API_KEY")
    if api_key:
        masked = api_key[:10] + "..." + api_key[-4:]
        logger.info(f"Using OpenRouter API Key: {masked}")
    else:
        logger.error("OPENROUTER_API_KEY NOT FOUND IN ENVIRONMENT")
        
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key
    )

def _clean_markdown_json(content: str) -> str:
    value = (content or "").strip()
    if "```json" in value:
        value = value.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in value:
        value = value.split("```", 1)[1].split("```", 1)[0].strip()
    return value


def _extract_json_object(text: str) -> str | None:
    value = (text or "").strip()
    start = value.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escaped = False
    for idx in range(start, len(value)):
        ch = value[idx]
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return value[start : idx + 1]
    return None


def _try_parse_json_payload(raw_content: str):
    cleaned = _clean_markdown_json(raw_content)
    candidates = [cleaned]

    extracted = _extract_json_object(cleaned)
    if extracted and extracted not in candidates:
        candidates.append(extracted)

    for candidate in candidates:
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except Exception:
            pass

        try:
            parsed = ast.literal_eval(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        normalized = candidate.replace("“", '"').replace("”", '"').replace("’", "'")
        normalized = re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_\-]*)(\s*:)', r'\1"\2"\3', normalized)
        normalized = normalized.replace("None", "null").replace("True", "true").replace("False", "false")
        try:
            parsed = ast.literal_eval(normalized)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        if "'" in normalized and '"' not in normalized:
            normalized = normalized.replace("'", '"')
        try:
            return json.loads(normalized)
        except Exception:
            pass

    raise ValueError("Could not parse model response as valid JSON object")


def _repair_json_with_model(client: OpenAI, raw_content: str):
    repair_prompt = f"""
Convert the following text to a strict valid JSON object.
Rules:
- Return only JSON.
- No markdown fences.
- Keep the same semantics.

TEXT:
{raw_content}
"""
    model = os.getenv("SCENARIO_MODEL", "google/gemini-2.5-flash")
    repaired = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": repair_prompt}],
        response_format={"type": "json_object"},
    )
    repaired_content = repaired.choices[0].message.content
    return _try_parse_json_payload(repaired_content)


def _chat_json(prompt):
    client = _openrouter_client()
    last_error = None

    model = os.getenv("SCENARIO_MODEL", "google/gemini-2.5-flash")
    for attempt in range(1, 3):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            content = response.choices[0].message.content
            try:
                return _try_parse_json_payload(content)
            except Exception as parse_error:
                logger.warning("JSON parse failed in _chat_json (attempt %s): %s", attempt, parse_error)
                logger.warning("Raw model response preview: %s", (content or "").replace("\n", " ")[:400])
                try:
                    return _repair_json_with_model(client, content)
                except Exception as repair_error:
                    last_error = repair_error
                    logger.warning("JSON repair failed in _chat_json (attempt %s): %s", attempt, repair_error)
        except Exception as request_error:
            last_error = request_error
            logger.error("OpenRouter request failed in _chat_json (attempt %s): %s", attempt, request_error)

    logger.error("Error in _chat_json after retries: %s", last_error)
    print(f"FAILED TO PARSE JSON: {last_error}")
    raise last_error

def _chat_text(prompt: str) -> str:
    client = _openrouter_client()
    model = os.getenv("SCENARIO_MODEL", "google/gemini-2.5-flash")
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Error in _chat_text: {e}")
        return ""

def _pattern_framework(audit_json):
    if not audit_json:
        return {}
    return audit_json.get("pattern_framework", {}) or {}


def _transcript_meta(audit_json, transcript_meta=None):
    if transcript_meta:
        return transcript_meta
    if not audit_json:
        return {}
    return audit_json.get("transcript_meta", {}) or {}


def normalize_narrator_gender(gender, default="female") -> str:
    raw = str(gender or "").strip().lower().replace("ё", "е")
    if not raw:
        return default

    male_aliases = {"male", "man", "m", "м", "муж", "мужской"}
    female_aliases = {"female", "woman", "f", "ж", "жен", "женский"}

    if raw in male_aliases or raw.startswith("male") or raw.startswith("муж"):
        return "male"
    if raw in female_aliases or raw.startswith("female") or raw.startswith("жен"):
        return "female"

    logger.warning("Unknown narrator gender '%s', fallback to '%s'", gender, default)
    return default


def count_spoken_characters(text: str | None) -> int:
    return len(re.sub(r"\s+", "", text or ""))


def _resolve_duration_targets(
    source_duration_seconds=None,
    source_wpm=None,
    target_duration_seconds=None,
    target_duration_min_seconds=None,
    target_duration_max_seconds=None,
    voice_chars_per_minute=None,
):
    fallback_duration = float(target_duration_seconds or source_duration_seconds or 50)
    resolved_min = float(target_duration_min_seconds or target_duration_seconds or fallback_duration)
    resolved_max = float(target_duration_max_seconds or target_duration_seconds or resolved_min)
    resolved_min = max(resolved_min, 1.0)
    resolved_max = max(resolved_max, resolved_min)
    resolved_center = float(target_duration_seconds or ((resolved_min + resolved_max) / 2.0))

    source_wps = 0.0
    try:
        source_wps = float(source_wpm or 0) / 60.0
    except (TypeError, ValueError):
        source_wps = 0.0

    # Use conservative pace to avoid overruns (prefer stricter of source pace and configured pace).
    effective_wps = TARGET_WORDS_PER_SECOND
    if source_wps > 0:
        effective_wps = min(TARGET_WORDS_PER_SECOND, source_wps)

    min_word_target = max(int(math.ceil(resolved_min * effective_wps * TARGET_WORD_BUDGET_MIN_RATIO)), 1)
    max_word_target = max(int(math.floor(resolved_max * effective_wps * TARGET_WORD_BUDGET_MAX_RATIO)), min_word_target)

    resolved_voice_chars_per_minute = 0.0
    try:
        resolved_voice_chars_per_minute = float(voice_chars_per_minute or 0)
    except (TypeError, ValueError):
        resolved_voice_chars_per_minute = 0.0
    if resolved_voice_chars_per_minute < 0:
        resolved_voice_chars_per_minute = 0.0

    min_char_target = None
    max_char_target = None
    if resolved_voice_chars_per_minute > 0:
        min_char_target = max(
            int(math.ceil((resolved_min / 60.0) * resolved_voice_chars_per_minute * TARGET_CHAR_BUDGET_MIN_RATIO)),
            1,
        )
        max_char_target = max(
            int(math.floor((resolved_max / 60.0) * resolved_voice_chars_per_minute * TARGET_CHAR_BUDGET_MAX_RATIO)),
            min_char_target,
        )

    return {
        "min_seconds": resolved_min,
        "max_seconds": resolved_max,
        "center_seconds": resolved_center,
        "min_word_target": min_word_target,
        "max_word_target": max_word_target,
        "voice_chars_per_minute": resolved_voice_chars_per_minute if resolved_voice_chars_per_minute > 0 else None,
        "min_char_target": min_char_target,
        "max_char_target": max_char_target,
        "duration_range_label": f"{resolved_min:.0f}-{resolved_max:.0f} сек",
    }


HOOK_BAN_PHRASES = [
    "думаешь",
    "думаете",
    "а вот и нет",
    "забудьте",
    "прикол в том",
]

FILLER_WORDS_BAN = [
    "короче",
    "типа",
    "ну",
    "как бы",
    "в общем",
    "в целом",
    "значит",
    "понимаешь",
    "знаешь",
    "по сути",
]

UNSHOWABLE_REFERENCE_NOUNS_PATTERN = (
    r"(?:"
    r"сайт(?:а|ы|ов)?|"
    r"сервис(?:а|ы|ов)?|"
    r"приложени(?:е|я|й)|"
    r"платформ(?:а|ы)|"
    r"ссылк(?:а|и|у|е|ой|ами|ах)?|"
    r"товар(?:а|ы|ов)?|"
    r"продукт(?:а|ы|ов)?|"
    r"крем(?:а|ы|ов)?|"
    r"спрей(?:я|и|ев)?|"
    r"лекарств(?:о|а)?|"
    r"витамин(?:ы|ов)?|"
    r"капсул(?:а|ы|у|е|ой|ами|ах)?|"
    r"таблетк(?:а|и|у|е|ой|ами|ах)?|"
    r"маз(?:ь|и)|"
    r"флакон(?:а|ы|ов)?|"
    r"бутылк(?:а|и|у|е|ой|ами|ах)?"
    r")"
)

UNSHOWABLE_REFERENCE_PATTERNS = [
    (
        re.compile(
            rf"\b(?:вот\s+это|(?:вот\s+)?(?:этот|эта|эту|эти|этих))\s+(?:[а-яa-z0-9-]+\s+){{0,2}}{UNSHOWABLE_REFERENCE_NOUNS_PATTERN}\b",
            flags=re.IGNORECASE,
        ),
        "direct_demonstrative_reference",
    ),
    (
        re.compile(
            rf"\b(?:перв(?:ый|ая|ое)|втор(?:ой|ая|ое)|трет(?:ий|ья|ье))\s+(?:[а-яa-z0-9-]+\s+){{0,2}}{UNSHOWABLE_REFERENCE_NOUNS_PATTERN}\b",
            flags=re.IGNORECASE,
        ),
        "ordinal_specific_reference",
    ),
]


def find_unshowable_asset_reference_issues(script: str):
    normalized = re.sub(r"\s+", " ", (script or "").strip()).lower().replace("ё", "е")
    if not normalized:
        return []

    issues = []
    seen = set()
    for pattern, reason in UNSHOWABLE_REFERENCE_PATTERNS:
        for match in pattern.finditer(normalized):
            snippet = match.group(0).strip()
            key = (reason, snippet)
            if key in seen:
                continue
            seen.add(key)
            issues.append({"reason": reason, "match": snippet})
    return issues


def has_unshowable_asset_reference_issues(script: str) -> bool:
    return bool(find_unshowable_asset_reference_issues(script))


def _asset_visibility_guardrails() -> str:
    return """
    ASSET VISIBILITY CONSTRAINTS:
    - We cannot show real third-party websites, app screens, or arbitrary consumer products unless a real asset was prepared in advance.
    - Therefore do NOT write lines that point at a concrete unseen object as if the viewer can see it on screen.
    - Forbidden examples: "вот эти сайты", "вот этот сайт", "первый сайт", "второй сайт", "вот этот крем", "вот этот спрей", "вот это приложение".
    - If you need to mention resources or items, speak generically and non-pointingly: "есть сервис, который...", "одна платформа помогает...", "несколько сайтов с визовой информацией", "средство от комаров", "крем с высоким SPF".
    - Do not build the script around numbered unseen websites or products that imply on-screen demonstration.
    - The script must remain truthful for a talking-head video even if no external website/product footage is shown.
    """


def _spoken_numbers_guardrail() -> str:
    return """
    SPOKEN NUMBERS RULE:
    - ALL numbers in the final Russian script must be written out in words, never as Arabic numerals.
    - This applies to counts, prices, percentages, years, dates, times, ranges, ratios, durations, limits, and list numbers.
    - Examples: "двадцать", "сто пятьдесят", "девяносто восемь процентов", "две тысячи двадцать шестой год", "от трех до пяти дней".
    - Do not output forms like "20", "1500", "98%", "2026", "3-5 дней", even if the source used digits.
    - If an exact number sounds unnatural in speech, rewrite it into a natural spoken form while preserving the meaning as closely as possible.
    """


def _forbidden_tags_guardrail() -> str:
    return """
    FORBIDDEN TAGS RULE:
    - DO NOT use any interjection or emotion tags in the script.
    - Strictly forbidden: (breath), (inhale), (chuckle), (chuckles), (sighs), (snorts), (gasps), (emm), (hum), (laughter), (pause).
    - Do not put any instructions in parentheses inside the script.
    - The output must be pure spoken text only.
    """


def _split_sentences(text: str):
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return []
    parts = re.split(r"(?<=[.!?])\s+", cleaned)
    return [part.strip() for part in parts if part.strip()]


def _normalize_hook_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).lower().replace("ё", "е")


def _hook_context_from_transcript(transcript: str):
    sentences = _split_sentences(transcript)
    first_sentence = sentences[0] if len(sentences) > 0 else ""
    second_sentence = sentences[1] if len(sentences) > 1 else ""
    opening = " ".join([part for part in [first_sentence, second_sentence] if part]).strip()
    normalized_opening = opening.lower().replace("ё", "е")
    allowed_ban_phrases = [phrase for phrase in HOOK_BAN_PHRASES if phrase in normalized_opening]
    return {
        "opening": opening,
        "first_sentence": first_sentence,
        "second_sentence": second_sentence,
        "allowed_ban_phrases": allowed_ban_phrases,
    }


def _classify_hook_shape(text: str) -> str:
    opening = _normalize_hook_text(text)
    if not opening:
        return "unknown"
    if re.match(r"^\d+\b", opening):
        return "numbered_list"
    if opening.endswith("?"):
        return "question"
    if re.match(r"^(не |никогда |хватит |перестан|забуд|не пытай|не едь|не делай)", opening):
        return "warning_or_contrarian"
    if re.match(r"^(смотри|запомни|проверь|знай|езжай|бери|делай|используй|сохрани)", opening):
        return "direct_command"
    if ":" in opening[:40]:
        return "label_or_list_setup"
    return "statement"


def _hook_blueprint(text: str) -> dict:
    context = _hook_context_from_transcript(text)
    opening = context["opening"] or re.sub(r"\s+", " ", (text or "").strip())
    first_sentence = context["first_sentence"] or opening
    opening_words = first_sentence.split()
    return {
        "opening": opening,
        "first_sentence": first_sentence,
        "second_sentence": context["second_sentence"],
        "shape": _classify_hook_shape(first_sentence),
        "first_words": " ".join(opening_words[:8]),
        "first_sentence_word_count": len(opening_words),
        "has_numbered_opening": bool(re.match(r"^\d+\b", first_sentence.strip())),
        "has_question_mark": "?" in first_sentence,
    }


def _hook_context_from_source_cards(topic_card=None, structure_card=None):
    source_content_id = (
        structure_card.get("source_content_id")
        or topic_card.get("source_content_id")
        if (topic_card or structure_card)
        else None
    )
    if not source_content_id:
        return _hook_context_from_transcript("")

    try:
        from services.v1.database.db_service import get_entity_by_id

        source_content = get_entity_by_id("processed_content", int(source_content_id))
        transcript = (source_content or {}).get("transcript") or ""
        return _hook_context_from_transcript(transcript)
    except Exception as error:
        logger.error(f"Failed to load source hook context from cards: {error}")
        return _hook_context_from_transcript("")


def rewrite_reference_script(transcript, audit_json=None, transcript_meta=None, niche="General", target_product_info=None, brand_voice=None, target_audience=None, variation_index=1, total_variations=1, destination_hint=None, target_duration_seconds=None, target_duration_min_seconds=None, target_duration_max_seconds=None, learned_rules_scenario=None, gender="female", voice_chars_per_minute=None):
    """
    Produces a very close rewrite of the source transcript.
    The structure, pacing, theme, and dramatic arc should stay almost identical.
    Only details, wording, examples, and product-specific information should shift.
    """
    gender = normalize_narrator_gender(gender)
    product_context = target_product_info or f"Сервис в нише: {niche}"
    voice_context = brand_voice or "Естественный, разговорный, без канцелярита"
    audience_context = target_audience or "Люди, которым важны быстрые и понятные решения"
    pattern = _pattern_framework(audit_json)
    strategy = (audit_json or {}).get("reference_strategy", {})
    meta = _transcript_meta(audit_json, transcript_meta)
    destination_context = destination_hint or "Без принудительной смены страны/города"
    source_word_count = int(meta.get("word_count") or len((transcript or "").split()))
    source_duration_seconds = float(meta.get("duration_seconds") or 0)
    source_wpm = float(meta.get("words_per_minute") or 0)
    duration_targets = _resolve_duration_targets(
        source_duration_seconds=source_duration_seconds,
        source_wpm=source_wpm,
        target_duration_seconds=target_duration_seconds,
        target_duration_min_seconds=target_duration_min_seconds,
        target_duration_max_seconds=target_duration_max_seconds,
        voice_chars_per_minute=voice_chars_per_minute,
    )
    min_word_target = duration_targets["min_word_target"]
    max_word_target = duration_targets["max_word_target"]
    min_char_target = duration_targets.get("min_char_target")
    max_char_target = duration_targets.get("max_char_target")
    duration_label = f"{source_duration_seconds:.1f} сек" if source_duration_seconds else "не определена"
    wpm_label = f"{source_wpm:.1f} слов/мин" if source_wpm else "не определен"
    desired_duration_label = duration_targets["duration_range_label"]
    voice_speed_label = (
        f"{duration_targets['voice_chars_per_minute']:.1f} симв/мин"
        if duration_targets.get("voice_chars_per_minute")
        else "не откалибрована"
    )
    char_target_line = (
        f"- Target character-count range (non-space): {min_char_target}-{max_char_target}\n"
        f"    - Active voice calibrated speed: {voice_speed_label}\n"
        "    - Character range is a priority length constraint for this voice.\n"
    ) if min_char_target and max_char_target else ""
    hook_context = _hook_context_from_transcript(transcript)
    hook_blueprint = _hook_blueprint(hook_context["opening"] or transcript)
    banned_hook_phrases = [phrase for phrase in HOOK_BAN_PHRASES if phrase not in hook_context["allowed_ban_phrases"]]

    prompt = f"""
    SYSTEM:
    You are a senior direct-response script doctor rewriting winning short-form scripts.
    Your job is NOT to invent a new concept and NOT to summarize.
    Your job is to create a close rewrite that preserves factual density, concrete detail, and watchability.

    CORE PRINCIPLE:
    If the source script is interesting because of specifics, numbers, places, proof, comparisons, and vivid details,
    your rewrite MUST remain specific, numeric, concrete, and vivid.
    If the source script is in a travel context, KEEP the travel context.
    The target product should act as the ENABLER of the trip, booking, payment, or travel action, not as a replacement for the place itself.
    You MAY introduce analogous facts and details beyond the source script, but only if they are widely known, plausible, and likely true.

    NON-NEGOTIABLE RULES:
    - Keep the SAME topic family and the SAME overall idea.
    - Keep almost the SAME structure, sentence rhythm, hook style, and order of arguments.
    - The first 1-2 sentences MUST preserve the hook mechanism and opening architecture of the source transcript.
    - The opening must feel like the same proven hook format as the source, not a generic replacement.
    - Keep the script length close to the original.
    - The rewritten script must stay within the target word-count band unless absolutely impossible.
    - Keep the same dramatic arc and CTA position.
    - Do NOT drift into a different format, different thesis, or different story.
    - Do NOT flatten the text into generic marketing language.
    - Do NOT replace concrete facts with vague phrases like "выгодно", "удобно", "особенное", "интересно", "качественно" unless a concrete proof follows immediately.
    - Do NOT invent fake evidence, fake testimonials, or generic "отзывы", unless the source script already had them.
    - Prefer facts that are stable and broadly known over niche or fragile claims.
    - If you are not confident in an exact number, use a softer but still informative formulation instead of inventing a precise number.
    - In travel-style scripts, the destination, route, booking, ticket, hotel, payment, or travel-planning context must remain the story world.
    - Do NOT turn a destination-led travel reel into an abstract fintech or service explainer.
    - The product should appear as the practical way to make the travel scenario possible: pay, book, reserve, subscribe, access, or complete the trip.
    - The product mention must feel like a lived recommendation, not an ad insert.
    - Avoid loud promo language like "забудьте о трудностях", "лучший сервис", "революция", "подписывайтесь и я открою".
    - Prefer natural first-person phrasing such as: "я там платил через...", "у меня всё прошло без проблем", "этим сервисом удобно оплачивать..." when appropriate.
    - Запрещены слова-паразиты и пустые вставки: {json.dumps(FILLER_WORDS_BAN, ensure_ascii=False)}.
    - The CTA must sound organic and low-pressure, like friendly advice or a personal tip.
    - Ignore ad integrations, affiliate inserts, Telegram channels, promo placements, and brand mentions from the source script unless they refer to the target product itself.
    - Do NOT carry over source creators, source channels, source calls to subscribe, or third-party promo lines into the rewrite.
    - Treat third-party promo fragments in the source as replaceable scaffolding, not as facts that must be preserved.
    - This is variation #{variation_index} out of {total_variations}. The wording can shift, but the script should still feel like the same winning reel.
    - Do NOT default to generic anti-pattern hooks or stock openers that were NOT present in the source.
    {_asset_visibility_guardrails()}
    {_spoken_numbers_guardrail()}
    {_forbidden_tags_guardrail()}

    GENDER AGREEMENT (FOR RUSSIAN LANGUAGE):
    - The narrator's gender is: {gender}.
    - Ensure all Russian verbs (past tense), adjectives, and pronouns match this gender.
    - Example for "{gender}": {"Я пошел/купил" if gender == "male" else "Я пошла/купила"}.

    HOOK PRESERVATION RULES:
    - Source opening sentence 1: {hook_context["first_sentence"] or "N/A"}
    - Source opening sentence 2: {hook_context["second_sentence"] or "N/A"}
    - Proven opening block to preserve structurally: {hook_context["opening"] or "N/A"}
    - Hook blueprint: {json.dumps(hook_blueprint, ensure_ascii=False)}
    - Preserve the source hook format: if the source starts with a statement, keep a statement. If it starts with a command, keep a command. If it starts with a list/countdown, keep a list/countdown. If it starts with a contrarian observation, keep a contrarian observation.
    - Do NOT replace the source opening with a lazy rhetorical-question template unless the source itself uses that exact mechanic.
    - The first sentence should stay in the same hook family and roughly the same length band as the source opening.
    - Reuse the same opening energy: if the source opens with a hard claim, your rewrite also opens with a hard claim; if it opens with a fast list setup, your rewrite also opens with a fast list setup.
    - Forbidden generic hook phrases unless they already existed in the source: {json.dumps(banned_hook_phrases, ensure_ascii=False)}

    FACT PRESERVATION RULES:
    - First identify all concrete informational units in the source:
      numbers, prices, counts, durations, comparisons, named places, named objects, proof points, vivid descriptors, list items, and CTA mechanics.
    - Preserve the DENSITY of information.
    - Preserve the ENUMERATION style. If the source lists several benefits or details, your rewrite must also list several concrete benefits or details.
    - Preserve NUMBERS whenever they can honestly stay.
    - If a number or detail cannot stay because it must be adapted to the target product, replace it with an equally concrete analogue, not with a vague statement.
    - Preserve contrast mechanics such as "not X, not Y, not Z".
    - Preserve object-level detail. If the source mentions bridge, ocean, duty free, lunch price, housing price, animals, your rewrite must also contain object-level specifics for the new context.
    - When introducing a new factual analogue, use only facts that are likely real and commonly known by an educated travel/content writer.
    - Avoid highly specific claims that are likely to be false, unstable, or fabricated.
    - When adapting to a product, preserve the destination facts and travel details, then connect the product to the moment of payment, booking, tickets, hotels, apps, subscriptions, reservations, or foreign spending.
    - Product integration should feel native: the viewer first wants the trip, then understands how the product helps make it happen.
    - Product integration should usually appear near the concrete friction point: payment abroad, booking accommodation, buying tickets, paying for services, or spending during the trip.
    - The product mention should resolve a real travel pain point that naturally follows from the script.
    - Preserve travel facts, but do NOT preserve source-specific advertising inserts such as "only through X channel", "subscribe to Y", "book via Z", unless X/Y/Z is the target product.

    REALISM RULES:
    - Write as if the script will be checked by a human who knows the topic.
    - Prefer "around", "often", "usually", "can be found", "in many cases" when an exact value may be unstable.
    - Keep the text vivid, but do not hallucinate exotic details just to sound impressive.
    - If you introduce a new country, island, city, or attraction, it must be a real place.
    - If you mention prices, durations, or weather, they should be plausible for the location and not obviously absurd.

    QUALITY BAR:
    - Every major claim should be supported by a concrete detail.
    - The final script must contain enough information to feel useful, not decorative.
    - The viewer should come away with memorable specifics, not only emotions.
    - The rewrite should sound like a high-retention reel, not a brand manifesto.

    SOURCE PACING CONSTRAINTS:
    - Source duration: {duration_label}
    - Desired target duration range: {desired_duration_label}
    - Source word count: {source_word_count}
    - Source speaking pace: {wpm_label}
    - Target word-count range: {min_word_target}-{max_word_target}
    {char_target_line}
    - Aim for the desired target duration while respecting the source speaking density.
    - If the rewrite becomes meaningfully longer than the target, compress it.

    PATTERN FRAMEWORK:
    - Pattern Type: {pattern.get('pattern_type', 'other')}
    - Narrator Role: {pattern.get('narrator_role', 'Личный рассказчик')}
    - Hook Style: {pattern.get('hook_style', 'Сохрани исходную механику захода')}
    - Core Thesis: {pattern.get('core_thesis', 'Сохрани основную мысль исходного сценария')}
    - Content Shape: {json.dumps(pattern.get('content_shape', {}), ensure_ascii=False)}
    - Argument Style: {pattern.get('argument_style', 'Сохрани логику движения аргументов')}
    - Integration Style: {json.dumps(pattern.get('integration_style', {}), ensure_ascii=False)}
    - Reusable Slots: {json.dumps(pattern.get('reusable_slots', {}), ensure_ascii=False)}
    - Forbidden Drifts: {json.dumps(pattern.get('forbidden_drifts', []), ensure_ascii=False)}

    REFERENCE STRATEGY:
    - Topic Cluster: {strategy.get('topic_cluster', niche)}
    - Topic Angle: {strategy.get('topic_angle', 'Сохрани исходный угол')}
    - Hook Type: {strategy.get('hook_type', 'Сохрани тип хука')}
    - Promise: {strategy.get('promise', 'Сохрани обещание зрителю')}
    - Pain Point: {strategy.get('pain_point', 'Сохрани боль/барьер')}
    - Proof Type: {strategy.get('proof_type', 'Сохрани тип доказательства')}
    - CTA Type: {strategy.get('cta_type', 'Сохрани тип CTA')}

    DESTINATION VARIATION:
    - Requested destination/country hint: {destination_context}
    - If a destination hint is provided, keep the SAME pattern and tone, but rebuild the script around that real destination.
    - When switching destination, preserve the same storytelling engine while replacing the place-specific details with plausible equivalents.

    TARGET PRODUCT / OFFER:
    {product_context}

    BRAND VOICE:
    {voice_context}

    TARGET AUDIENCE:
    {audience_context}

    SOURCE SCRIPT:
    \"\"\"{transcript}\"\"\"

    TASK:
    1. Internally extract the factual building blocks of the source script.
    2. Internally preserve the extracted PATTERN FRAMEWORK, not just the surface wording.
    3. Rewrite the script in Russian as a close variation.
    4. Preserve the original hook logic, sequence, emotional progression, factual density, and CTA placement.
    4a. The first 1-2 sentences must mirror the source opening architecture and should not collapse into a generic "Думаешь/А вот и нет/Забудь" opener unless the source truly did that.
    4b. The first sentence must preserve the same hook shape as the blueprint above and should feel recognizably derived from the source opening mechanism.
    5. Preserve the detected `pattern_type` and its content shape.
    6. If the pattern is `top_list`, keep it list-like. If it is `route_story`, keep route progression. If it is `comparison`, keep comparison logic. If it is `opinion_take`, keep the contrarian stance. If it is `mistakes`, keep the warning structure.
    7. If a destination hint is provided, relocate the script to that destination while keeping the same narrative engine and factual density.
    8. If the source is travel-led, keep the place, trip, and destination as the main narrative object.
    9. Adapt the product as the enabler of the travel action: paying, booking, reserving, accessing, or making the trip possible from the viewer's situation.
    10. Write all numbers only in spoken Russian words, never as digits.
    11. Make the script interesting because it contains information, comparisons, and proof, not empty adjectives.
    12. When adding new facts, choose likely-true, real-world details instead of fabricated ones.
    13. Write the product mention as a native recommendation from someone who actually used it in this scenario.
    14. End with a natural CTA: soft recommendation, friendly prompt, or conversational invitation, not a hard sell.
    15. Remove source-side ad integrations and rebuild that slot naturally around the target product only if it fits the scene.

    SELF-CHECK BEFORE FINALIZING:
    - Is the script still realistically speakable within roughly the same duration?
    - Did I keep the word count close to the source target band?
    - Did I keep the number of concrete facts high?
    - Did I keep list-like sections list-like?
    - Did I preserve or replace numbers with equally concrete numbers?
    - Did I avoid vague filler and fake proof?
    - Are the added facts plausible and likely real?
    - Did I avoid suspiciously precise or invented claims?
    - Did I rewrite every number, date, range, price, and percentage as spoken Russian words?
    - If this is a travel script, did I keep travel as the story and make the product the helper, not the replacement?
    - Does the product line sound like a human recommendation from experience, not like an inserted ad slogan?
    - Is the CTA soft, natural, and conversational?
    - Did I remove the source author's ads, channels, affiliate mentions, and чужие promo lines?
    - Did I preserve the detected pattern_type and not accidentally turn a list into a story, or a story into a generic explainer?
    - Does the rewrite feel almost as rich and watchable as the source?
    - Did I avoid demonstrative references to unseen websites, apps, or products like "вот эти сайты" or "первый сайт"?

    {('CLIENT-SPECIFIC LEARNED RULES (from feedback analysis — FOLLOW STRICTLY):' + chr(10) + '    ' + (learned_rules_scenario or '').strip()) if learned_rules_scenario and learned_rules_scenario.strip() else ''}

    RETURN JSON:
    {{
        "scene_name": "Short title",
        "script": "Close rewritten script in Russian",
        "rewrite_type": "close_rewrite",
        "pattern_type": "{pattern.get('pattern_type', 'other')}",
        "source_duration_seconds": {source_duration_seconds or 0},
        "source_word_count": {source_word_count},
        "source_words_per_minute": {source_wpm or 0},
        "target_duration_range_seconds": "{desired_duration_label}",
        "target_word_count_range": "{min_word_target}-{max_word_target}",
        "target_character_count_range": "{f'{min_char_target}-{max_char_target}' if min_char_target and max_char_target else 'not_set'}",
        "preserved_fact_units": ["List 5-10 concrete fact units preserved or concretely adapted"],
        "pattern_preservation_notes": "How the underlying pattern and slot structure were preserved",
        "hook_preservation_notes": "How the source hook format and first 1-2 sentences were preserved structurally",
        "rewrite_notes": "What details were changed and what structure was preserved",
        "similarity_notes": "Why this still feels very close to the source",
        "product_integration_notes": "How the product was woven in naturally"
    }}
    """

    try:
        return _chat_json(prompt)
    except Exception as e:
        logger.error(f"Failed to rewrite reference script: {e}")
        return {
            "script": "Error rewriting script",
            "rewrite_type": "close_rewrite"
        }

def generate_scenario(audit_json, niche="General", target_product_info=None, brand_voice=None, target_audience=None, transcript_meta=None, target_duration_seconds=None, target_duration_min_seconds=None, target_duration_max_seconds=None, learned_rules_scenario=None, gender="female", voice_chars_per_minute=None):
    """
    Generates a NEW scenario by "Mirroring" the viral DNA of the source video 
    into a script for the target product.
    """
    gender = normalize_narrator_gender(gender)
    atoms = audit_json.get("atoms", {})
    strategy = audit_json.get("reference_strategy", {})
    hunt = audit_json.get("hunt_ladder", {})
    viral_dna = audit_json.get("viral_dna_synthesis", "Виральный потенциал")
    
    product_context = target_product_info or f"Сервис в нише: {niche}"
    voice_context = brand_voice or "Естественный, разговорный, без канцелярита"
    audience_context = target_audience or "Люди, которым важны быстрые и понятные решения"

    # РАСЧЕТ ОГРАНИЧЕНИЙ ПО ДЛИНЕ
    meta = transcript_meta or audit_json.get("transcript_meta", {})
    source_word_count = int(meta.get("word_count") or 0)
    source_duration = float(meta.get("duration_seconds") or 0)
    
    duration_targets = _resolve_duration_targets(
        source_duration_seconds=source_duration,
        source_wpm=meta.get("words_per_minute"),
        target_duration_seconds=target_duration_seconds,
        target_duration_min_seconds=target_duration_min_seconds,
        target_duration_max_seconds=target_duration_max_seconds,
        voice_chars_per_minute=voice_chars_per_minute,
    )
    word_min = max(duration_targets["min_word_target"], 30)
    word_max = max(duration_targets["max_word_target"], 60)
    min_char_target = duration_targets.get("min_char_target")
    max_char_target = duration_targets.get("max_char_target")
    voice_speed_label = (
        f"{duration_targets['voice_chars_per_minute']:.1f} симв/мин"
        if duration_targets.get("voice_chars_per_minute")
        else "не откалибрована"
    )
    char_target_hint = (
        f"- Целевой диапазон символов (без пробелов): {min_char_target}-{max_char_target}. "
        f"Скорость активного голоса: {voice_speed_label}."
    ) if min_char_target and max_char_target else ""
    duration_label = f"{source_duration:.1f} сек" if source_duration else "неизвестна"
    desired_duration_label = duration_targets["duration_range_label"]
    source_hook = atoms.get("verbal_hook") or ""
    normalized_source_hook = source_hook.lower().replace("ё", "е")
    hook_blueprint = _hook_blueprint(source_hook)
    banned_hook_phrases = [phrase for phrase in HOOK_BAN_PHRASES if phrase not in normalized_source_hook]

    prompt = f"""
    SYSTEM: Вы — мастер виральной архитектуры и топовый сценарист вертикальных видео (Reels/Shorts).
    Ваша задача — выполнить «Атомное Зеркалирование»: перенести ДНК успешного референса на целевой продукт (Target Product).

    СТРОГОЕ ОГРАНИЧЕНИЕ: Сценарий пишется для Говорящей Головы (Talking Head). 
    - НИКАКИХ визуальных инструкций ("покажите", "скриншот").
    - Текст должен быть самодостаточным. Каждая мысль должна быть ПРОГОВОРЕНА.

    АНАЛИЗ РЕФЕРЕНСА (Viral DNA):
    - Стадия осознанности (Лестница Ханта): {hunt.get('stage')} (Причина: {hunt.get('reason')})
    - Главный секрет успеха: {viral_dna}
    - Хук: {atoms.get('verbal_hook')} (Механика: {atoms.get('psychological_trigger')})
    - Hook blueprint: {json.dumps(hook_blueprint, ensure_ascii=False)}
    - Скелет (Смысловые блоки): {json.dumps(atoms.get('narrative_skeleton'), ensure_ascii=False)}
    - Точки напряжения (Враг/Миф): {json.dumps(atoms.get('tension_points'), ensure_ascii=False)}
    - Призыв (CTA): {atoms.get('cta_mechanism')}
    - Стиль речи (Linguistic Fingerprint): {json.dumps(atoms.get('linguistic_fingerprint'), ensure_ascii=False)}

    ОГРАНИЧЕНИЯ ПО ДЛИНЕ:
    - Длительность оригинала: {duration_label}
    - Желаемая длительность финального сценария: {desired_duration_label}
    - Целевое количество слов: {word_min} - {word_max} слов. 
    {char_target_hint}
    [ВАЖНО] Подгоняйте итоговый сценарий под желаемую длительность финального видео.

    ЦЕЛЕВОЙ КОНТЕКСТ (Target Product):
    - Продукт: {product_context}
    - Тон бренда: {voice_context}
    - Аудитория: {audience_context}

    ИНСТРУКЦИЯ ПО ГЕНЕРАЦИИ:
    1. **Villain Swap (Подмена Врага)**: Определите, против какого "Врага" (мифа, ошибки, старого метода) выступает референс. Найдите АНАЛОГИЧНОГО Врага для нашего продукта и постройте конфликт вокруг него.
    2. **Expertise Injection (Инъекция экспертности)**: В оригинале есть слоты для конкретных деталей (цифры, факты, внутрянка). Заполните их РЕАЛЬНЫМИ и жесткими фактами о нашем продукте. Избегайте "удобно и быстро".
    3. **Mirror the Hook**: Создайте хук с ТОЙ ЖЕ психологической механикой и тем же форматом захода, что и у референса, но на тему нашего продукта.
    3a. Если референс начинает ролик не вопросом, не превращайте начало в вопрос.
    3b. Не использовать штампы {json.dumps(banned_hook_phrases, ensure_ascii=False)} если их нет в хукe референса.
    3c. Первое предложение должно сохранить тот же hook shape, длину захода и ощущение "той же механики", а не просто ту же тему.
    4. **Curiosity Gap**: Сохраните тот же открытый вопрос в начале, ответ на который зритель получит только в конце.
    5. **Hunt Ladder Alignment**: 
       - Если стадия "Неосведомлен" — давите на боль и проблему.
       - Если стадия "Осознает продукт" — делайте упор на экспертные детали и сравнение.
    6. **Human Touch**: Используйте маркеры живой речи из Linguistic Fingerprint оригинала (связки, обращения, темп).
    7. Не используйте указательные формулировки для внешних сайтов, приложений и товаров, которые зритель не увидит в кадре: нельзя "вот эти сайты", "первый сайт", "вот этот крем". Говорите только обобщенно: "есть сервис", "одна платформа", "несколько сайтов", "средство от комаров".
    8. Запрещены слова-паразиты и пустые вставки: {json.dumps(FILLER_WORDS_BAN, ensure_ascii=False)}.
    9. ГРАММАТИЧЕСКОЕ СОГЛАСОВАНИЕ: Пол диктора — {gender}. В русском языке обязательно используй соответствующие формы (например, {"я сделал" if gender == "male" else "я сделала"}).
    10. Все числа, даты, диапазоны, проценты, суммы и годы в итоговом сценарии пишите только словами, без арабских цифр.

    ВЕРНИТЕ JSON:
    {{
        "scene_name": "Название сценария",
        "script": "Полный текст на русском для аватара",
        "word_count": 0,
        "hook_preservation_notes": "Как сохранен формат хука референса",
        "strategy_notes": "Как вы адаптировали Врага и Инъекцию Экспертности"
    }}

    {('CLIENT-SPECIFIC LEARNED RULES (from feedback analysis — FOLLOW STRICTLY):' + chr(10) + '    ' + (learned_rules_scenario or '').strip()) if learned_rules_scenario and learned_rules_scenario.strip() else ''}
    """
    
    try:
        return _chat_json(prompt)
    except Exception as e:
        logger.error(f"Failed to generate scenario: {e}")
        return {
            "script": "Error generating script"
        }

def generate_clustered_scenario(reference_audits, niche="General", target_product_info=None, topic=None, angle=None, variation_index=1, total_variations=1, brand_voice=None, target_audience=None, target_duration_seconds=None, target_duration_min_seconds=None, target_duration_max_seconds=None, learned_rules_scenario=None, gender="female", voice_chars_per_minute=None):
    """
    Generates a scenario from a cluster of similar references instead of a single audit.
    This keeps the resulting script much closer to a chosen topic and angle.
    """
    gender = normalize_narrator_gender(gender)
    if not reference_audits:
        raise ValueError("reference_audits must contain at least one audit")

    product_context = target_product_info or f"Сервис в нише: {niche}"
    voice_context = brand_voice or "Естественный, разговорный, без канцелярита"
    audience_context = target_audience or "Люди, которым важны быстрые и понятные решения"
    duration_targets = _resolve_duration_targets(
        source_duration_seconds=None,
        source_wpm=150,
        target_duration_seconds=target_duration_seconds,
        target_duration_min_seconds=target_duration_min_seconds,
        target_duration_max_seconds=target_duration_max_seconds,
        voice_chars_per_minute=voice_chars_per_minute,
    )
    word_min = max(duration_targets["min_word_target"], 30)
    word_max = max(duration_targets["max_word_target"], 60)
    min_char_target = duration_targets.get("min_char_target")
    max_char_target = duration_targets.get("max_char_target")
    voice_speed_label = (
        f"{duration_targets['voice_chars_per_minute']:.1f} симв/мин"
        if duration_targets.get("voice_chars_per_minute")
        else "не откалибрована"
    )
    char_target_hint = (
        f"- Целевой диапазон символов (без пробелов): {min_char_target}-{max_char_target} "
        f"(скорость голоса: {voice_speed_label})"
    ) if min_char_target and max_char_target else ""
    normalized_references = []
    for idx, audit in enumerate(reference_audits, start=1):
        atoms = audit.get("atoms", {})
        strategy = audit.get("reference_strategy", {})
        normalized_references.append({
            "reference_number": idx,
            "topic_cluster": strategy.get("topic_cluster"),
            "topic_angle": strategy.get("topic_angle"),
            "hook_type": strategy.get("hook_type"),
            "promise": strategy.get("promise"),
            "pain_point": strategy.get("pain_point"),
            "proof_type": strategy.get("proof_type"),
            "cta_type": strategy.get("cta_type"),
            "constraints": strategy.get("content_constraints", []),
            "hook": atoms.get("verbal_hook"),
            "trigger": atoms.get("psychological_trigger"),
            "skeleton": atoms.get("narrative_skeleton"),
            "tension_points": atoms.get("tension_points"),
            "pacing": atoms.get("pacing_cadence"),
            "cta_logic": atoms.get("cta_mechanism"),
            "linguistic_fingerprint": atoms.get("linguistic_fingerprint"),
        })

    reference_openings = [
        {
            "reference_number": item.get("reference_number"),
            "hook": item.get("hook"),
            "trigger": item.get("trigger"),
            "blueprint": _hook_blueprint(item.get("hook") or ""),
        }
        for item in normalized_references[:6]
        if item.get("hook")
    ]
    reference_hook_text = " ".join(item.get("hook") or "" for item in normalized_references[:3] if item.get("hook"))
    hook_context = _hook_context_from_transcript(reference_hook_text)
    banned_hook_phrases = [phrase for phrase in HOOK_BAN_PHRASES if phrase not in hook_context["allowed_ban_phrases"]]

    target_topic = topic or normalized_references[0].get("topic_cluster") or niche
    target_angle = angle or normalized_references[0].get("topic_angle") or "Сохрани исходный угол подачи"

    prompt = f"""
    SYSTEM: Вы — ведущий архитектор контентных систем. Ваша задача — создать НОВЫЙ сценарий на основе кластера успешных референсов.
    Нужно синтезировать лучшее из всех примеров и применить это к нашему продукту (Target Product).

    СТРОГОЕ ОГРАНИЧЕНИЕ: Текст пишется для Говорящей Головы (AI Talking Head). 
    Никакого монтажа, титров или визуальных эффектов в описании. Всё должно быть сказано словами.

    КЛАСТЕР УСПЕХА:
    {json.dumps(normalized_references, ensure_ascii=False, indent=2)}

    ЦЕЛЕВОЙ ТЕМАТИЧЕСКИЙ ВЕКТОР:
    - Ниша: {niche}
    - Топик: {target_topic}
    - Угол подачи: {target_angle}

    ЦЕЛЕВОЙ КОНТЕКСТ (Target Product):
    - Продукт: {product_context}
    - Тон бренда: {voice_context}
    - Аудитория: {audience_context}
    - Желаемая длительность: {duration_targets["duration_range_label"]}
    - Целевой диапазон слов: {word_min}-{word_max}
    {char_target_hint}

    ЗАДАЧА:
    1. Выделите ОБЩИЙ ПАТТЕРН всех референсов (общий тип хука, структура аргументации, тип финала).
    2. Создайте новый сценарий, который звучит как идеальное продолжение этой библиотеки.
    3. **Mirror the Core DNA**: Используйте общие механизмы удержания из кластера, но переложите их на факты о нашем продукте.
    4. **Density Control**: Сохраняйте высокую плотность полезной информации (цифры, сравнения), как в лучших референсах.
    5. **Hook Fidelity**: Первые 1-2 предложения должны опираться на реальные opening hooks кластера, а не на универсальный шаблон модели.
    6. Если референсы открываются утверждением-наблюдением, открывайтесь утверждением-наблюдением. Если они открываются списком, открывайтесь списком. Если они открываются прямым советом/командой, сохраняйте эту механику.
    6a. Внутренне определи доминирующий hook shape кластера и сохрани его в первом предложении нового сценария.
    7. Не использовать штампы "Думаешь...", "Думаете...", "А вот и нет!", "Забудьте!", "Прикол в том, что..." если таких открытий нет среди исходных референсов.
    7a. Запрещены слова-паразиты и пустые вставки: {json.dumps(FILLER_WORDS_BAN, ensure_ascii=False)}.
    8. Все числа, даты, диапазоны, проценты, суммы и годы в итоговом сценарии пишите только словами, без арабских цифр.
    9. Вариация №{variation_index} из {total_variations}.
    10. Не используйте указательные формулировки для неподготовленных внешних сайтов, приложений и товаров: нельзя "вот эти сайты", "первый сайт", "второй сайт", "вот этот спрей". Если нужно упомянуть ресурс или предмет, описывайте его обобщенно и без визуального указания.
    11. ГРАММАТИЧЕСКОЕ СОГЛАСОВАНИЕ: Пол диктора — {gender}. В русском языке обязательно используй соответствующие формы (например, {"я сделал" if gender == "male" else "я сделала"}).

    OPENING REFERENCES TO FOLLOW STRUCTURALLY:
    {json.dumps(reference_openings, ensure_ascii=False, indent=2)}

    ВЕРНИТЕ JSON:
    {{
        "scene_name": "Название сценария",
        "script": "Текст на русском",
        "topic_cluster": "{target_topic}",
        "topic_angle": "{target_angle}",
        "hook_preservation_notes": "Как вы сохранили формат хука из кластера",
        "cluster_alignment_notes": "Как вы синтезировали опыт всех роликов"
    }}

    {('CLIENT-SPECIFIC LEARNED RULES (from feedback analysis — FOLLOW STRICTLY):' + chr(10) + '    ' + (learned_rules_scenario or '').strip()) if learned_rules_scenario and learned_rules_scenario.strip() else ''}
    """

    try:
        return _chat_json(prompt)
    except Exception as e:
        logger.error(f"Failed to generate clustered scenario: {e}")
        return {
            "script": "Error generating clustered script",
            "topic_cluster": target_topic,
            "topic_angle": target_angle
        }

def generate_from_topic_and_structure(topic_card, structure_card, niche="General", target_product_info=None, brand_voice=None, target_audience=None, variation_index=1, total_variations=1, target_duration_seconds=None, target_duration_min_seconds=None, target_duration_max_seconds=None, learned_rules_scenario=None, gender="female", voice_chars_per_minute=None):
    """
    Generates a new scenario by combining a reusable topic card and a reusable structure card.
    """
    gender = normalize_narrator_gender(gender)
    product_context = target_product_info or f"Сервис в нише: {niche}"
    voice_context = brand_voice or "Естественный, разговорный, уверенный"
    audience_context = target_audience or "Люди, которым важно удобно путешествовать и платить за границей"
    duration_targets = _resolve_duration_targets(
        source_duration_seconds=None,
        source_wpm=150,
        target_duration_seconds=target_duration_seconds,
        target_duration_min_seconds=target_duration_min_seconds,
        target_duration_max_seconds=target_duration_max_seconds,
        voice_chars_per_minute=voice_chars_per_minute,
    )
    word_min = max(duration_targets["min_word_target"], 30)
    word_max = max(duration_targets["max_word_target"], 60)
    min_char_target = duration_targets.get("min_char_target")
    max_char_target = duration_targets.get("max_char_target")
    voice_speed_label = (
        f"{duration_targets['voice_chars_per_minute']:.1f} симв/мин"
        if duration_targets.get("voice_chars_per_minute")
        else "не откалибрована"
    )
    char_target_hint = (
        f"- Requested character-count range: {min_char_target}-{max_char_target} (non-space, voice speed {voice_speed_label})"
    ) if min_char_target and max_char_target else ""
    hook_context = _hook_context_from_source_cards(topic_card=topic_card, structure_card=structure_card)
    banned_hook_phrases = [phrase for phrase in HOOK_BAN_PHRASES if phrase not in hook_context["allowed_ban_phrases"]]

    topic_meta = topic_card.get("metadata_json", {})
    if isinstance(topic_meta, str):
        try:
            topic_meta = json.loads(topic_meta)
        except json.JSONDecodeError:
            topic_meta = {}

    structure_card_normalized = {
        "pattern_type": structure_card.get("pattern_type"),
        "narrator_role": structure_card.get("narrator_role"),
        "hook_style": structure_card.get("hook_style"),
        "core_thesis": structure_card.get("core_thesis"),
        "format_type": structure_card.get("format_type"),
        "item_count": structure_card.get("item_count"),
        "sequence_logic": structure_card.get("sequence_logic"),
        "integration_style": structure_card.get("integration_style"),
        "reusable_slots": structure_card.get("reusable_slots"),
        "forbidden_drifts": structure_card.get("forbidden_drifts"),
    }

    prompt = f"""
    SYSTEM:
    You are a senior vertical video script architect specializing in high-retention Reels and Shorts.
    Your task is to generate a NEW script by combining a modular TOPIC card and a modular STRUCTURE card.

    CORE CONSTRAINTS (NON-NEGOTIABLE):
    1. BREVITY: The script MUST stay inside the requested word-count range. No more, no less.
    2. NO HELLOS: Start DIRECTLY with the hook. No "Привет всем", "Всем привет", "Привет, друзья", or any other introductory filler.
    3. VIRAL HOOK: The first 1-2 sentences must follow the proven opening architecture of the reference behind these cards, not a generic LLM hook.
    4. FACTUAL DENSITY: Avoid vague adjectives like "удобно", "быстро", "выгодно". Replace them with concrete numbers, names, or proof points.
    5. NATURAL VOICE: Write for a human "Talking Head". Use natural connectors without filler words. Do NOT use слова-паразиты: {json.dumps(FILLER_WORDS_BAN, ensure_ascii=False)}.
    6. PRODUCT INTEGRATION: Woven the product naturally as the "Enabler". It shouldn't feel like a mid-roll ad, it should be the logical solution to the pain point mentioned.
    7. Avoid repetitive stock openers if they were not present in the source hook. Forbidden phrases unless present in the source opening: {json.dumps(banned_hook_phrases, ensure_ascii=False)}
    8. Do NOT use demonstrative references to third-party sites, apps, or consumer products that the viewer cannot literally see on screen. Forbidden examples: "вот эти сайты", "первый сайт", "вот этот крем". Use generic wording instead: "есть сервис", "одна платформа", "несколько сайтов", "крем с высоким SPF".
    9. ГРАММАТИЧЕСКОЕ СОГЛАСОВАНИЕ: Пол диктора — {gender}. В русском языке обязательно используй соответствующие формы (например, {"я сделал" if gender == "male" else "я сделала"}).
    10. All numbers in the final Russian script must be written as words, never as digits.

    TOPIC CARD (The "What"):
    {json.dumps(topic_meta or topic_card, ensure_ascii=False, indent=2)}

    STRUCTURE CARD (The "How"):
    {json.dumps(structure_card_normalized, ensure_ascii=False, indent=2)}

    SOURCE HOOK TO PRESERVE STRUCTURALLY:
    - Opening sentence 1: {hook_context["first_sentence"] or "N/A"}
    - Opening sentence 2: {hook_context["second_sentence"] or "N/A"}
    - Proven opening block: {hook_context["opening"] or "N/A"}
    - Hook blueprint: {json.dumps(_hook_blueprint(hook_context["opening"] or ""), ensure_ascii=False)}

    TARGET PRODUCT:
    {product_context}

    BRAND VOICE:
    {voice_context}

    TARGET AUDIENCE:
    {audience_context}

    LENGTH TARGET:
    - Desired target duration: {duration_targets["duration_range_label"]}
    - Requested word-count range: {word_min}-{word_max} слов
    {char_target_hint}

    TASK:
    1. Identify the CORE THESIS from the Structure Card.
    2. Apply the TOPIC from the Topic Card to that thesis.
    3. Generate a {word_min}-{word_max} word script in Russian.
    4. Ensure the hook matches the `hook_style` from the Structure Card and also preserves the real opening format from the source hook above.
    4a. The first sentence should preserve the same hook family as the source blueprint: question stays question, list stays list, direct statement stays direct statement.
    5. Ensure the product integration matches the `integration_style` but feels organic.
    6. Convert every number, date, year, range, percentage, and amount into natural spoken Russian words.

    RETURN JSON:
    {{
        "scene_name": "Short title",
        "script": "Complete Russian script in the requested length range",
        "word_count": "integer count of words",
        "generation_mode": "topic_structure_mix",
        "pattern_type": "{structure_card.get('pattern_type', 'other')}",
        "topic_family": "{topic_card.get('topic_family', topic_card.get('canonical_topic_family', 'general_travel_topic'))}",
        "topic_cluster": "{topic_card.get('topic_short', topic_card.get('topic_cluster', 'Без темы'))}",
        "topic_short": "{topic_card.get('topic_short', topic_card.get('topic_cluster', 'Без темы'))}",
        "topic_angle": "{topic_card.get('topic_angle', 'Без угла')}",
        "hook_preservation_notes": "How the real source hook format was preserved",
        "quality_check": {{
            "no_hello_check": "Boolean: did you avoid 'Привет'?",
            "word_count_check": "Boolean: is it inside the requested word-count range?",
            "hook_type": "Brief description of the hook logic"
        }}
    }}

    {('CLIENT-SPECIFIC LEARNED RULES (from feedback analysis — FOLLOW STRICTLY):' + chr(10) + '    ' + (learned_rules_scenario or '').strip()) if learned_rules_scenario and learned_rules_scenario.strip() else ''}
    """

    try:
        return _chat_json(prompt)
    except Exception as e:
        logger.error(f"Failed to generate from topic and structure: {e}")
        return {
            "script": "Error generating from topic and structure",
            "generation_mode": "topic_structure_mix",
            "pattern_type": structure_card.get("pattern_type", "other"),
            "topic_family": topic_card.get("topic_family", topic_card.get("canonical_topic_family", "general_travel_topic")),
            "topic_short": topic_card.get("topic_short", topic_card.get("topic_cluster", "Без темы")),
        }


def fit_script_to_character_budget(
    script: str,
    target_min_chars: int,
    target_max_chars: int,
    *,
    gender: str = "female",
    attempt_index: int = 1,
    total_attempts: int = 1,
) -> str:
    source_script = re.sub(r"\s+", " ", str(script or "")).strip()
    if not source_script:
        return source_script

    min_chars = max(int(target_min_chars or 1), 1)
    max_chars = max(int(target_max_chars or min_chars), min_chars)
    if min_chars == max_chars:
        min_chars = max(1, min_chars - 2)
        max_chars = max(min_chars, max_chars + 2)

    source_char_count = count_spoken_characters(source_script)
    gender = normalize_narrator_gender(gender)

    prompt = f"""
    SYSTEM:
    You are a Russian script editor for talking-head videos.
    Keep meaning, structure, persuasion, and natural flow, but fit strict character limits.

    HARD RULES:
    - Return strict JSON only.
    - Keep the same language (Russian).
    - Preserve core facts and CTA intent.
    - Do not add visual directions.
    - Keep grammar agreement for narrator gender: {gender}.
    - Character count metric is NON-WHITESPACE characters.
    - The rewritten script MUST be between {min_chars} and {max_chars} non-whitespace characters.
    - This is duration-fit attempt {attempt_index} of {total_attempts}.

    SOURCE SCRIPT (non-whitespace chars: {source_char_count}):
    \"\"\"{source_script}\"\"\"

    RETURN JSON:
    {{
      "script": "Rewritten script",
      "non_whitespace_char_count": 0,
      "fit_notes": "How length was adjusted while preserving meaning"
    }}
    """

    try:
        payload = _chat_json(prompt)
    except Exception as error:
        logger.error("Failed to fit script to character budget: %s", error)
        return source_script

    candidate = re.sub(r"\s+", " ", str((payload or {}).get("script") or "")).strip()
    if not candidate:
        return source_script

    candidate_chars = count_spoken_characters(candidate)
    if candidate_chars < min_chars or candidate_chars > max_chars:
        logger.warning(
            "Character-budget rewrite missed target: got=%s target=%s-%s",
            candidate_chars,
            min_chars,
            max_chars,
        )
    return candidate


def prepare_for_tts(script: str) -> str:
    """
    Prepares the script for MiniMax TTS with clean pronunciation-oriented markup.
    """
    if not script:
        return ""

    prompt = f"""
    SYSTEM:
    You are an expert Russian linguist and TTS prosody specialist.
    Your task is to take a Russian video script and prepare ONLY the text so a TTS engine pronounces it as naturally and correctly as possible.

    GOAL:
    - Improve pronunciation, stress, readability, and spoken flow.
    - Do NOT add unsupported TTS control tags or stage directions.

    HARD RULES:
    - Keep the output as plain spoken Russian text.
    - Do NOT add pause markers like <#0.3#>, <#0.8#>, or any other XML-like tags.
    - Do NOT add emotional/stage tags like [surprise], [whisper], (laughs), etc.
    - Do NOT add markdown, comments, explanations, or quotes around the whole result.
    - Preserve the meaning and persuasive structure of the source script.

    PRONUNCIATION RULES:
    - Do NOT use '+' or any other inline stress marker characters in the output.
    - Improve pronunciation without special markup by rewriting locally ambiguous words or phrasing when helpful.
    - Prefer restoring the letter 'ё' where it is clearly required for correct pronunciation.
    - ALL digits must be rewritten as full Russian words. Do not leave any Arabic numerals in the output.
    - Rewrite percentages, currencies, ranges, years, dates, and counts into natural spoken Russian.
    - Expand abbreviations and hard-to-read symbols into natural spoken Russian where helpful.
    - Make brand and product names easier to pronounce if needed, but keep them recognizable.

    TEXT CLEANUP RULES:
    - Normalize punctuation for speech.
    - Break overly dense written phrasing into more speakable syntax without changing meaning.
    - Keep the result concise and suitable for spoken audio.

    OUTPUT:
    Return ONLY the processed text.

    SCRIPT TO PROCESS:
    \"\"\"{script}\"\"\"
    """
    
    try:
        processed = _chat_text(prompt)
        # Clean up any potential markdown or garbage
        if processed.startswith("```"):
            processed = processed.split("\n", 1)[-1].rsplit("\n", 1)[0].strip()
        return processed
    except Exception as e:
        logger.error(f"Failed to prepare script for TTS: {e}")
        return script
