# Copyright (c) 2025 Stephen G. Pope
#
# AI Editor Service: Generates B-roll and visual prompts.

import os
import json
import logging
from openai import OpenAI

# Set up logging
logger = logging.getLogger(__name__)

def generate_broll_plan(scenario_json):
    """
    Takes a scenario script and generates a plan for AI-generated b-roll scenes.
    """
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.getenv("OPENROUTER_API_KEY")
    )
    script = scenario_json.get("script", "")
    
    prompt = f"""
    Analyze the following script and generate a visual B-roll plan.
    Each scene should have a keyword-rich prompt for an AI video generator (like Haiper or Luma).
    
    Script:
    \"\"\"{script}\"\"\"
    
    Return a JSON object:
    {{
        "scenes": [
            {{
                "timestamp": "Start/Duration",
                "visual_prompt": "Detailed prompt for AI video gen",
                "keywords": ["key1", "key2"]
            }}
        ]
    }}
    """
    
    try:
        response = client.chat.completions.create(
            model="openai/gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        logger.error(f"Failed to generate b-roll plan: {e}")
        return {"scenes": []}
