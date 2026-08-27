from typing import Optional, Literal, List, Dict, Any
from pydantic import BaseModel, Field, field_validator


class SensorDataPayload(BaseModel):
    """Payload sent by ESP32 field nodes to report telemetry."""
    device_id: str = Field(..., min_length=1, description="Unique identifier for the field node, e.g., 'harvex-node-1'")
    timestamp: str = Field(..., min_length=1, description="ISO 8601 timestamp of measurement")
    soil_moisture_pct: float = Field(..., ge=0.0, le=100.0, description="Volumetric soil moisture percentage (0-100)")
    temperature_c: float = Field(..., description="Ambient temperature in degrees Celsius")
    humidity_pct: float = Field(..., ge=0.0, le=100.0, description="Relative humidity percentage (0-100)")
    pump_status: str = Field(..., description="Current status of the water pump ('on' or 'off')")

    @field_validator("pump_status")
    @classmethod
    def validate_pump_status(cls, v: str) -> str:
        v_clean = v.strip().lower()
        if v_clean not in {"on", "off"}:
            raise ValueError("pump_status must be either 'on' or 'off'")
        return v_clean


class SensorDataResponse(BaseModel):
    """Response returned upon successfully receiving sensor telemetry."""
    status: str = "received"


class PumpCommandResponse(BaseModel):
    """Command response polled by ESP32 node to control pump relay and LCD display."""
    pump_command: Literal["on", "off"]
    max_runtime_seconds: int
    display_message: str


class DiseaseDetectionResponse(BaseModel):
    """Diagnostic response for leaf image classification."""
    disease_class: str
    confidence: float
    advisory: str
    advisory_hi: Optional[str] = None
    voice_audio_base64: Optional[str] = None


class StatusResponse(BaseModel):
    """Comprehensive real-time farm status polled by farmer-facing Web UI."""
    device_id: str
    soil_moisture_pct: float
    temperature_c: float
    humidity_pct: float
    pump_status: str
    last_watered: Optional[str] = None
    rain_expected: bool
    crop_health_score: Literal[
        "Healthy",
        "Needs Water",
        "Disease Risk",
        "Needs Water + Disease Risk"
    ]
    last_disease_result: DiseaseDetectionResponse
    voice_audio_base64: Optional[str] = None


class VoiceSynthesizeRequest(BaseModel):
    """Payload for text-to-speech synthesis using Sarvam AI."""
    text: str = Field(..., min_length=1, description="Text string to synthesize into speech")
    language: str = Field(default="hi", description="Target language ('hi' or 'en')")
    speaker: Optional[str] = Field(default="meera", description="Sarvam voice speaker persona ('meera', 'arvind', etc.)")


class VoiceSynthesizeResponse(BaseModel):
    """Audio base64 response from Sarvam AI TTS."""
    audio_base64: str
    language: str


class VoiceTranscribeResponse(BaseModel):
    """Transcription response from Sarvam AI STT."""
    transcript: str
    language: str


# ============================================================================
# Farm Profile, Crop Recommendations & Interactive Chat Schemas
# ============================================================================

class UserFarmProfileSchema(BaseModel):
    """Farm geography, soil texture, and irrigation infrastructure."""
    state: str = Field(default="", description="State in India, e.g., 'Maharashtra'")
    district: str = Field(default="", description="District name, e.g., 'Pune'")
    soil_type: str = Field(default="", description="Soil texture type, e.g., 'Black Soil (Regur)'")
    irrigation: Optional[str] = Field(default="Drip Irrigation", description="Irrigation method")


class CropRecommendation(BaseModel):
    """Individual recommended crop details."""
    name: str = Field(..., description="Crop name in English (e.g. Wheat)")
    name_hi: Optional[str] = Field(default=None, description="Crop name in Hindi (e.g. गेहूं)")
    expected_yield: str = Field(..., description="Estimated yield per acre/hectare")
    expected_yield_hi: Optional[str] = Field(default=None, description="Yield in Hindi")
    ideal_water: str = Field(..., description="Water and irrigation frequency requirement")
    ideal_water_hi: Optional[str] = Field(default=None, description="Water requirement in Hindi")
    reason: str = Field(..., description="Suitability explanation based on soil and climate")
    reason_hi: Optional[str] = Field(default=None, description="Suitability explanation in Hindi")


class CropRecommendationRequest(BaseModel):
    """Request payload for Gemini-powered seasonal crop recommendations."""
    farm_profile: UserFarmProfileSchema
    month: Optional[str] = None
    season: Optional[str] = None
    language: Optional[str] = "en"


class CropRecommendationResponse(BaseModel):
    """Structured response containing seasonal crop recommendations."""
    season: str
    crops: List[CropRecommendation]


class VoiceChatRequest(BaseModel):
    """Payload for hands-free interactive voice calls."""
    message: Optional[str] = Field(default="", description="Transcribed spoken query from farmer")
    transcript: Optional[str] = Field(default="", description="Alias for message")
    language: Optional[str] = Field(default="hi", description="Language preference ('hi' or 'en')")
    farm_profile: Optional[UserFarmProfileSchema] = None
    sensor_context: Optional[Dict[str, Any]] = None


class VoiceChatResponse(BaseModel):
    """Response containing assistant text reply and synthesized Sarvam AI voice audio."""
    text: Optional[str] = ""
    reply_text: Optional[str] = ""
    voice_audio_base64: Optional[str] = None
    audio_base64: Optional[str] = None
    language: str = "hi"
    ignored: Optional[bool] = False
    fallback: Optional[bool] = False


class TextChatRequest(BaseModel):
    """Payload for text-based agronomy assistant chat."""
    message: str = Field(..., min_length=1, description="Farmer text query")
    language: Optional[str] = Field(default="en", description="Language ('en' or 'hi')")
    farm_profile: Optional[UserFarmProfileSchema] = None
    sensor_context: Optional[Dict[str, Any]] = None


class TextChatResponse(BaseModel):
    """Response text from agronomy assistant."""
    reply: str
    language: str


# ============================================================================
# Voice Query — new MediaRecorder + Sarvam STT frontend pipeline
# ============================================================================

class VoiceQueryRequest(BaseModel):
    """
    Payload sent by the frontend after Sarvam STT has produced a transcript.
    Shape: { device_id, transcript, language }
    """
    device_id: str = Field(default="harvex-node-1", description="Field node identifier")
    transcript: str = Field(..., min_length=1, description="Text transcribed from farmer's speech")
    language: str   = Field(default="en-IN", description="BCP-47 language code e.g. 'en-IN', 'hi-IN'")


class VoiceQueryResponse(BaseModel):
    """
    Response returned to the frontend voice pipeline.
    Shape: { response_text, response_audio_base64, action_taken }
    """
    response_text: str
    response_audio_base64: Optional[str] = None
    action_taken: Optional[str] = None
