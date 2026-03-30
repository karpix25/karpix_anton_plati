import os
import requests
import json
import logging
from dotenv import load_dotenv

# Force loading .env from the root directory
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env'), override=True)

logger = logging.getLogger(__name__)

class MiniMaxTTSService:
    def __init__(self):
        self.api_key = os.getenv("MINIMAX_API_KEY")
        self.group_id = os.getenv("MINIMAX_GROUP_ID")
        self.base_url = "https://api.minimax.chat/v1/text_to_speech"
        
        if not self.api_key or not self.group_id:
            logger.error("MINIMAX_API_KEY or MINIMAX_GROUP_ID not found in environment")
            raise ValueError("MINIMAX credentials missing")

    def generate_speech(self, text, voice_id="male-russian-01", speed=1.0, emotion="fluent"):
        """
        Generates speech from text using MiniMax API.
        Returns the raw audio binary data.
        """
        url = f"{self.base_url}?GroupId={self.group_id}"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": "speech-01-24", # Or "speech-01" based on current availability. The HD one might be different.
            "text": text,
            "stream": False,
            "voice_setting": {
                "voice_id": voice_id,
                "speed": speed,
                "vol": 1.0,
                "pitch": 0,
                "emotion": emotion
            },
            "audio_setting": {
                "sample_rate": 32000,
                "bitrate": 128000,
                "format": "mp3"
            }
        }
        
        # Add language boost for better Russian pronunciation if using newer models
        # For speech-01, it might not be needed, but for 2.8 it is.
        # Let's check the researched guide again. 
        # Actually, let's stick to the simplest working version first.
        
        try:
            logger.info(f"Sending TTS request to MiniMax for text: {text[:50]}...")
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            
            if response.status_code != 200:
                logger.error(f"MiniMax API error: {response.status_code} - {response.text}")
                raise Exception(f"MiniMax API returned {response.status_code}: {response.text}")
            
            # The response usually contains JSON with 'data' field containing the audio URL or base64, 
            # OR it might be direct binary if we use the 'T2A' endpoint.
            # MiniMax T2A (Text-to-Audio) usually returns JSON with result info and 'data' or 'url'.
            
            result = response.json()
            if 'base_resp' in result and result['base_resp']['status_code'] != 0:
                error_msg = result['base_resp']['status_msg']
                logger.error(f"MiniMax Business Error: {error_msg}")
                raise Exception(f"MiniMax Error: {error_msg}")
                
            # For direct T2A it might be different. 
            # In the documentation, it often returns a JSON with 'data' as a hex/base64 or a link.
            # Let's assume it returns 'data' as the audio content if we don't use 'stream'.
            
            if 'data' in result and 'audio' in result['data']:
                # The 'audio' field usually contains the hex string of the MP3
                audio_hex = result['data']['audio']
                return bytes.fromhex(audio_hex)
            
            logger.error(f"Unexpected response format from MiniMax: {result}")
            raise Exception("Failed to get audio data from MiniMax response")
            
        except Exception as e:
            logger.error(f"Failed to generate speech: {str(e)}")
            raise

if __name__ == "__main__":
    # Test script
    logging.basicConfig(level=logging.INFO)
    service = MiniMaxTTSService()
    try:
        audio_data = service.generate_speech("Привет! Это тест русской озвучки от МиниМакс.")
        with open("test_audio.mp3", "wb") as f:
            f.write(audio_data)
        print("Success! Saved to test_audio.mp3")
    except Exception as e:
        print(f"Test failed: {e}")
