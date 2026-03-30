import os
import requests
import logging
import uuid
import json

logger = logging.getLogger(__name__)

def download_instagram_reel(url):
    """
    Downloads a Reel using RapidAPI Social Lens.
    Returns the local path to the video stored in /tmp.
    """
    api_key = os.getenv("RAPIDAPI_KEY")
    if not api_key:
        raise ValueError("RAPIDAPI_KEY not found in environment")

    # Phase 1: Get Video Info
    # Updated to match working example provided by user
    api_url = "https://instagram-social-api.p.rapidapi.com/v1/post_info"
    querystring = {"code_or_id_or_url": url}
    
    headers = {
        "x-rapidapi-key": api_key,
        "x-rapidapi-host": "instagram-social-api.p.rapidapi.com"
    }
    
    logger.info(f"Fetching Reel info for: {url}")
    response = requests.get(api_url, headers=headers, params=querystring)
    response.raise_for_status()
    
    data = response.json()
    logger.debug(f"API Response: {json.dumps(data)[:500]}...") # Log first 500 chars

    # The API might return data wrapped in 'data' or directly
    payload = data.get("data", data)
    
    # If payload is a list, take first item
    if isinstance(payload, list) and len(payload) > 0:
        item = payload[0]
    # If it has 'items' field (legacy/alternative structure)
    elif isinstance(payload, dict) and payload.get("items"):
        item = payload["items"][0]
    else:
        item = payload

    # Try multiple ways to find the video URL based on common RapidAPI patterns
    video_url = None
    
    # 1. Nested in video_versions (from user screenshot)
    video_versions = item.get("video_versions")
    if video_versions and isinstance(video_versions, list) and len(video_versions) > 0:
        video_url = video_versions[0].get("url")
    
    # 2. Direct keys
    if not video_url:
        video_url = item.get("video_url") or item.get("media_url") or item.get("url")

    if not video_url:
        logger.error(f"Failed to extract video_url. Structure keys: {list(item.keys()) if isinstance(item, dict) else 'Not a dict'}")
        raise ValueError("Could not extract direct video URL from Reels data.")

    # Phase 2: Download the binary
    logger.info(f"Downloading video binary from: {video_url[:50]}...")
    video_response = requests.get(video_url, stream=True)
    video_response.raise_for_status()
    
    # Generate unique filename
    file_path = f"/tmp/reel_{uuid.uuid4().hex}.mp4"
    
    with open(file_path, 'wb') as f:
        for chunk in video_response.iter_content(chunk_size=8192):
            f.write(chunk)
            
    logger.info(f"Reel downloaded successfully to: {file_path}")
    return file_path
