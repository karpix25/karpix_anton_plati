# Copyright (c) 2025 Stephen G. Pope
#
# Audit Service: Analyzes transcripts to extract viral triggers.
#

import os
import json
import logging
from openai import OpenAI

# Set up logging
logger = logging.getLogger(__name__)

HUNT_STAGE_ALIASES = {
    "неосведомлен": "Неосведомлен",
    "не осведомлен": "Неосведомлен",
    "не осознает проблему": "Неосведомлен",
    "осознает проблему": "Осознает проблему",
    "знает о проблеме": "Осознает проблему",
    "осознает решение": "Осознает решение",
    "знает о решении": "Осознает решение",
    "сравнивает решения": "Осознает продукт",
    "осознает продукт": "Осознает продукт",
    "знает продукт": "Осознает продукт",
    "готов к покупке": "Готов к покупке",
    "готов купить": "Готов к покупке",
}

PLACEHOLDER_PREFIXES = (
    "не определ",
    "не указан",
    "не указана",
    "не указано",
    "undefined",
    "none",
    "null",
    "нет данных",
    "без данных",
)

DEFAULT_HUNT_STAGE = "Осознает проблему"

HUNT_STAGE_CANONICAL = {
    "неосведомлен": "Неосведомлен",
    "осознает проблему": "Осознает проблему",
    "осознает решение": "Осознает решение",
    "осознает продукт": "Осознает продукт",
    "готов к покупке": "Готов к покупке",
}

def _normalize_text(value):
    if value is None:
        return ""
    return str(value).strip().lower().replace("ё", "е")

def _is_placeholder(value):
    text = _normalize_text(value)
    if not text:
        return True
    return any(text.startswith(prefix) for prefix in PLACEHOLDER_PREFIXES)

def _clean_text(value):
    if _is_placeholder(value):
        return None
    return str(value).strip()

def _normalize_hunt_stage(value):
    raw = _normalize_text(value)
    if not raw or _is_placeholder(raw):
        return DEFAULT_HUNT_STAGE
    if raw in HUNT_STAGE_ALIASES:
        return HUNT_STAGE_ALIASES[raw]
    if raw in HUNT_STAGE_CANONICAL:
        return HUNT_STAGE_CANONICAL[raw]
    return DEFAULT_HUNT_STAGE

def _sanitize_reference_strategy(strategy, fallback_topic):
    strategy = strategy or {}
    topic_cluster = _clean_text(strategy.get("topic_cluster")) or fallback_topic
    topic_family = _clean_text(strategy.get("topic_family")) or topic_cluster or fallback_topic
    topic_angle = _clean_text(strategy.get("topic_angle"))
    promise = _clean_text(strategy.get("promise"))
    pain_point = _clean_text(strategy.get("pain_point"))
    proof_type = _clean_text(strategy.get("proof_type"))
    cta_type = _clean_text(strategy.get("cta_type"))

    return {
        **strategy,
        "topic_cluster": topic_cluster,
        "topic_family": topic_family,
        "topic_angle": topic_angle,
        "promise": promise,
        "pain_point": pain_point,
        "proof_type": proof_type,
        "cta_type": cta_type,
    }

def _sanitize_pattern_framework(pattern, fallback_topic):
    pattern = pattern or {}
    pattern_type = _clean_text(pattern.get("pattern_type")) or "other"
    core_thesis = _clean_text(pattern.get("core_thesis")) or fallback_topic
    narrator_role = _clean_text(pattern.get("narrator_role"))
    hook_style = _clean_text(pattern.get("hook_style"))
    content_shape = pattern.get("content_shape") or {}
    format_type = _clean_text(content_shape.get("format_type")) or pattern_type

    return {
        **pattern,
        "pattern_type": pattern_type,
        "core_thesis": core_thesis,
        "narrator_role": narrator_role,
        "hook_style": hook_style,
        "content_shape": {**content_shape, "format_type": format_type},
    }

def _sanitize_audit_payload(payload, niche):
    payload = payload or {}
    strategy = _sanitize_reference_strategy(payload.get("reference_strategy"), fallback_topic=niche)
    fallback_topic = strategy.get("topic_cluster") or strategy.get("topic_family") or niche
    payload["reference_strategy"] = strategy
    payload["pattern_framework"] = _sanitize_pattern_framework(payload.get("pattern_framework"), fallback_topic=fallback_topic)
    payload = _normalize_hunt_ladder(payload)
    return payload


def _normalize_hunt_ladder(payload):
    ladder = payload.get("hunt_ladder") or {}
    reason = ladder.get("reason")
    payload["hunt_ladder"] = {
        "stage": _normalize_hunt_stage(ladder.get("stage")),
        "reason": _clean_text(reason) or "Модель не предоставила объяснение автоматически"
    }
    return payload


def classify_hunt_ladder(transcript, niche="General", target_product_info=None):
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.getenv("OPENROUTER_API_KEY")
    )

    prompt = f"""
    Определи только стадию осознанности по лестнице Ханта для этого сценария.

    ВАЖНО:
    - Верни JSON строго на русском языке.
    - Выбери ТОЛЬКО ОДНУ стадию из списка:
      "Неосведомлен", "Осознает проблему", "Осознает решение", "Осознает продукт", "Готов к покупке"
    - Не придумывай новые названия стадий.

    Контекст:
    - Ниша: {niche}
    - Продукт: {target_product_info or "Не указан"}

    Текст сценария:
    \"\"\"{transcript}\"\"\"

    Верни JSON:
    {{
      "stage": "одна стадия из списка",
      "reason": "краткое объяснение выбора"
    }}
    """

    response = client.chat.completions.create(
        model="google/gemini-2.5-flash",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )
    content = response.choices[0].message.content
    result = json.loads(content)
    return {
        "stage": _normalize_hunt_stage(result.get("stage")),
        "reason": result.get("reason") or "Модель не предоставила объяснение автоматически"
    }

def get_transcript_audit(transcript, niche="General", target_product_info=None, brand_voice=None, target_audience=None):
    """
    Analyzes a video transcript and returns a viral audit in JSON format.
    Focuses on the specific niche, target product, and brand context provided.
    """
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.getenv("OPENROUTER_API_KEY")
    )
    
    product_desc = target_product_info or "a new product/service"
    voice_desc = brand_voice or "Professional and engaging"
    audience_desc = target_audience or "General audience"

    prompt = f"""
    Вы — эксперт по анализу вирального контента и удержанию внимания (retention). 
    Ваша задача — провести глубокий разбор видео (video_transcript) и выявить его внутреннюю механику: почему оно удерживает зрителя и как работают его триггеры.

    [ВАЖНО] Все пояснения и значения в JSON должны быть СТРОГО НА РУССКОМ ЯЗЫКЕ.

    КОНТЕКСТ ДЛЯ АДАПТАЦИИ:
    - Ниша: {niche}
    - Целевой продукт: {product_desc}
    - Тон бренда: {voice_desc}
    - Целевая аудитория: {audience_desc}

    ИНСТРУКЦИЯ ПО АНАЛИЗУ:
    1. **Хук (Зацепка)**: 
       - Текст: Какие именно слова остановили ленту?
       - Механика: Почему это работает? (Информационная петля, попадание в идентичность, провокация или страх упущенной выгоды?)
       - **Curiosity Gap (Разрыв любопытства)**: Четко сформулируйте вопрос, который рождается в голове зрителя в первые 3 секунды и на который дает ответ только конец видео.
    2. **Структура (Скелет)**: 
       - Разбейте повествование на абстрактные смысловые блоки. 
       - Используйте универсальные термины: "Поднятие ставок", "Враг (проблема или миф)", "Главный Контраст (До/После, Миф/Реальность)", "Социальное доказательство", "Демонстрация", "Якорь доверия", "Стек ценности".
    3. **Литературный отпечаток**:
       - Маркеры экспертности: Найдите 2-3 конкретных детали (цифры, термины, "внутрянка"), которые доказывают, что автор профи.
       - Плотность речи: Использует ли автор связки для ускорения темпа или убирает лишние слова?
    4. **Конфликт и Резонанс**:
       - Кто является **'Врагом'** в этом видео? (устаревший метод, общее заблуждение, конкретная проблема, которую видео «побеждает»).
    5. **Динамика и Удержание**:
       - Какие используются приемы переключения внимания (Pattern Interrupts) и как меняется энергия (Energy Curve)?
    6. **Призыв (CTA)**:
       - Логика перехода к действию. Это «Дружеский совет» или «Директива эксперта»?
    7. **Тип паттерна**:
       - Классифицируйте тип сценария для повторного использования:
       - "top_list", "opinion_take", "hidden_gems", "comparison", "route_story", "mistakes", "problem_solution", "experience_review", "other".
    8. **Стадия осознанности (Лестница Ханта)**:
       - Определите стадию по Шварцу/Ханту: "Неосведомлен", "Осознает проблему", "Осознает решение", "Осознает продукт", "Готов к покупке".

    Текст видео (Transcript):
    \"\"\"{transcript}\"\"\"

    ВЕРНИТЕ JSON (ЗНАЧЕНИЯ НА РУССКОМ):
    {{
        "hunt_ladder": {{
            "stage": "Значение из списка Hunt Ladder (Неосведомлен / Осознает проблему / Осознает решение / Осознает продукт / Готов к покупке)",
            "reason": "Почему именно эта стадия"
        }},
        "country": "Страна или регион, о котором идет речь в видео (например, 'Исландия', 'Турция', 'Грузия' или 'Мир', если общего плана)",
        "viral_score": "Число от 0 до 100",
        "atoms": {{
            "verbal_hook": "Цитата хука из видео",
            "visual_hook": "Описание визуального ряда",
            "psychological_trigger": "Какой триггер используется",
            "narrative_skeleton": ["Список шагов сюжета"],
            "linguistic_fingerprint": {{
                "connectors": ["связки"],
                "rhythm_notes": "темп",
                "colloquialisms": ["сленг"],
                "natural_speech_markers": ["маркеры"]
            }}
        }},
        "reference_strategy": {{
            "topic_cluster": "Основная тема",
            "topic_angle": "Угол подачи",
            "pain_point": "Какую боль закрывает",
            "promise": "Что обещает",
            "proof_type": "Тип доказательства",
            "cta_type": "Тип призыва"
        }},
        "pattern_framework": {{
            "pattern_type": "название_паттерна",
            "core_thesis": "главная мысль",
            "narrator_role": "роль спикера",
            "content_shape": {{
                "format_type": "формат",
                "item_count": 0,
                "sequence_logic": ["логика"]
            }},
            "reusable_slots": {{
                "fixed_elements": ["что не меняем"],
                "replaceable_entities": ["что меняем"]
            }},
            "forbidden_drifts": ["чего избегать"],
            "integration_style": {{
                "tone": "тональность",
                "placement": "где вставить продукт",
                "product_role": "роль продукта"
            }}
        }},
        "viral_dna_synthesis": "Синтез успеха",
        "mirroring_potential": "Как адаптировать"
    }}
    """
    
    logger.info("Requesting viral audit from OpenAI")
    
    try:
        response = client.chat.completions.create(
            model="google/gemini-2.5-flash",
            messages=[
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        
        content = response.choices[0].message.content
        logger.info(f"Audit response received: {content[:100]}...")
        
        # Clean up response if it has JSON markdown
        if "```json" in content:
            content = content.split("```json")[-1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[-1].split("```")[0].strip()
            
        audit_res = json.loads(content)
        
        # Ensure critical keys exist to guarantee UI stability and data integrity
        if "hunt_ladder" not in audit_res:
            audit_res["hunt_ladder"] = {
                "stage": DEFAULT_HUNT_STAGE,
                "reason": "Модель не предоставила данные автоматически"
            }
        audit_res = _sanitize_audit_payload(audit_res, niche)
        
        if "viral_score" not in audit_res:
            audit_res["viral_score"] = 70
            
        if "atoms" not in audit_res:
            audit_res["atoms"] = {}

        logger.info("Audit completed successfully with all mandatory fields")
        return audit_res
        
    except Exception as e:
        error_msg = f"Failed to generate audit: {e}"
        logger.error(error_msg)
        # Also print for visibility in some environments
        print(error_msg)
        
        fallback = {
            "error": str(e),
            "trigger_core": "Error analyzing transcript",
            "reference_strategy": {
                "topic_family": niche,
                "topic_cluster": niche,
                "topic_angle": None,
                "hook_type": None,
                "promise": None,
                "pain_point": None,
                "proof_type": None,
                "cta_type": None,
                "content_constraints": []
            },
            "pattern_framework": {
                "pattern_type": "other",
                "narrator_role": None,
                "hook_style": None,
                "core_thesis": None,
                "content_shape": {
                    "format_type": "other",
                    "item_count": 0,
                    "sequence_logic": []
                },
                "argument_style": None,
                "integration_style": {
                    "product_role": "travel enabler",
                    "placement": "ближе к развязке",
                    "tone": "совет"
                },
                "reusable_slots": {
                    "replaceable_entities": [],
                    "fixed_elements": [],
                    "variation_axes": []
                },
                "forbidden_drifts": []
            },
            "hunt_ladder": {
                "stage": DEFAULT_HUNT_STAGE,
                "reason": "Не удалось надежно определить стадию автоматически"
            },
        }
        return _sanitize_audit_payload(fallback, niche)
