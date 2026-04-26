import os
import json
import logging
import ast
import re
from datetime import datetime, timezone
from openai import OpenAI

logger = logging.getLogger(__name__)

def get_openrouter_client():
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

def clean_markdown_json(content: str) -> str:
    value = (content or "").strip()
    if "```json" in value:
        value = value.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in value:
        value = value.split("```", 1)[1].split("```", 1)[0].strip()
    return value

def extract_json_object(text: str) -> str | None:
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

def try_parse_json_payload(raw_content: str):
    cleaned = clean_markdown_json(raw_content)
    candidates = [cleaned]

    extracted = extract_json_object(cleaned)
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

def repair_json_with_model(client: OpenAI, raw_content: str):
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
    return try_parse_json_payload(repaired_content)

def chat_json(prompt: str, model: str = None):
    client = get_openrouter_client()
    last_error = None
    model = model or os.getenv("SCENARIO_MODEL", "google/gemini-2.5-flash")
    
    for attempt in range(1, 3):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            content = response.choices[0].message.content
            try:
                return try_parse_json_payload(content)
            except Exception as parse_error:
                logger.warning("JSON parse failed in chat_json (attempt %s): %s", attempt, parse_error)
                try:
                    return repair_json_with_model(client, content)
                except Exception as repair_error:
                    last_error = repair_error
                    logger.warning("JSON repair failed in chat_json (attempt %s): %s", attempt, repair_error)
        except Exception as request_error:
            last_error = request_error
            logger.error("OpenRouter request failed in chat_json (attempt %s): %s", attempt, request_error)

    raise last_error

def chat_text(prompt: str, model: str = None) -> str:
    client = get_openrouter_client()
    model = model or os.getenv("SCENARIO_MODEL", "google/gemini-2.5-flash")
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Error in chat_text: {e}")
        return ""
