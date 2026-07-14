import html
import os
import re
import time
from typing import Any, Dict

import requests


DEFAULT_INTERNAL_API_BASE_URL = "http://127.0.0.1:3000"
_HTML_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_HTML_TAG_RE = re.compile(r"<[^>]+>")


def get_internal_api_base_url() -> str:
    return (os.getenv("INTERNAL_API_BASE_URL") or DEFAULT_INTERNAL_API_BASE_URL).rstrip("/")


def build_internal_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {}
    token = (os.getenv("AUTOMATION_INTERNAL_TOKEN") or "").strip()
    if token:
        headers["x-automation-token"] = token
    return headers


def summarize_response_body(body: str, max_length: int = 320) -> str:
    text = str(body or "").strip()
    if not text:
        return ""

    title_match = _HTML_TITLE_RE.search(text)
    if title_match:
        return html.unescape(title_match.group(1)).strip()

    without_tags = _HTML_TAG_RE.sub(" ", text)
    normalized = " ".join(html.unescape(without_tags).split())
    return normalized[:max_length] + ("..." if len(normalized) > max_length else "")


def build_internal_api_error_message(response: requests.Response, path: str) -> str:
    content_type = response.headers.get("content-type") or "unknown content-type"

    try:
        payload = response.json()
    except ValueError:
        payload = None

    if isinstance(payload, dict):
        detail = payload.get("error") or payload.get("message")
        if detail:
            return str(detail)

    summary = summarize_response_body(response.text)
    suffix = f": {summary}" if summary else ""
    return f"Internal API {path} failed with status {response.status_code} ({content_type}){suffix}"


def is_transient_next_not_found(response: requests.Response) -> bool:
    content_type = (response.headers.get("content-type") or "").lower()
    if response.status_code != 404 or "text/html" not in content_type:
        return False
    return summarize_response_body(response.text) == "404: This page could not be found."


def request_internal_response(method: str, path: str, **kwargs: Any) -> requests.Response:
    retry_attempts = max(1, int(kwargs.pop("retry_attempts", 3)))
    retry_delay_seconds = max(0.0, float(kwargs.pop("retry_delay_seconds", 1.5)))
    headers = {**build_internal_headers(), **kwargs.pop("headers", {})}
    timeout = kwargs.pop("timeout", 300)
    url = f"{get_internal_api_base_url()}{path}"

    for attempt in range(retry_attempts):
        response = requests.request(method, url, headers=headers, timeout=timeout, **kwargs)
        if not is_transient_next_not_found(response) or attempt >= retry_attempts - 1:
            return response
        time.sleep(retry_delay_seconds)

    return response



def request_internal_json(method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
    response = request_internal_response(method, path, **kwargs)
    if not response.ok:
        raise RuntimeError(build_internal_api_error_message(response, path))

    try:
        payload = response.json()
    except ValueError:
        content_type = response.headers.get("content-type") or "unknown content-type"
        summary = summarize_response_body(response.text)
        suffix = f": {summary}" if summary else ""
        raise RuntimeError(f"Internal API {path} returned non-JSON response ({content_type}){suffix}")

    if isinstance(payload, dict):
        return payload

    return {"data": payload}
