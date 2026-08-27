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
    """Normalize language identifier to Sarvam standard code ('hi-IN', 'en-IN', or 'unknown')."""
    if not lang:
        return "hi-IN"
    lang_lower = lang.strip().lower()
    if lang_lower in {"unknown", "auto", "detect"}:
        return "unknown"
    if lang_lower in {"hi", "hindi", "hi-in"}:
        return "hi-IN"
    elif lang_lower in {"en", "english", "en-in"}:
        return "en-IN"
    return lang


def sanitize_audio_content_type(content_type: str, filename: str = "") -> str:
    """
    Normalize and sanitize MIME content-type for Sarvam AI STT API.
    Sarvam AI rejects parameters like ';codecs=opus' with 400 Invalid file type.
    Allowed types: audio/webm, audio/wav, audio/mp3, audio/mpeg, audio/ogg, audio/flac, audio/aac
    """
    raw_ct = (content_type or "").split(";")[0].strip().lower()
    ALLOWED_TYPES = {
        "audio/webm", "audio/wav", "audio/x-wav", "audio/mp3",
        "audio/mpeg", "audio/ogg", "audio/flac", "audio/aac"
    }
    if raw_ct in ALLOWED_TYPES:
        return raw_ct

    fname = (filename or "").lower()
    if fname.endswith(".wav"):
        return "audio/wav"
    elif fname.endswith(".mp3"):
        return "audio/mp3"
    elif fname.endswith(".ogg"):
        return "audio/ogg"
    elif fname.endswith(".flac"):
        return "audio/flac"
    elif fname.endswith(".aac"):
        return "audio/aac"

    return "audio/webm"



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
    model: str = "saarika:v2.5",
    filename: str = "voice_input.webm",
    content_type: str = "audio/webm"
) -> str:
    """
    Transcribe spoken voice audio to text using Sarvam AI Speech-to-Text API.
    Uses 'saarika:v2.5' model which supports high-accuracy Indic transcription.
    Automatically sanitizes content_type and auto-retries with language_code='unknown'
    if the language specific prompt yields no text.
    """
    api_key = get_sarvam_api_key()
    if not api_key:
        logger.warning("SARVAM_API_KEY is not configured in .env. Skipping Sarvam STT.")
        return ""

    if not file_bytes:
        return ""

    target_lang = normalize_language_code(language_code)
    clean_content_type = sanitize_audio_content_type(content_type, filename)
    clean_filename = filename if filename.endswith((".webm", ".wav", ".mp3", ".ogg")) else "voice_input.webm"

    headers = {
        "api-subscription-key": api_key
    }

    files = {
        "file": (clean_filename, file_bytes, clean_content_type)
    }

    data = {
        "language_code": target_lang,
        "model": model or "saarika:v2.5"
    }

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.post(STT_ENDPOINT, headers=headers, files=files, data=data)
            transcript = ""
            if response.status_code == 200:
                resp_json = response.json()
                transcript = (resp_json.get("transcript", "") or "").strip()
                logger.info(f"Successfully transcribed audio via Sarvam STT ({target_lang}): '{transcript}'")
            else:
                logger.warning(f"Sarvam STT attempt ({target_lang}, {clean_content_type}) returned {response.status_code}: {response.text}")

            # If specific language yielded empty transcript, retry with auto-detection ('unknown')
            if not transcript and target_lang != "unknown":
                logger.info(f"Sarvam STT returned empty for '{target_lang}', retrying with language_code='unknown'...")
                retry_data = {
                    "language_code": "unknown",
                    "model": model or "saarika:v2.5"
                }
                retry_files = {
                    "file": (clean_filename, file_bytes, clean_content_type)
                }
                retry_resp = await client.post(STT_ENDPOINT, headers=headers, files=retry_files, data=retry_data)
                if retry_resp.status_code == 200:
                    retry_json = retry_resp.json()
                    transcript = (retry_json.get("transcript", "") or "").strip()
                    logger.info(f"Sarvam STT auto-detect retry yielded: '{transcript}'")
                else:
                    logger.warning(f"Sarvam STT auto-detect retry returned {retry_resp.status_code}: {retry_resp.text}")

            return transcript
    except Exception as e:
        logger.error(f"Error during Sarvam STT request: {e}")
        return ""


