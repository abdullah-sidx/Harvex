import os
import logging
from typing import List, Optional
from pathlib import Path
import httpx
from dotenv import load_dotenv

# Load .env from backend directory and root project directory
_backend_dir = Path(__file__).resolve().parent
_root_dir = _backend_dir.parent
load_dotenv(_backend_dir / ".env")
load_dotenv(_root_dir / ".env", override=False)

logger = logging.getLogger("harvex.sarvam")

SARVAM_BASE_URL = "https://api.sarvam.ai"
TTS_ENDPOINT = f"{SARVAM_BASE_URL}/text-to-speech"
STT_ENDPOINT = f"{SARVAM_BASE_URL}/speech-to-text"

V3_SPEAKERS = {"ritu", "aditya", "ashutosh", "priya", "neha", "rahul", "pooja", "rohan", "simran", "kavya", "amit", "dev"}
V2_SPEAKERS = {"anushka", "abhilash", "manisha", "vidya", "arya", "karun", "hitesh"}


def get_sarvam_api_key() -> str:
    """Retrieve Sarvam API Key from environment variables."""
    key = os.getenv("SARVAM_API_KEY", "").strip()
    if not key:
        load_dotenv(_root_dir / ".env", override=True)
        key = os.getenv("SARVAM_API_KEY", "").strip()
    return key


def normalize_language_code(lang: str) -> str:
    """Normalize language identifier to Sarvam standard code ('hi-IN' or 'en-IN')."""
    if not lang:
        return "hi-IN"
    lang_lower = lang.strip().lower()
    if lang_lower in {"hi", "hindi", "hi-in"}:
        return "hi-IN"
    elif lang_lower in {"en", "english", "en-in"}:
        return "en-IN"
    return lang


async def text_to_speech(
    inputs: List[str],
    target_language_code: str = "hi-IN",
    speaker: str = "ritu",
    model: str = "bulbul:v3"
) -> List[str]:
    """
    Synthesize Indic text to speech using Sarvam AI Text-to-Speech API.
    Supports Hindi ('hi-IN') and English ('en-IN').
    """
    api_key = get_sarvam_api_key()
    if not api_key:
        logger.warning("SARVAM_API_KEY is not configured in .env. Skipping Sarvam TTS.")
        return []

    if not inputs or not any(text.strip() for text in inputs):
        return []

    target_lang = normalize_language_code(target_language_code)
    clean_inputs = [text.strip()[:500] for text in inputs if text.strip()]
    if not clean_inputs:
        return []

    headers = {
        "api-subscription-key": api_key,
        "Content-Type": "application/json"
    }

    # Model and speaker pairs to try
    configurations = [
        ("bulbul:v3", speaker if speaker in V3_SPEAKERS else "ritu"),
        ("bulbul:v2", "anushka"),
    ]

    for current_model, current_speaker in configurations:
        payload = {
            "inputs": clean_inputs,
            "target_language_code": target_lang,
            "speaker": current_speaker,
            "model": current_model,
            "enable_preprocessing": True
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(TTS_ENDPOINT, headers=headers, json=payload)
                if response.status_code == 200:
                    data = response.json()
                    audios = data.get("audios", [])
                    logger.info(f"✅ Sarvam AI TTS SUCCESS ({target_lang}, model={current_model}, speaker={current_speaker}, snippets={len(audios)})")
                    return audios
                else:
                    logger.warning(f"Sarvam TTS ({current_model}/{current_speaker}) returned {response.status_code}: {response.text[:150]}")
        except Exception as e:
            logger.warning(f"Sarvam TTS attempt with {current_model} failed: {e}")
            continue

    return []


async def speech_to_text(
    file_bytes: bytes,
    language_code: str = "hi-IN",
    model: str = "saaras:v1"
) -> str:
    """
    Transcribe spoken voice audio to text using Sarvam AI Speech-to-Text API.
    """
    api_key = get_sarvam_api_key()
    if not api_key:
        logger.warning("SARVAM_API_KEY is not configured in .env. Skipping Sarvam STT.")
        return ""

    if not file_bytes:
        return ""

    target_lang = normalize_language_code(language_code)

    headers = {
        "api-subscription-key": api_key
    }

    files = {
        "file": ("voice_input.wav", file_bytes, "audio/wav")
    }

    data = {
        "language_code": target_lang,
        "model": model
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(STT_ENDPOINT, headers=headers, files=files, data=data)
            if response.status_code == 200:
                resp_json = response.json()
                transcript = resp_json.get("transcript", "")
                logger.info(f"Successfully transcribed audio via Sarvam STT: '{transcript}'")
                return transcript
            else:
                logger.error(f"Sarvam STT Error {response.status_code}: {response.text}")
                return ""
    except Exception as e:
        logger.error(f"Error during Sarvam STT request: {e}")
        return ""
