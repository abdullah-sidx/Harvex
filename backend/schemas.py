from typing import Optional, Literal, List, Dict, Any
from pydantic import BaseModel, Field, field_validator, model_validator


class SensorDataPayload(BaseModel):
    """Payload sent by ESP32 / Arduino field nodes to report telemetry."""
    device_id: Optional[str] = Field(default="harvex-node-1", description="Unique identifier for the field node")
    timestamp: Optional[str] = Field(default=None, description="ISO 8601 timestamp of measurement")

    # Support both 'soil_moisture' and 'soil_moisture_pct'
    soil_moisture: Optional[float] = Field(default=None, description="Volumetric soil moisture percentage")
    soil_moisture_pct: Optional[float] = Field(default=None, description="Volumetric soil moisture percentage")

    # Support both 'temperature' and 'temperature_c'
    temperature: Optional[float] = Field(default=None, description="Ambient temperature in degrees Celsius")
    temperature_c: Optional[float] = Field(default=None, description="Ambient temperature in degrees Celsius")

    # Support both 'humidity' and 'humidity_pct'
    humidity: Optional[float] = Field(default=None, description="Relative humidity percentage")
    humidity_pct: Optional[float] = Field(default=None, description="Relative humidity percentage")

    pump_status: Optional[str] = Field(default="off", description="Current status of the water pump ('on' or 'off')")

    @model_validator(mode="after")
    def validate_telemetry_fields(self):
        # Resolve soil moisture
        sm = self.soil_moisture if self.soil_moisture is not None else self.soil_moisture_pct
        if sm is None:
            raise ValueError("Field 'soil_moisture' or 'soil_moisture_pct' is required")
        if not (0.0 <= sm <= 100.0):
            raise ValueError("Soil moisture must be between 0.0 and 100.0")

        # Resolve temperature
        tc = self.temperature if self.temperature is not None else self.temperature_c
        if tc is None:
            raise ValueError("Field 'temperature' or 'temperature_c' is required")

        # Resolve humidity
        hp = self.humidity if self.humidity is not None else self.humidity_pct
        if hp is None:
            raise ValueError("Field 'humidity' or 'humidity_pct' is required")
        if not (0.0 <= hp <= 100.0):
            raise ValueError("Humidity must be between 0.0 and 100.0")

        # Resolve pump status
        ps = (self.pump_status or "off").strip().lower()
        if ps not in {"on", "off"}:
            raise ValueError("pump_status must be either 'on' or 'off'")

        # Normalize attributes
        object.__setattr__(self, "soil_moisture", sm)
        object.__setattr__(self, "soil_moisture_pct", sm)
        object.__setattr__(self, "temperature", tc)
        object.__setattr__(self, "temperature_c", tc)
        object.__setattr__(self, "humidity", hp)
        object.__setattr__(self, "humidity_pct", hp)
        object.__setattr__(self, "pump_status", ps)
        return self


class SensorDataResponse(BaseModel):
    """Response returned upon successfully receiving sensor telemetry."""
    status: str = "success"


class PumpToggleRequest(BaseModel):
    """Payload sent by web frontend to toggle water pump."""
    state: Literal["on", "off"]
    duration_seconds: Optional[int] = 30
    triggered_by: Optional[str] = "WEBSITE"


class PumpToggleResponse(BaseModel):
    """Response returned after processing pump toggle command."""
    status: str = "success"
    pump_command: str
    display_message: str
    history_entry: Optional[Dict[str, Any]] = None


class PumpHistoryItem(BaseModel):
    """Model representing an irrigation event."""
    id: str
    timestamp: str
    action: str
    triggered_by: str
    duration_seconds: int


class PumpCommandResponse(BaseModel):
    """Command response polled by ESP32 / NodeMCU node to control pump relay and LCD display."""
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
