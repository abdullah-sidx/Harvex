import logging
import os
import sys
from typing import Optional, Dict, Any, List

# Ensure backend directory is in sys.path
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from fastapi import APIRouter, File, Form, UploadFile, Query, HTTPException, status
from fastapi.responses import JSONResponse

from schemas import (
    SensorDataPayload,
    SensorDataResponse,
    PumpCommandResponse,
    DiseaseDetectionResponse,
    StatusResponse,
    VoiceSynthesizeRequest,
    VoiceSynthesizeResponse,
    VoiceTranscribeResponse,
    UserFarmProfileSchema,
    CropRecommendationRequest,
    CropRecommendationResponse,
    CropRecommendation,
    VoiceChatRequest,
    VoiceChatResponse,
    TextChatRequest,
    TextChatResponse,
    VoiceQueryRequest,
    VoiceQueryResponse,
    PumpToggleRequest,
    PumpToggleResponse,
    PumpHistoryItem,
)
import database
import weather
from model import (
    classifier,
    DEFAULT_UNCERTAIN_ADVISORY,
    DEFAULT_UNCERTAIN_ADVISORY_HI,
)
import decision
import sarvam
from datetime import datetime, timezone
from telemetry_state import (
    latest_sensor_data,
    get_latest_sensor_data,
    update_latest_sensor_data,
    get_pending_pump_command,
    set_pending_pump_command,
    is_manual_pump_override_active,
    clear_manual_pump_override,
    add_in_memory_pump_history,
    get_in_memory_pump_history,
    sensor_data,
    get_sensor_data,
    update_sensor_data,
)

logger = logging.getLogger("harvex.routes")

router = APIRouter(prefix="/api", tags=["Harvex API"])


@router.post(
    "/sensor-data",
    response_model=SensorDataResponse,
    status_code=status.HTTP_200_OK,
    summary="Receive telemetry from NodeMCU ESP8266 field nodes"
)
async def post_sensor_data(payload: SensorDataPayload):
    """
    Called by NodeMCU ESP8266 / ESP32 field nodes every loop to publish real-time
    soil moisture, temperature, humidity, and pump status over Wi-Fi.
    Accepts JSON: {"soil_moisture": float, "temperature": float, "humidity": float}
    """
    try:
        now_iso = payload.timestamp or datetime.now(timezone.utc).isoformat()
        dev_id = payload.device_id or "harvex-node-1"
        sm = float(payload.soil_moisture if payload.soil_moisture is not None else payload.soil_moisture_pct)
        tc = float(payload.temperature if payload.temperature is not None else payload.temperature_c)
        hp = float(payload.humidity if payload.humidity is not None else payload.humidity_pct)
        ps = (payload.pump_status or "off").strip().lower()

        # 1. Update global in-memory latest_sensor_data & refresh sensor heartbeat
        update_latest_sensor_data(
            soil_moisture=sm,
            temperature=tc,
            humidity=hp,
            pump_status=ps,
            device_id=dev_id,
            timestamp=now_iso
        )

        # 2. Persist to SQLite database
        database.save_sensor_reading(
            device_id=dev_id,
            timestamp=now_iso,
            soil_moisture_pct=sm,
            temperature_c=tc,
            humidity_pct=hp,
            pump_status=ps
        )

        return SensorDataResponse(status="success")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error persisting sensor data: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to process sensor data: {str(e)}"
        )


@router.get(
    "/sensor-data",
    status_code=status.HTTP_200_OK,
    summary="Get current real-time sensor data telemetry"
)
async def get_sensor_data_endpoint():
    """
    Polled by frontend dashboard to display real-time Soil Moisture, Temperature, and Humidity.
    Returns current in-memory latest_sensor_data, falling back to SQLite if not yet updated.
    """
    curr = dict(get_latest_sensor_data())
    if curr.get("updated_at") is None and curr.get("last_updated_timestamp") is None:
        try:
            latest = database.get_latest_sensor_reading("harvex-node-1")
            if latest and latest.get("timestamp"):
                curr["soil_moisture_pct"] = float(latest.get("soil_moisture_pct", 50.0))
                curr["soil_moisture"] = curr["soil_moisture_pct"]
                curr["temperature_c"] = float(latest.get("temperature_c", 24.0))
                curr["temperature"] = curr["temperature_c"]
                curr["humidity_pct"] = float(latest.get("humidity_pct", 68.0))
                curr["humidity"] = curr["humidity_pct"]
                curr["pump_status"] = str(latest.get("pump_status", "off"))
                curr["updated_at"] = str(latest.get("timestamp"))
                curr["last_updated_timestamp"] = str(latest.get("timestamp"))
        except Exception:
            pass

    # Ensure both updated_at and last_updated_timestamp are always available
    ts = curr.get("updated_at") or curr.get("last_updated_timestamp")
    curr["updated_at"] = ts
    curr["last_updated_timestamp"] = ts
    return curr


@router.get(
    "/pump-command",
    response_model=PumpCommandResponse,
    status_code=status.HTTP_200_OK,
    summary="Get irrigation control command for NodeMCU / ESP8266 node"
)
async def get_pump_command(device_id: str = Query(default="harvex-node-1", description="Device Identifier")):
    """
    Polled by NodeMCU ESP8266 field node every loop.
    Returns pending_pump_command if a manual web override is active,
    otherwise fuses latest soil moisture reading with live weather rain forecast.
    """
    # 1. Check if user initiated a manual toggle from the website
    if is_manual_pump_override_active():
        cmd = get_pending_pump_command()
        return PumpCommandResponse(
            pump_command=cmd.get("pump_command", "off"),
            max_runtime_seconds=cmd.get("max_runtime_seconds", 0),
            display_message=cmd.get("display_message", "Web Pump Command")
        )

    # 2. Otherwise calculate automatic agronomic decision
    live = get_latest_sensor_data()
    soil_moisture = float(live.get("soil_moisture_pct", 50.0))
    if live.get("updated_at") is None:
        sensor_rec = database.get_latest_sensor_reading(device_id=device_id)
        soil_moisture = float(sensor_rec.get("soil_moisture_pct", 50.0))

    _, rain_expected = weather.get_rain_forecast()

    command_data = decision.compute_pump_command(
        soil_moisture_pct=soil_moisture,
        rain_expected=rain_expected
    )
    return PumpCommandResponse(**command_data)


@router.post(
    "/pump/toggle",
    response_model=PumpToggleResponse,
    status_code=status.HTTP_200_OK,
    summary="Manually toggle irrigation pump relay from website"
)
async def toggle_pump(payload: PumpToggleRequest):
    """
    Triggered by frontend pump button. Updates pending_pump_command,
    adds an entry to pump_history, and sets an LCD display message ("Web Pump ON" / "Web Pump OFF").
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    is_on = payload.state.lower() == "on"
    action = "ON" if is_on else "OFF"
    runtime = payload.duration_seconds if is_on else 0
    msg = "Web Pump ON" if is_on else "Web Pump OFF"

    # 1. Update pending command for NodeMCU
    cmd = set_pending_pump_command(
        pump_command=payload.state,
        max_runtime_seconds=runtime,
        display_message=msg
    )

    # 2. Record pump history entry
    hist_id = f"pump-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    history_entry = {
        "id": hist_id,
        "timestamp": now_iso,
        "action": action,
        "triggered_by": (payload.triggered_by or "WEBSITE").upper(),
        "duration_seconds": runtime
    }

    try:
        database.add_pump_history(
            id=hist_id,
            timestamp=now_iso,
            action=action,
            triggered_by=history_entry["triggered_by"],
            duration_seconds=runtime
        )
        if is_on:
            database.update_last_watered("harvex-node-1", now_iso)
    except Exception as e:
        logger.warning(f"Failed to persist pump history to SQLite: {e}")

    add_in_memory_pump_history(history_entry)

    logger.info(f"[pump/toggle] Set pump {action} via {history_entry['triggered_by']} (runtime={runtime}s)")

    return PumpToggleResponse(
        status="success",
        pump_command=cmd["pump_command"],
        display_message=cmd["display_message"],
        history_entry=history_entry
    )


@router.get(
    "/pump/history",
    status_code=status.HTTP_200_OK,
    summary="Retrieve list of past irrigation events sorted by newest first"
)
async def get_pump_history_endpoint(limit: int = Query(default=50, ge=1, le=100)):
    """Returns list of past irrigation events sorted by newest first."""
    try:
        db_hist = database.get_pump_history(limit=limit)
        if db_hist:
            return db_hist
    except Exception as e:
        logger.warning(f"Failed to fetch pump history from database: {e}")

    return get_in_memory_pump_history(limit=limit)


@router.post(
    "/detect-disease",
    response_model=DiseaseDetectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Classify plant disease from uploaded leaf photo with optional voice synthesis"
)
async def detect_disease(
    image: Optional[UploadFile] = File(None),
    lang: str = Query(default="en", description="Preferred language for advisory & TTS: 'en' or 'hi'")
):
    """
    Called by Farmer UI when uploading a leaf photo.
    Runs pretrained Vision Transformer (ViT) model on the image.
    Returns detected disease class, bilingual agronomic advisory, and optional Sarvam AI TTS audio.
    """
    is_hindi = lang.strip().lower().startswith("hi")

    if image is None:
        result = {
            "disease_class": "uncertain",
            "confidence": 0.0,
            "advisory": DEFAULT_UNCERTAIN_ADVISORY,
            "advisory_hi": DEFAULT_UNCERTAIN_ADVISORY_HI,
            "voice_audio_base64": None
        }
        database.save_disease_detection(
            disease_class=result["disease_class"],
            confidence=result["confidence"],
            advisory=result["advisory"],
            advisory_hi=result["advisory_hi"]
        )

        # Generate audio if Hindi or TTS requested
        if is_hindi:
            audios = await sarvam.text_to_speech([result["advisory_hi"]], target_language_code="hi-IN")
            if audios:
                result["voice_audio_base64"] = audios[0]

        return DiseaseDetectionResponse(**result)

    try:
        image_bytes = await image.read()
        if not image_bytes or len(image_bytes) < 100:
            result = {
                "disease_class": "uncertain",
                "confidence": 0.0,
                "advisory": DEFAULT_UNCERTAIN_ADVISORY,
                "advisory_hi": DEFAULT_UNCERTAIN_ADVISORY_HI,
                "voice_audio_base64": None
            }
        else:
            result = classifier.predict(image_bytes)
            result["voice_audio_base64"] = None

        # Store diagnosis result into database
        database.save_disease_detection(
            disease_class=result["disease_class"],
            confidence=result["confidence"],
            advisory=result["advisory"],
            advisory_hi=result.get("advisory_hi")
        )

        # Synthesize Sarvam Voice Audio if requested
        if is_hindi and result.get("advisory_hi"):
            audios = await sarvam.text_to_speech([result["advisory_hi"]], target_language_code="hi-IN")
            if audios:
                result["voice_audio_base64"] = audios[0]

        return DiseaseDetectionResponse(**result)

    except Exception as e:
        logger.warning(f"Handled error in detect_disease: {e}")
        # Graceful fallback: return uncertain shape without 500 error
        fallback_result = {
            "disease_class": "uncertain",
            "confidence": 0.0,
            "advisory": DEFAULT_UNCERTAIN_ADVISORY,
            "advisory_hi": DEFAULT_UNCERTAIN_ADVISORY_HI,
            "voice_audio_base64": None
        }
        database.save_disease_detection(
            disease_class=fallback_result["disease_class"],
            confidence=fallback_result["confidence"],
            advisory=fallback_result["advisory"],
            advisory_hi=fallback_result["advisory_hi"]
        )

        if is_hindi:
            audios = await sarvam.text_to_speech([fallback_result["advisory_hi"]], target_language_code="hi-IN")
            if audios:
                fallback_result["voice_audio_base64"] = audios[0]

        return DiseaseDetectionResponse(**fallback_result)


@router.get(
    "/status",
    response_model=StatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Get live farm vitals, decision status, and disease check with optional voice summary"
)
async def get_status(
    device_id: str = Query(default="harvex-node-1", description="Device Identifier"),
    lang: str = Query(default="en", description="Preferred language for speech summary: 'en' or 'hi'")
):
    """
    Polled by Farmer UI dashboard every 5-10 seconds.
    Provides complete fused state: sensor telemetry, rain expectation,
    latest disease result, and crop health score with optional Sarvam AI audio summary.
    """
    is_hindi = lang.strip().lower().startswith("hi")

    # 1. Fetch latest sensor telemetry
    sensor_data = database.get_latest_sensor_reading(device_id=device_id)

    # 2. Fetch live rain forecast
    _, rain_expected = weather.get_rain_forecast()

    # 3. Fetch latest disease detection result
    latest_disease = database.get_latest_disease_detection(device_id=device_id)

    # 4. Compute holistic crop health score
    crop_health_score = decision.compute_crop_health_score(
        soil_moisture_pct=sensor_data["soil_moisture_pct"],
        latest_disease_result=latest_disease
    )

    voice_audio = None
    if is_hindi:
        status_hi_map = {
            "Healthy": "फसल स्वस्थ है।",
            "Needs Water": "फसल को सिंचाई की आवश्यकता है।",
            "Disease Risk": "फसल में रोग का जोखिम पाया गया है।",
            "Needs Water + Disease Risk": "फसल को सिंचाई और रोग नियंत्रण दोनों की आवश्यकता है।"
        }
        score_hi = status_hi_map.get(crop_health_score, "स्थिति सामान्य है।")
        rain_hi = "जल्द बारिश की संभावना है।" if rain_expected else "बारिश की संभावना नहीं है।"
        summary_text = (
            f"खेत की स्थिति: मिट्टी की नमी {int(sensor_data['soil_moisture_pct'])} प्रतिशत है। "
            f"तापमान {sensor_data['temperature_c']} डिग्री है। {score_hi} {rain_hi}"
        )
        audios = await sarvam.text_to_speech([summary_text], target_language_code="hi-IN")
        if audios:
            voice_audio = audios[0]

    return StatusResponse(
        device_id=sensor_data["device_id"],
        soil_moisture_pct=sensor_data["soil_moisture_pct"],
        temperature_c=sensor_data["temperature_c"],
        humidity_pct=sensor_data["humidity_pct"],
        pump_status=sensor_data["pump_status"],
        last_watered=sensor_data["last_watered"],
        rain_expected=rain_expected,
        crop_health_score=crop_health_score,
        last_disease_result=DiseaseDetectionResponse(**latest_disease),
        voice_audio_base64=voice_audio
    )


# ============================================================================
# Sarvam AI Voice Integration Endpoints (TTS & STT)
# ============================================================================

@router.post(
    "/voice/synthesize",
    response_model=VoiceSynthesizeResponse,
    status_code=status.HTTP_200_OK,
    summary="Synthesize speech from text using Sarvam AI TTS (Bilingual Hindi & English)"
)
async def synthesize_voice(payload: VoiceSynthesizeRequest):
    """
    Synthesizes input text to voice audio base64 using Sarvam AI Text-to-Speech.
    Supports Hindi ('hi-IN') and English ('en-IN').
    """
    audios = await sarvam.text_to_speech(
        inputs=[payload.text],
        target_language_code=payload.language,
        speaker=payload.speaker or "anushka",
        model="bulbul:v2"
    )
    audio_base64 = audios[0] if audios else ""
    return VoiceSynthesizeResponse(
        audio_base64=audio_base64,
        language=payload.language
    )


@router.post(
    "/voice/transcribe",
    response_model=VoiceTranscribeResponse,
    status_code=status.HTTP_200_OK,
    summary="Transcribe spoken voice audio to text using Sarvam AI STT"
)
async def transcribe_voice(
    file: UploadFile = File(..., description="Audio recording file (wav, mp3, webm, etc.)"),
    language: str = Form(default="hi", description="Spoken language code: 'hi' or 'en'")
):
    """
    Transcribes uploaded audio bytes to text using Sarvam AI Speech-to-Text.
    """
    try:
        audio_bytes = await file.read()
        if not audio_bytes:
            return VoiceTranscribeResponse(transcript="", language=language)

        transcript = await sarvam.speech_to_text(
            file_bytes=audio_bytes,
            language_code=language
        )
        return VoiceTranscribeResponse(
            transcript=transcript,
            language=language
        )
    except Exception as e:
        logger.error(f"Error during audio transcription: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to transcribe audio: {str(e)}"
        )


# ============================================================================
# Seasonal Crop Recommendation Engine
# ============================================================================

from schemas import (
    CropRecommendationRequest,
    CropRecommendationResponse,
    CropRecommendation,
    VoiceChatRequest,
    VoiceChatResponse,
    TextChatRequest,
    TextChatResponse
)
from datetime import datetime
import json
import re


def get_current_agricultural_season() -> str:
    """Determine current Indian agricultural season based on month."""
    month = datetime.now().month
    if month in [10, 11, 12, 1, 2, 3]:
        return "Rabi (Winter Season / रबी)"
    elif month in [6, 7, 8, 9]:
        return "Kharif (Monsoon Season / खरीफ)"
    else:
        return "Zaid (Summer Season / जायद)"


async def query_gemini_llm(
    prompt: str,
    system_instruction: Optional[str] = None,
    json_mode: bool = False
) -> Optional[str]:
    """Helper to query Gemini Flash LLM."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    models = ["gemini-2.5-flash", "gemini-1.5-flash"]
    for m in models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
        payload: dict = {
            "contents": [{"parts": [{"text": prompt}]}]
        }
        if system_instruction:
            payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
        if json_mode:
            payload["generationConfig"] = {"responseMimeType": "application/json"}

        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    candidates = resp.json().get("candidates", [])
                    if candidates:
                        return candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
        except Exception as e:
            logger.warning(f"Error calling Gemini LLM {m}: {e}")
            continue

    return None


@router.post(
    "/recommend-crops",
    response_model=CropRecommendationResponse,
    status_code=status.HTTP_200_OK,
    summary="Get seasonal crop recommendations based on farm geography and soil"
)
async def recommend_crops(payload: CropRecommendationRequest):
    """
    Recommends optimal crops tailored to state, district, soil type, irrigation, and season.
    Powered by Gemini Flash with regional agronomic fallback.
    """
    farm = payload.farm_profile
    season = payload.season or get_current_agricultural_season()
    is_hindi = (payload.language or "en").strip().lower().startswith("hi")

    prompt = f"""You are Harvex AI Expert Agronomist for Indian agriculture.
Farmer Profile:
- State: {farm.state or 'Maharashtra'}
- District: {farm.district or 'Pune'}
- Soil Type: {farm.soil_type or 'Black Soil'}
- Irrigation Method: {farm.irrigation or 'Drip Irrigation'}
- Season: {season}
- Language: {payload.language}

Recommend the top 3-4 optimal crops for this region, soil texture, and season.
Return strictly valid JSON with this exact schema:
{{
  "season": "{season}",
  "crops": [
    {{
      "name": "Crop Name (e.g. Wheat / Wheat (गेहूं))",
      "name_hi": "गेहूं",
      "expected_yield": "40-45 Quintals / Hectare",
      "expected_yield_hi": "40-45 क्विंटल / हेक्टेयर",
      "ideal_water": "4-5 Irrigations (Moderate)",
      "ideal_water_hi": "4-5 सिंचाई (मध्यम पानी)",
      "reason": "Highly suitable for winter season in black/alluvial soil with drip irrigation.",
      "reason_hi": "सर्दियों में जलोढ़/काली मिट्टी और ड्रिप सिंचाई के लिए अत्यधिक उपयुक्त।"
    }}
  ]
}}
"""

    gemini_resp = await query_gemini_llm(prompt=prompt, json_mode=True)
    if gemini_resp:
        try:
            clean_text = re.sub(r"^```(?:json)?\s*", "", gemini_resp)
            clean_text = re.sub(r"\s*```$", "", clean_text)
            parsed = json.loads(clean_text)
            crops_data = parsed.get("crops", [])
            if crops_data:
                return CropRecommendationResponse(
                    season=parsed.get("season", season),
                    crops=[CropRecommendation(**c) for c in crops_data]
                )
        except Exception as parse_err:
            logger.warning(f"Failed to parse Gemini crop recommendations JSON: {parse_err}")

    # Regional Agricultural Fallback
    soil_lower = (farm.soil_type or "").lower()
    if "black" in soil_lower or "regur" in soil_lower:
        fallback_crops = [
            CropRecommendation(
                name="Wheat (Sharbati)",
                name_hi="गेहूं (शरबती)",
                expected_yield="42-48 Quintals / Ha",
                expected_yield_hi="42-48 क्विंटल / हेक्टेयर",
                ideal_water="4 Irrigations (Critical root initiation stage)",
                ideal_water_hi="4 सिंचाई (जड़ विकास और दाना भरते समय)",
                reason="Excellent moisture retention in black soil maximizes wheat grain weight.",
                reason_hi="काली मिट्टी में नमी धारण क्षमता गेहूं के दानों को ठोस और भारी बनाती है।"
            ),
            CropRecommendation(
                name="Chickpea / Bengal Gram",
                name_hi="चना (देशी / काबुली)",
                expected_yield="20-25 Quintals / Ha",
                expected_yield_hi="20-25 क्विंटल / हेक्टेयर",
                ideal_water="2-3 Light Irrigations",
                ideal_water_hi="2-3 हल्की सिंचाई",
                reason="Deep taproot utilizes subsoil moisture; enriches soil nitrogen naturally.",
                reason_hi="गहरी जड़ें उप-मिट्टी की नमी सोखती हैं और प्राकृतिक नाइट्रोजन बढ़ाती हैं।"
            ),
            CropRecommendation(
                name="Mustard / Rapeseed",
                name_hi="सरसों (पीली / काली)",
                expected_yield="18-22 Quintals / Ha",
                expected_yield_hi="18-22 क्विंटल / हेक्टेयर",
                ideal_water="2 Irrigations (Low water requirement)",
                ideal_water_hi="2 सिंचाई (कम पानी की आवश्यकता)",
                reason="High market value with low water consumption during dry winter spells.",
                reason_hi="सर्दियों में कम पानी की लागत में अधिक मुनाफा देने वाली नकदी फसल।"
            )
        ]
    elif "sandy" in soil_lower or "arid" in soil_lower or "desert" in soil_lower:
        fallback_crops = [
            CropRecommendation(
                name="Mustard (Varuna)",
                name_hi="सरसों (वरुणा)",
                expected_yield="16-20 Quintals / Ha",
                expected_yield_hi="16-20 क्विंटल / हेक्टेयर",
                ideal_water="2 Irrigations (Drip compatible)",
                ideal_water_hi="2 सिंचाई (ड्रिप सिंचाई उपयुक्त)",
                reason="Thrives in well-drained sandy loam with moderate drought resistance.",
                reason_hi="रेतीली दोमट मिट्टी में सूखा सहन करने की बेहतरीन क्षमता।"
            ),
            CropRecommendation(
                name="Barley (Jau)",
                name_hi="जौ (बारले)",
                expected_yield="30-35 Quintals / Ha",
                expected_yield_hi="30-35 क्विंटल / हेक्टेयर",
                ideal_water="3 Light Irrigations",
                ideal_water_hi="3 हल्की सिंचाई",
                reason="High salinity and drought tolerance in arid zones.",
                reason_hi="शुष्क और रेतीले क्षेत्रों में कम पानी में भरपूर उपज।"
            ),
            CropRecommendation(
                name="Chickpea (Gram)",
                name_hi="चना",
                expected_yield="18-22 Quintals / Ha",
                expected_yield_hi="18-22 क्विंटल / हेक्टेयर",
                ideal_water="2 Irrigations",
                ideal_water_hi="2 सिंचाई",
                reason="Thrives on residual moisture with low nitrogen fertilizer requirement.",
                reason_hi="हल्की नमी में कम खाद की लागत में तैयार होने वाली दलहनी फसल।"
            )
        ]
    else:  # Alluvial / Loamy Default
        fallback_crops = [
            CropRecommendation(
                name="Wheat (HD-2967 / PBW-550)",
                name_hi="गेहूं (उन्नत किस्म)",
                expected_yield="45-52 Quintals / Ha",
                expected_yield_hi="45-52 क्विंटल / हेक्टेयर",
                ideal_water="4-5 Irrigations (Crown root, flowering, milking)",
                ideal_water_hi="4-5 सिंचाई (ताज जड़, फूल व दाना अवस्था)",
                reason="Alluvial soil provides optimal nutrient balance and aeration for wheat canopy.",
                reason_hi="जलोढ़ दोमट मिट्टी गेहूं की जड़ विकास और पैदावार के लिए सर्वोत्तम है।"
            ),
            CropRecommendation(
                name="Mustard (Pusa Bold)",
                name_hi="सरसों (पूसा बोल्ड)",
                expected_yield="20-25 Quintals / Ha",
                expected_yield_hi="20-25 क्विंटल / हेक्टेयर",
                ideal_water="2 Irrigations",
                ideal_water_hi="2 सिंचाई",
                reason="High oil content and low disease vulnerability in fertile loamy soils.",
                reason_hi="उपजाऊ दोमट मिट्टी में उच्च तेल प्रतिशत और कम कीट प्रकोप।"
            ),
            CropRecommendation(
                name="Potato / Vegetables",
                name_hi="आलू / मौसमी सब्जियां",
                expected_yield="250-300 Quintals / Ha",
                expected_yield_hi="250-300 क्विंटल / हेक्टेयर",
                ideal_water="Frequent light irrigation (Every 7-10 days)",
                ideal_water_hi="नियमित हल्की सिंचाई (हर 7-10 दिन में)",
                reason="Loose alluvial loam permits unhindered tuber expansion and rapid maturation.",
                reason_hi="भुरभुरी दोमट मिट्टी कंदों के सुचारू विकास और बंपर पैदावार के लिए आदर्श है।"
            )
        ]

    return CropRecommendationResponse(season=season, crops=fallback_crops)


# ============================================================================
# Hands-free Voice Call & Text Chat Endpoints
# ============================================================================

def detect_transcript_language(transcript: str, default_lang: str = "en-IN") -> str:
    """
    Detects the language of the farmer's spoken transcript.
    Supports Devanagari (Hindi/Marathi), Kannada, Tamil, Telugu, and Hinglish.
    Returns standard BCP-47 tag ('hi-IN', 'kn-IN', 'ta-IN', 'te-IN', 'en-IN').
    """
    text = (transcript or "").strip()
    if not text:
        return default_lang or "en-IN"

    # 1. Unicode script detection
    for ch in text:
        code = ord(ch)
        if 0x0900 <= code <= 0x097F:
            return "hi-IN"
        if 0x0C80 <= code <= 0x0CFF:
            return "kn-IN"
        if 0x0B80 <= code <= 0x0BFF:
            return "ta-IN"
        if 0x0C00 <= code <= 0x0C7F:
            return "te-IN"

    # 2. Check for Hindi / Hinglish keywords in Latin script
    words = [w.strip(".,?!:;\"'") for w in text.lower().split()]
    hinglish_keywords = {
        "kya", "hai", "kaise", "mera", "tera", "naam", "pani", "khad",
        "khet", "fasal", "mitti", "namaste", "jhad", "ped", "keede",
        "rog", "dawa", "kare", "batao", "bhai", "shuru", "band"
    }
    if any(w in hinglish_keywords for w in words):
        return "hi-IN"

    # 3. Check for common English words in Latin script
    english_keywords = {
        "what", "is", "your", "name", "who", "are", "you", "how", "when",
        "why", "should", "i", "my", "plant", "crop", "water", "fertilizer",
        "give", "the", "hello", "hi", "can", "weather", "soil", "spray", "need"
    }
    if any(w in english_keywords for w in words):
        return "en-IN"

    if default_lang and default_lang.lower().startswith("hi"):
        return "hi-IN"
    if default_lang and default_lang.lower().startswith("kn"):
        return "kn-IN"
    if default_lang and default_lang.lower().startswith("ta"):
        return "ta-IN"
    if default_lang and default_lang.lower().startswith("te"):
        return "te-IN"

    return "en-IN"


def generate_dynamic_agronomic_response(
    query: str,
    farm: Optional[UserFarmProfileSchema] = None,
    sensor: Optional[Dict[str, Any]] = None,
    is_hi: bool = True,
    is_voice: bool = False,
    disease_result: Optional[Dict[str, Any]] = None,
    weather_alert: Optional[str] = None,
    season: Optional[str] = None
) -> str:
    """
    Generate dynamic, contextual agricultural responses answering the farmer's specific question.
    Handles:
      1. Identity questions (introduces Harvex without dumping sensor data)
      2. Plant disease / virus / pest queries (practical treatment advice)
      3. Fertilizer dosage questions
      4. Crop recommendation queries (tailored to soil, location, season)
      5. Irrigation / water queries (clear yes/no based on moisture)
      6. Weather questions
      7. General greetings
    """
    q_lower = query.lower()
    state = farm.state if (farm and farm.state) else "Maharashtra"
    district = farm.district if (farm and farm.district) else "Pune"
    soil = farm.soil_type if (farm and farm.soil_type) else "Black Soil"
    current_season = season or get_current_agricultural_season()

    moisture = 42.0
    temp = 28.0
    pump_on = False
    if sensor:
        moisture = float(sensor.get("soilMoisture", 42.0))
        temp = float(sensor.get("temperature", 28.0))
        pump_on = bool(sensor.get("isWatering", False))

    pump_str_hi = "चालू" if pump_on else "बंद"
    pump_str_en = "on" if pump_on else "off"

    # 1. Identity questions ("what is your name", "who are you", "तेरा नाम क्या है")
    identity_keywords = [
        "who are you", "what is your name", "what's your name", "your name",
        "who created you", "who made you", "introduce yourself",
        "तेरा नाम", "तुम्हारा नाम", "आपका नाम", "तू कौन", "तुम कौन", "आप कौन",
        "नाम क्या", "tera naam", "aapka naam", "tum kaun", "tu kaun"
    ]
    if any(w in q_lower for w in identity_keywords):
        if is_hi:
            return "मेरा नाम हार्वेक्स है — आपका AI खेती सहायक। मैं आपकी फसलों, खाद, सिंचाई और खेती से जुड़े सभी सवालों में मदद करता हूँ।"
        else:
            return "I am Harvex, your AI farming assistant. I am here to help you with crop advice, soil health, and farm questions."

    # 2. Plant disease / virus / pest questions
    # E.g. "अभी मेरे झाड़ को अगर कुछ वायरस हुआ है तो मुझे उसे क्या देना चाहिए? फर्टिलाइजर।"
    disease_keywords = [
        "virus", "disease", "blight", "fungus", "pest", "sick", "infection", "rot",
        "वायरस", "बीमारी", "रोग", "कीड़ा", "कीट", "फफूंद", "झुलसा", "धब्बा", "पत्ती", "झाड़", "पेड़", "पौधा",
        "jhad", "paudha", "keeda", "bimar"
    ]
    fertilizer_keywords = [
        "fertilizer", "npk", "urea", "dap", "potash", "compost", "manure",
        "खाद", "उर्वरक", "यूरिया", "डीएपी", "पोटाश", "फर्टिलाइजर", "गोबर", "कंपोस्ट",
        "khad", "dawa"
    ]

    has_disease_kw = any(w in q_lower for w in disease_keywords)
    has_fert_kw = any(w in q_lower for w in fertilizer_keywords)

    if has_disease_kw:
        # Case 2A: Farmer asks about fertilizer/medicine for a virus or sick plant
        if has_fert_kw or any(w in q_lower for w in ["क्या देना", "क्या डालना", "what should i give", "what to give"]):
            if is_hi:
                return "अगर पौधे में वायरस या बीमारी के लक्षण हैं, तो रासायनिक उर्वरक डालने से बचें। पहले संक्रमित पत्तियों को हटाकर नष्ट करें, और 5 मिली नीम तेल या कॉपर ऑक्सीक्लोराइड (2 ग्राम प्रति लीटर पानी) का छिड़काव करें।"
            else:
                return "If your plant has a virus or infection, avoid applying chemical fertilizers right now. First prune and dispose of infected leaves, then spray neem oil (5ml/L) or a copper fungicide (2g/L water)."

        # Case 2B: Referencing recent disease detection if available
        if disease_result and disease_result.get("disease_class") not in {"Healthy", "uncertain", None}:
            d_class = disease_result.get("disease_class", "disease")
            adv_hi = disease_result.get("advisory_hi")
            adv_en = disease_result.get("advisory")
            if is_hi:
                return f"हालिया जांच में {d_class} के लक्षण मिले हैं। {adv_hi or 'प्रभावित पत्तियों को अलग करें और कॉपर फफूंदनाशक या नीम तेल (5 मिली/लीटर) का छिड़काव करें।'}"
            else:
                return f"Recent scan detected {d_class}. Recommendation: {adv_en or 'Remove infected leaves and apply neem oil or copper oxychloride fungicide.'}"

        # General disease/pest advice
        if is_hi:
            return "फसल में बीमारी या कीट नियंत्रण के लिए 5 मिली नीम का तेल प्रति लीटर पानी में मिलाकर छिड़काव करें। यदि फफूंद अधिक है तो कॉपर ऑक्सीक्लोराइड (2 ग्राम/लीटर) का प्रयोग करें और नजदीकी कृषि विज्ञान केंद्र (KVK) से सलाह लें।"
        else:
            return "For pest and disease control, spray neem oil at 5ml per liter of water. For severe fungal spread, apply a copper-based fungicide and consult your local Krishi Vigyan Kendra (KVK)."

    # 3. Fertilizer questions
    if has_fert_kw:
        if is_hi:
            return f"{soil} के लिए 4:2:1 का NPK अनुपात आदर्श है। बुवाई के समय डीएपी और पोटाश डालें, तथा सिंचाई के बाद ही यूरिया की टॉप ड्रेसिंग करें।"
        else:
            return f"For {soil} in {district}, a balanced NPK ratio of 4:2:1 is recommended. Apply DAP and potash at the base during sowing, and top-dress with nitrogen during irrigation."

    # 4. Crop recommendation questions
    crop_keywords = [
        "crop", "plant", "sow", "yield", "recommend", "best crop", "which crop",
        "फसल", "बोना", "बुवाई", "उपज", "अनुशंसा", "सिफारिश", "कौन सी फसल", "क्या लगाएं", "क्या बोएं",
        "fasal"
    ]
    if any(w in q_lower for w in crop_keywords):
        if is_hi:
            return f"{district}, {state} की {soil} और {current_season} के अनुसार गेहूं (शरबती), चना और सरसों की बुवाई सबसे उपयुक्त है। ये फसलें कम पानी में भरपूर पैदावार देती हैं।"
        else:
            return f"For {soil} in {district}, {state} during {current_season}, optimal crops include Wheat (Sharbati), Chickpea, and Mustard. These offer high yield potential with your irrigation setup."

    # 5. Irrigation / Moisture / Water questions
    water_keywords = [
        "irrigate", "irrigation", "water", "moisture", "dry", "pump",
        "सिंचाई", "पानी", "नमी", "पंप", "सूखा", "गीला", "पानी कब देना",
        "pani", "sinchai"
    ]
    if any(w in q_lower for w in water_keywords):
        if moisture < 30.0:
            if is_hi:
                return f"वर्तमान में {district} में मिट्टी की नमी {moisture:.0f}% है, जो 30% के सुरक्षित स्तर से कम है। हाँ, आपको तुरंत ड्रिप सिंचाई चालू करनी चाहिए।"
            else:
                return f"Current soil moisture in {district} is {moisture:.0f}%, which is below the 30% threshold. Yes, turning on irrigation now is strongly recommended."
        else:
            if is_hi:
                return f"आपके खेत में वर्तमान मिट्टी की नमी {moisture:.0f}% है और पंप {pump_str_hi} है। मिट्टी में पर्याप्त नमी है, इसलिए आज सिंचाई करने की आवश्यकता नहीं है।"
            else:
                return f"Your field currently has {moisture:.0f}% soil moisture and pump is {pump_str_en}. Moisture is adequate, so no irrigation is needed today."

    # 6. Weather / Rain questions
    weather_keywords = [
        "weather", "rain", "forecast", "temperature", "storm", "climate",
        "मौसम", "बारिश", "बरसात", "तापमान", "वर्षा", "आंधी",
        "mausam", "barish"
    ]
    if any(w in q_lower for w in weather_keywords):
        if weather_alert and "rain" in weather_alert.lower():
            if is_hi:
                return f"मौसम पूर्वानुमान: {weather_alert}। बारिश की संभावना को देखते हुए आज सिंचाई और कीटनाशक छिड़काव रोक दें।"
            else:
                return f"Weather alert: {weather_alert}. Given the rain forecast, hold off on irrigation and chemical spraying today."
        else:
            if is_hi:
                return f"वर्तमान तापमान {temp:.0f}°C है और मौसम साफ है। बारिश की कोई चेतावनी नहीं है, खेत के कार्य सामान्य रूप से जारी रख सकते हैं।"
            else:
                return f"Current temperature is {temp:.0f}°C with clear conditions. No rain is expected, and field operations can proceed normally."

    # 7. General greetings
    greeting_keywords = [
        "hi", "hello", "hey", "namaste", "good morning", "good evening",
        "नमस्ते", "नमस्कार", "प्रणाम", "राम राम", "हाय", "हेलो"
    ]
    if any(w in q_lower for w in greeting_keywords):
        if is_hi:
            return "नमस्ते किसान साथी! मैं हार्वेक्स हूँ, आपका AI खेती सहायक। आपके खेत की स्थिति सामान्य है। आज मैं आपकी क्या सहायता कर सकता हूँ?"
        else:
            return "Hello! I am Harvex, your AI farming assistant. Your field vitals are currently stable. How can I help you today?"

    # 8. General fallback (never dumps sensor moisture unless asked)
    if is_hi:
        return "मैं हार्वेक्स, आपका AI खेती सहायक हूँ। आप मुझसे फसल रोग व उपचार, खाद, सिंचाई, मौसम या फसल चयन के बारे में कोई भी प्रश्न पूछ सकते हैं।"
    else:
        return "I am Harvex, your AI farming assistant. Feel free to ask me about crop diseases and treatments, fertilizer dosage, irrigation, or weather."


@router.post(
    "/chat-voice",
    response_model=VoiceChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Hands-free voice conversation endpoint with Sarvam AI audio synthesis"
)
async def chat_voice(payload: VoiceChatRequest):
    """
    Handles live spoken dialogue from farmers.
    Validates transcript, queries Gemini Flash for agronomic advice, and synthesizes Indic voice via Sarvam AI.
    """
    user_transcript = (payload.transcript or payload.message or "").strip()
    
    # 1. Transcript validation: if empty or < 2 chars, ignore
    if len(user_transcript) < 2:
        logger.info(f"Ignoring empty/short voice transcript: '{user_transcript}' (<2 chars)")
        return VoiceChatResponse(
            text="",
            reply_text="",
            voice_audio_base64=None,
            audio_base64=None,
            language=payload.language or "hi",
            ignored=True,
            fallback=False
        )

    is_hi = (payload.language or "hi").strip().lower().startswith("hi")
    farm = payload.farm_profile
    sensor = payload.sensor_context or {}

    farm_desc = ""
    if farm:
        farm_desc = f"Farmer Profile: State: {farm.state}, District: {farm.district}, Soil: {farm.soil_type}, Irrigation: {farm.irrigation}."
    
    live = get_latest_sensor_data()
    if live.get("updated_at"):
        sensor_desc = f"Current Farm Vitals (Live NodeMCU ESP8266): Soil Moisture: {live.get('soil_moisture_pct')}%, Temp: {live.get('temperature_c')}°C, Humidity: {live.get('humidity_pct')}%, Pump: {live.get('pump_status', 'off')}."
    elif sensor:
        sensor_desc = f"Current Farm Vitals: Soil Moisture: {sensor.get('soilMoisture', 42)}%, Temp: {sensor.get('temperature', 28)}°C, Watering: {sensor.get('isWatering', False)}."
    else:
        sensor_desc = ""

    sys_prompt = f"""You are Harvex AI Agronomist on a real-time hands-free voice phone call with a farmer.
{farm_desc}
{sensor_desc}
Language: {'Hindi (हिंदी)' if is_hi else 'English'}.
Answer the farmer's question directly, practically, and concisely (2-3 short sentences maximum).
"""

    gemini_reply = await query_gemini_llm(
        prompt=user_transcript,
        system_instruction=sys_prompt
    )
    logger.info(f"Gemini raw response text: '{gemini_reply}'")

    reply_text = gemini_reply or generate_dynamic_agronomic_response(
        query=user_transcript,
        farm=farm,
        sensor=sensor,
        is_hi=is_hi,
        is_voice=True
    )

    # Synthesize Voice using Sarvam AI (model bulbul:v3 / bulbul:v2)
    target_lang = "hi-IN" if is_hi else "en-IN"
    audios = await sarvam.text_to_speech(
        inputs=[reply_text],
        target_language_code=target_lang,
        speaker="ritu",
        model="bulbul:v3"
    )

    audio_base64 = audios[0] if (audios and len(audios[0].strip()) > 100) else None
    has_audio = audio_base64 is not None

    if not has_audio:
        logger.warning(f"Sarvam AI TTS returned empty/error audio for '{reply_text[:50]}...'. Returning text with fallback=True")
    else:
        logger.info(f"✅ Sarvam AI TTS synthesized audio successfully ({len(audio_base64)} chars)")

    return VoiceChatResponse(
        text=reply_text,
        reply_text=reply_text,
        voice_audio_base64=audio_base64,
        audio_base64=audio_base64,
        language=payload.language or "hi",
        ignored=False,
        fallback=not has_audio
    )


@router.post(
    "/chat",
    response_model=TextChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Text chat agronomy assistant endpoint"
)
@router.post(
    "/chat-text",
    response_model=TextChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Text chat agronomy assistant endpoint (alias)"
)
async def chat_text(payload: TextChatRequest):
    """
    Handles text chat queries dynamically tailored to state, district, soil type, and live telemetry.
    """
    is_hi = (payload.language or "en").strip().lower().startswith("hi")
    farm = payload.farm_profile
    sensor = payload.sensor_context or {}

    farm_desc = ""
    if farm:
        farm_desc = f"Farmer Profile: State: {farm.state}, District: {farm.district}, Soil: {farm.soil_type}, Irrigation: {farm.irrigation}."
    
    live = get_latest_sensor_data()
    if live.get("updated_at"):
        sensor_desc = f"Current Farm Vitals (Live NodeMCU ESP8266): Soil Moisture: {live.get('soil_moisture_pct')}%, Temp: {live.get('temperature_c')}°C, Humidity: {live.get('humidity_pct')}%, Pump: {live.get('pump_status', 'off')}."
    elif sensor:
        sensor_desc = f"Current Farm Vitals: Soil Moisture: {sensor.get('soilMoisture', 42)}%, Temp: {sensor.get('temperature', 28)}°C, Watering: {sensor.get('isWatering', False)}."
    else:
        sensor_desc = ""

    sys_prompt = f"""You are Harvex AI Assistant, an expert agricultural advisor for Indian farmers.
{farm_desc}
{sensor_desc}
Language: {'Hindi (हिंदी)' if is_hi else 'English'}.
Provide structured, clear, direct, and actionable advice answering the farmer's specific query.
"""

    gemini_reply = await query_gemini_llm(
        prompt=payload.message,
        system_instruction=sys_prompt
    )

    reply_text = gemini_reply or generate_dynamic_agronomic_response(
        query=payload.message,
        farm=farm,
        sensor=sensor,
        is_hi=is_hi,
        is_voice=False
    )

    return TextChatResponse(
        reply=reply_text,
        language=payload.language or "en"
    )



@router.post(
    "/voice-query",
    response_model=VoiceQueryResponse,
    status_code=status.HTTP_200_OK,
    summary="MediaRecorder + Sarvam STT voice pipeline endpoint"
)
async def voice_query(payload: VoiceQueryRequest):
    """
    Receives a transcript already produced by Sarvam STT on the frontend.
    Returns:
      - response_text  : Gemini agronomic answer
      - response_audio_base64 : Sarvam TTS WAV (base64), or null on failure
      - action_taken   : optional string if a pump/alert action was triggered
    """
    user_transcript = payload.transcript.strip()
    if len(user_transcript) < 2:
        logger.info(f"[voice-query] Ignoring short transcript: '{user_transcript}'")
        return VoiceQueryResponse(
            response_text="",
            response_audio_base64=None,
            action_taken=None
        )

    # 1. Detect language from transcript itself
    detected_lang = detect_transcript_language(user_transcript, payload.language)
    is_hi = detected_lang.startswith("hi")
    is_kn = detected_lang.startswith("kn")
    is_ta = detected_lang.startswith("ta")
    is_te = detected_lang.startswith("te")
    target_lang = detected_lang

    if is_hi:
        language_label = "Hindi (हिंदी)"
    elif is_kn:
        language_label = "Kannada (ಕನ್ನಡ)"
    elif is_ta:
        language_label = "Tamil (தமிழ்)"
    elif is_te:
        language_label = "Telugu (తెలుగు)"
    else:
        language_label = "English"

    # 2. Fetch sensor, disease, weather and location context
    live = get_latest_sensor_data()
    if live.get("updated_at"):
        soil_moisture_pct = float(live.get("soil_moisture_pct", 50.0))
        temperature_c = float(live.get("temperature_c", 24.0))
        humidity_pct = float(live.get("humidity_pct", 68.0))
        pump_status = str(live.get("pump_status", "off"))
    else:
        try:
            latest = database.get_latest_sensor_reading(payload.device_id)
        except Exception:
            latest = {}
        soil_moisture_pct = float(latest.get("soil_moisture_pct", 42.0))
        temperature_c = float(latest.get("temperature_c", 28.5))
        humidity_pct = float(latest.get("humidity_pct", 61.0))
        pump_status = str(latest.get("pump_status", "off"))

    # Disease detection
    try:
        latest_disease = database.get_latest_disease_detection(payload.device_id)
    except Exception:
        latest_disease = {}

    disease_class = latest_disease.get("disease_class", "Healthy")
    disease_confidence = float(latest_disease.get("confidence", 0.0))
    advisory = latest_disease.get("advisory", "")
    if disease_class and disease_class.lower() not in {"healthy", "uncertain"}:
        disease_result = f"{disease_class} (confidence: {disease_confidence:.0%}): {advisory}"
    else:
        disease_result = "No active disease detected (healthy leaf)"

    # Crop health score
    try:
        crop_health_score = decision.compute_crop_health_score(soil_moisture_pct, latest_disease)
    except Exception:
        crop_health_score = "Healthy"

    # Weather alert
    try:
        rain_prob, rain_expected = weather.get_rain_forecast()
        if rain_expected:
            weather_alert = f"Rain expected in the next 6 hours (probability {rain_prob * 100:.0f}%)"
        else:
            weather_alert = "None (clear weather)"
    except Exception:
        rain_expected = False
        weather_alert = "None (clear weather)"

    location = "Pune, Maharashtra"
    soil_type = "Black Soil (Regur)"
    season = get_current_agricultural_season()

    # 3. Build system prompt instructing LLM to use sensor data ONLY when relevant
    system_prompt = f"""You are Harvex, an AI farming assistant for Indian farmers. 
Your name is Harvex. You are helpful, friendly, and speak like a knowledgeable 
local agricultural expert — not a robot reading out sensor data.

You have access to the farmer's current field data:
- Soil moisture: {soil_moisture_pct:.0f}%
- Temperature: {temperature_c:.0f}°C  
- Humidity: {humidity_pct:.0f}%
- Pump status: {pump_status}
- Crop health score: {crop_health_score}
- Location: {location}
- Soil type: {soil_type}
- Weather alert: {weather_alert}
- Last disease detection: {disease_result}

Use this data ONLY when it is relevant to the farmer's question.
If the farmer asks who you are, just introduce yourself simply.
If the farmer asks about crop disease or treatment, give specific practical advice.
If the farmer asks about fertilizer for a sick plant, recommend specific treatments.
If the farmer asks about the best crop, use their location, soil type and season.
If the farmer asks about soil or water, reference the sensor data.
Do NOT dump all sensor data into every response — only mention what's relevant.
Always respond in the same language the farmer used: {language_label}.
Keep responses short — 2-3 sentences max — this will be spoken aloud.
No bullet points, no headers, no markdown in the response text.
"""

    # 4. Generate Gemini response with tailored agronomic fallback
    gemini_reply = await query_gemini_llm(prompt=user_transcript, system_instruction=system_prompt)
    sensor_map = {
        "soilMoisture": soil_moisture_pct,
        "temperature": temperature_c,
        "humidity": humidity_pct,
        "isWatering": pump_status.lower() == "on",
    }
    farm_schema = UserFarmProfileSchema(
        state="Maharashtra",
        district="Pune",
        soil_type=soil_type,
        irrigation="Drip Irrigation"
    )
    reply_text = (gemini_reply or "").strip() or generate_dynamic_agronomic_response(
        query=user_transcript,
        farm=farm_schema,
        sensor=sensor_map,
        is_hi=is_hi,
        is_voice=True,
        disease_result=latest_disease,
        weather_alert=weather_alert if rain_expected else None,
        season=season
    )
    logger.info(f"[voice-query] Generated reply for language={detected_lang}: '{reply_text[:60].encode('ascii', 'backslashreplace').decode('ascii')}...'")

    # 5. Synthesise reply via Sarvam AI TTS
    action_taken: str | None = None
    audio_b64: str | None = None
    try:
        audios = await sarvam.text_to_speech(
            inputs=[reply_text],
            target_language_code=target_lang,
            speaker="ritu",
            model="bulbul:v3"
        )
        raw = (audios[0] if audios else "").strip()
        if len(raw) > 100:
            audio_b64 = raw
            logger.info(f"[voice-query] ✅ Sarvam TTS success ({len(raw)} chars)")
        else:
            logger.warning("[voice-query] ⚠️ Sarvam TTS returned empty audio — falling back to bulbul:v2")
            audios2 = await sarvam.text_to_speech(
                inputs=[reply_text],
                target_language_code=target_lang,
                speaker="anushka",
                model="bulbul:v2"
            )
            raw2 = (audios2[0] if audios2 else "").strip()
            audio_b64 = raw2 if len(raw2) > 100 else None
    except Exception as e:
        logger.error(f"[voice-query] Sarvam TTS error: {e}")

    return VoiceQueryResponse(
        response_text=reply_text,
        response_audio_base64=audio_b64,
        action_taken=action_taken
    )


@router.post(
    "/sarvam/stt",
    summary="Direct Sarvam AI Speech-to-Text transcription"
)
async def sarvam_stt(
    file: UploadFile = File(..., description="Audio recording file (webm, wav, etc.)"),
    language: str = Form(default="hi-IN", description="Language code")
):
    try:
        audio_bytes = await file.read()
        if not audio_bytes:
            return {"transcript": "", "language": language}
        fname = file.filename or "voice_input.webm"
        ctype = file.content_type or "audio/webm"
        transcript = await sarvam.speech_to_text(
            file_bytes=audio_bytes,
            language_code=language,
            filename=fname,
            content_type=ctype
        )
        return {"transcript": transcript, "language": language}
    except Exception as e:
        logger.error(f"Error during Sarvam STT: {e}")
        return {"transcript": "", "error": str(e), "language": language}


@router.post(
    "/sarvam/voice",
    summary="Direct Sarvam AI voice processing (STT + Gemini agronomic reply + TTS audio)"
)
async def sarvam_voice(
    file: UploadFile = File(..., description="Audio recording file (webm, wav, etc.)"),
    language: str = Form(default="hi-IN", description="Language code"),
    device_id: str = Form(default="harvex-node-1", description="Device ID")
):
    try:
        audio_bytes = await file.read()
        if not audio_bytes:
            return {"transcript": "", "response_text": "", "response_audio_base64": None}

        fname = file.filename or "voice_input.webm"
        ctype = file.content_type or "audio/webm"
        transcript = await sarvam.speech_to_text(
            file_bytes=audio_bytes,
            language_code=language,
            filename=fname,
            content_type=ctype
        )
        logger.info(f"[sarvam/voice] Transcribed audio ({len(audio_bytes)} bytes, {ctype}) -> '{transcript}'")
        if not transcript.strip():
            logger.warning("[sarvam/voice] Transcribed audio yielded empty transcript")
            return {"transcript": "", "response_text": "", "response_audio_base64": None}

        query_payload = VoiceQueryRequest(
            device_id=device_id,
            transcript=transcript,
            language=language
        )
        result = await voice_query(query_payload)
        return {
            "transcript": transcript,
            "response_text": result.response_text,
            "response_audio_base64": result.response_audio_base64
        }
    except Exception as e:
        logger.error(f"Error during Sarvam Voice: {e}")
        return {"transcript": "", "error": str(e), "response_text": "", "response_audio_base64": None}


