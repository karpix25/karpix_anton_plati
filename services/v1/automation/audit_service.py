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


def _normalize_hunt_stage(value):
    raw = (value or "").strip().lower().replace("ё", "е")
    return HUNT_STAGE_ALIASES.get(raw, "Не определена")


def _normalize_hunt_ladder(payload):
    ladder = payload.get("hunt_ladder") or {}
    payload["hunt_ladder"] = {
        "stage": _normalize_hunt_stage(ladder.get("stage")),
        "reason": ladder.get("reason") or "Модель не предоставила объяснение автоматически"
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
                "stage": "Не определена",
                "reason": "Модель не предоставила данные автоматически"
            }
        audit_res = _normalize_hunt_ladder(audit_res)
        
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
        
        return {
            "error": str(e),
            "trigger_core": "Error analyzing transcript",
            "reference_strategy": {
                "topic_family": niche,
                "topic_cluster": niche,
                "topic_angle": "Не определен",
                "hook_type": "Не определен",
                "promise": "Не определено",
                "pain_point": "Не определено",
                "proof_type": "Не определен",
                "cta_type": "Не определен",
                "content_constraints": []
            },
            "pattern_framework": {
                "pattern_type": "other",
                "narrator_role": "Не определен",
                "hook_style": "Не определен",
                "core_thesis": "Не определено",
                "content_shape": {
                    "format_type": "Не определен",
                    "item_count": 0,
                    "sequence_logic": []
                },
                "argument_style": "Не определен",
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
                "stage": "Не определена",
                "reason": "Не удалось надежно определить стадию автоматически"
            },
        }
