# Harvex Backend — AI Smart Farming Assistant (SIH26180)

FastAPI backend service for Harvex field telemetry, weather fusion, Vision Transformer plant disease classification, and automated irrigation control.

---

## 🌾 System Architecture & Features

1. **Exact Shared API Contract**:
   - `POST /api/sensor-data`: Ingests field telemetry from ESP32 nodes every 5–10s.
   - `GET /api/pump-command?device_id=harvex-node-1`: Issues irrigation pump relay commands and LCD display status.
   - `POST /api/detect-disease`: Classifies farmer leaf photos using a pretrained Vision Transformer (`kimcomehome/plantvillage-vit-leaf-disease`), returning disease diagnosis and agronomy advisories.
   - `GET /api/status?device_id=harvex-node-1`: Aggregates live sensor telemetry, weather forecasts, and disease diagnoses into a holistic `crop_health_score`.

2. **Decision & Fusion Logic**:
   - `water_needed = soil_moisture_pct < DRY_THRESHOLD (30%)`
   - `rain_expected = weather_api.rain_probability > RAIN_THRESHOLD (0.5)`
   - `pump_on = water_needed AND NOT rain_expected`
   - `crop_health_score`: `"Healthy"` | `"Needs Water"` | `"Disease Risk"` | `"Needs Water + Disease Risk"`

3. **Weather Integration**:
   - Zero-configuration live weather integration using Open-Meteo with OpenWeatherMap support.
   - 10-minute in-memory caching to avoid redundant external network calls.
   - Fail-safe fallback: Defaults `rain_expected = False` on API outage to prevent crop dehydration.

4. **Persistence**:
   - Embedded SQLite storage (`harvex.db`) tracking latest telemetry, historical logs, device irrigation state (`last_watered`), and disease detections.

5. **CORS & Robust Error Handling**:
   - Cross-Origin Resource Sharing enabled for web dashboards and development servers.
   - Malformed sensor payloads rejected with clear HTTP 400 errors.
   - Corrupted or low-confidence leaf photos gracefully return `disease_class: "uncertain"` instead of 500 errors.

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
pip install -r backend/requirements.txt
```

### 2. Run the FastAPI Server

```bash
# From the project root:
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Or from the backend directory:
cd backend
python main.py
```

The interactive API documentation (Swagger UI) is available at:
`http://localhost:8000/docs`

---

## 🧪 Example `curl` Commands for Testing Endpoints

### 1. POST Telemetry (`/api/sensor-data`)
```bash
curl -X POST "http://localhost:8000/api/sensor-data" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "harvex-node-1",
    "timestamp": "2026-08-26T10:15:00Z",
    "soil_moisture_pct": 42.0,
    "temperature_c": 28.5,
    "humidity_pct": 61.0,
    "pump_status": "off"
  }'
```

**Expected Response:**
```json
{
  "status": "received"
}
```

---

### 2. Poll Pump Command (`/api/pump-command`)
```bash
curl -X GET "http://localhost:8000/api/pump-command?device_id=harvex-node-1"
```

**Expected Response (Moisture Optimal):**
```json
{
  "pump_command": "off",
  "max_runtime_seconds": 0,
  "display_message": "Soil moisture optimal"
}
```

**Expected Response (Dry Soil, No Rain):**
```json
{
  "pump_command": "on",
  "max_runtime_seconds": 30,
  "display_message": "Watering: dry soil"
}
```

---

### 3. Upload Leaf Photo for Disease Detection (`/api/detect-disease`)
```bash
curl -X POST "http://localhost:8000/api/detect-disease" \
  -F "image=@/path/to/leaf_photo.jpg"
```

**Expected Response (Confident Detection):**
```json
{
  "disease_class": "Early Blight",
  "confidence": 0.87,
  "advisory": "Possible early blight detected. Remove affected leaves and avoid overhead watering."
}
```

**Expected Response (Low Confidence / Non-Leaf / Unclear Photo):**
```json
{
  "disease_class": "uncertain",
  "confidence": 0.31,
  "advisory": "Photo unclear or non-leaf image detected — please upload a clear, close-up photo of a plant leaf."
}
```

---

### 4. Fetch Live Farm Status (`/api/status`)
```bash
curl -X GET "http://localhost:8000/api/status?device_id=harvex-node-1"
```

**Expected Response:**
```json
{
  "device_id": "harvex-node-1",
  "soil_moisture_pct": 42.0,
  "temperature_c": 28.5,
  "humidity_pct": 61.0,
  "pump_status": "off",
  "last_watered": "2026-08-26T09:40:00Z",
  "rain_expected": false,
  "crop_health_score": "Healthy",
  "last_disease_result": {
    "disease_class": "uncertain",
    "confidence": 0.31,
    "advisory": "No photo uploaded yet."
  }
}
```

---

### 5. Sarvam AI Voice Text-to-Speech (`/api/voice/synthesize`)
```bash
curl -X POST "http://localhost:8000/api/voice/synthesize" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "नमस्ते किसान भाई, आपकी फसल स्वस्थ है।",
    "language": "hi",
    "speaker": "meera"
  }'
```

**Expected Response:**
```json
{
  "audio_base64": "UklGRiQAAABXQVZF...",
  "language": "hi"
}
```

---

### 6. Sarvam AI Voice Speech-to-Text (`/api/voice/transcribe`)
```bash
curl -X POST "http://localhost:8000/api/voice/transcribe" \
  -F "file=@/path/to/voice_recording.wav" \
  -F "language=hi"
```

**Expected Response:**
```json
{
  "transcript": "फसल में खाद कब डालनी चाहिए",
  "language": "hi"
}
```

---

### 7. Disease Detection & Status with Automatic Hindi Voice Audio
```bash
# Returns diagnosis with synthesized Hindi audio attached in voice_audio_base64
curl -X POST "http://localhost:8000/api/detect-disease?lang=hi" \
  -F "image=@/path/to/leaf_photo.jpg"

# Returns status with live Hindi audio summary attached in voice_audio_base64
curl -X GET "http://localhost:8000/api/status?device_id=harvex-node-1&lang=hi"
```

---

## 🔬 Running Automated Test Suite

```bash
pytest backend/test_backend.py -v
```
All 15 contract, validation, threshold, Sarvam AI TTS/STT, and integration tests verify the system end-to-end.
