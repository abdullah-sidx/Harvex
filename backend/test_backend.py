import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
import database
import weather

client = TestClient(main.app)


def setup_module(module):
    """Ensure database tables are initialized before tests."""
    database.init_db()


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "Harvex" in data["project"]


def test_post_sensor_data_valid():
    payload = {
        "device_id": "harvex-node-1",
        "timestamp": "2026-08-26T10:15:00Z",
        "soil_moisture_pct": 42,
        "temperature_c": 28.5,
        "humidity_pct": 61,
        "pump_status": "off"
    }
    response = client.post("/api/sensor-data", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] in {"received", "success"}


def test_post_sensor_data_malformed():
    # Missing required fields
    invalid_payload = {
        "device_id": "harvex-node-1",
        "soil_moisture_pct": "not-a-number"
    }
    response = client.post("/api/sensor-data", json=invalid_payload)
    # Must reject with clear 400 error
    assert response.status_code == 400
    data = response.json()
    assert "detail" in data
    assert "Malformed request payload" in data["detail"]


def test_post_sensor_data_invalid_pump_status():
    invalid_payload = {
        "device_id": "harvex-node-1",
        "timestamp": "2026-08-26T10:15:00Z",
        "soil_moisture_pct": 42,
        "temperature_c": 28.5,
        "humidity_pct": 61,
        "pump_status": "running"  # Invalid, must be 'on' or 'off'
    }
    response = client.post("/api/sensor-data", json=invalid_payload)
    assert response.status_code == 400


def test_pump_command_moisture_optimal(monkeypatch):
    # Post adequate moisture (42%)
    client.post("/api/sensor-data", json={
        "device_id": "harvex-node-1",
        "timestamp": "2026-08-26T10:20:00Z",
        "soil_moisture_pct": 42.0,
        "temperature_c": 27.0,
        "humidity_pct": 60.0,
        "pump_status": "off"
    })
    
    # Mock weather to no rain
    monkeypatch.setattr(weather, "get_rain_forecast", lambda: (0.1, False))

    response = client.get("/api/pump-command?device_id=harvex-node-1")
    assert response.status_code == 200
    data = response.json()
    assert data["pump_command"] == "off"
    assert data["max_runtime_seconds"] == 0
    assert data["display_message"] == "Soil moisture optimal"


def test_pump_command_dry_soil_no_rain(monkeypatch):
    # Post dry soil moisture (18% < 30%)
    client.post("/api/sensor-data", json={
        "device_id": "harvex-node-1",
        "timestamp": "2026-08-26T10:25:00Z",
        "soil_moisture_pct": 18.0,
        "temperature_c": 31.0,
        "humidity_pct": 45.0,
        "pump_status": "off"
    })

    # Mock weather: no rain
    monkeypatch.setattr(weather, "get_rain_forecast", lambda: (0.1, False))

    response = client.get("/api/pump-command?device_id=harvex-node-1")
    assert response.status_code == 200
    data = response.json()
    assert data["pump_command"] == "on"
    assert data["max_runtime_seconds"] == 30
    assert data["display_message"] == "Watering: dry soil"


def test_pump_command_dry_soil_rain_expected(monkeypatch):
    # Post dry soil moisture (20% < 30%)
    client.post("/api/sensor-data", json={
        "device_id": "harvex-node-1",
        "timestamp": "2026-08-26T10:30:00Z",
        "soil_moisture_pct": 20.0,
        "temperature_c": 28.0,
        "humidity_pct": 75.0,
        "pump_status": "off"
    })

    # Mock weather: rain expected
    monkeypatch.setattr(weather, "get_rain_forecast", lambda: (0.85, True))

    response = client.get("/api/pump-command?device_id=harvex-node-1")
    assert response.status_code == 200
    data = response.json()
    assert data["pump_command"] == "off"
    assert data["max_runtime_seconds"] == 0
    assert data["display_message"] == "Rain expected: skipping"


def test_detect_disease_low_confidence_synthetic_image():
    # Create a green image that passes color pre-screening (> 15% green) but yields low classification confidence
    img = Image.new("RGB", (224, 224), color=(34, 139, 34))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)

    response = client.post(
        "/api/detect-disease",
        files={"image": ("test.jpg", buf, "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert "disease_class" in data
    assert "confidence" in data
    assert "advisory" in data
    assert data["disease_class"] == "uncertain"
    assert data["confidence"] < 0.70
    assert data["advisory"] == "Photo unclear or non-leaf image uploaded — please upload a close-up photo of a plant leaf."
    assert data["advisory_hi"] == "तस्वीर स्पष्ट नहीं है या पत्ती की नहीं है - कृपया किसी पौधे की पत्ती की करीब से फोटो अपलोड करें।"


def test_detect_disease_non_leaf_prescreening_bypass():
    # Create a non-leaf blue/grey image with 0% vegetation pixels (< 15%)
    img = Image.new("RGB", (224, 224), color=(20, 40, 180))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)

    response = client.post(
        "/api/detect-disease",
        files={"image": ("car_or_object.jpg", buf, "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    # Prescreening immediately bypasses ViT classifier and returns 0.0 confidence
    assert data["disease_class"] == "uncertain"
    assert data["confidence"] == 0.0
    assert data["advisory"] == "Photo unclear or non-leaf image uploaded — please upload a close-up photo of a plant leaf."
    assert data["advisory_hi"] == "तस्वीर स्पष्ट नहीं है या पत्ती की नहीं है - कृपया किसी पौधे की पत्ती की करीब से फोटो अपलोड करें।"


def test_detect_disease_missing_corrupt_file():
    # Send empty/corrupt file
    corrupt_buf = io.BytesIO(b"not a valid image file")
    response = client.post(
        "/api/detect-disease",
        files={"image": ("corrupt.jpg", corrupt_buf, "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["disease_class"] == "uncertain"
    assert data["confidence"] == 0.0
    assert data["advisory"] == "Photo unclear or non-leaf image uploaded — please upload a close-up photo of a plant leaf."
    assert data["advisory_hi"] == "तस्वीर स्पष्ट नहीं है या पत्ती की नहीं है - कृपया किसी पौधे की पत्ती की करीब से फोटो अपलोड करें।"


def test_get_status_endpoint(monkeypatch):
    # Set known state
    client.post("/api/sensor-data", json={
        "device_id": "harvex-node-1",
        "timestamp": "2026-08-26T10:15:00Z",
        "soil_moisture_pct": 42.0,
        "temperature_c": 28.5,
        "humidity_pct": 61.0,
        "pump_status": "off"
    })
    
    # Save a known disease result
    database.save_disease_detection(
        disease_class="uncertain",
        confidence=0.31,
        advisory="No photo uploaded yet.",
        device_id="harvex-node-1"
    )

    monkeypatch.setattr(weather, "get_rain_forecast", lambda: (0.1, False))

    response = client.get("/api/status?device_id=harvex-node-1")
    assert response.status_code == 200
    data = response.json()
    
    # Verify contract shape and field names
    assert data["device_id"] == "harvex-node-1"
    assert data["soil_moisture_pct"] == 42.0
    assert data["temperature_c"] == 28.5
    assert data["humidity_pct"] == 61.0
    assert data["pump_status"] == "off"
    assert data["rain_expected"] is False
    assert data["crop_health_score"] == "Healthy"
    assert data["last_disease_result"]["disease_class"] == "uncertain"
    assert data["last_disease_result"]["confidence"] == 0.31
    assert data["last_disease_result"]["advisory"] == "No photo uploaded yet."


def test_crop_health_score_needs_water_and_disease_risk(monkeypatch):
    # Set soil moisture low (22%)
    client.post("/api/sensor-data", json={
        "device_id": "harvex-node-1",
        "timestamp": "2026-08-26T10:45:00Z",
        "soil_moisture_pct": 22.0,
        "temperature_c": 30.0,
        "humidity_pct": 50.0,
        "pump_status": "off"
    })

    # Save disease detection result with high confidence
    database.save_disease_detection(
        disease_class="Early Blight",
        confidence=0.87,
        advisory="Possible early blight detected. Remove affected leaves and avoid overhead watering.",
        device_id="harvex-node-1"
    )

    monkeypatch.setattr(weather, "get_rain_forecast", lambda: (0.1, False))

    response = client.get("/api/status?device_id=harvex-node-1")
    assert response.status_code == 200
    data = response.json()
    assert data["crop_health_score"] == "Needs Water + Disease Risk"
    assert data["last_disease_result"]["disease_class"] == "Early Blight"
    assert data["last_disease_result"]["confidence"] == 0.87


def test_voice_synthesize_endpoint(monkeypatch):
    import sarvam

    async def mock_tts(inputs, target_language_code="hi-IN", speaker="meera", model="bulbul:v1"):
        return ["UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="]

    monkeypatch.setattr(sarvam, "text_to_speech", mock_tts)

    payload = {
        "text": "नमस्ते किसान भाई, आपकी फसल स्वस्थ है।",
        "language": "hi",
        "speaker": "meera"
    }
    response = client.post("/api/voice/synthesize", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "audio_base64" in data
    assert len(data["audio_base64"]) > 0
    assert data["language"] == "hi"


def test_voice_transcribe_endpoint(monkeypatch):
    import sarvam

    async def mock_stt(file_bytes, language_code="hi-IN", model="saaras:v1"):
        return "फसल में खाद कब डालनी चाहिए"

    monkeypatch.setattr(sarvam, "speech_to_text", mock_stt)

    dummy_audio = io.BytesIO(b"RIFFdummywaveaudiobytes")
    response = client.post(
        "/api/voice/transcribe",
        files={"file": ("recording.wav", dummy_audio, "audio/wav")},
        data={"language": "hi"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["transcript"] == "फसल में खाद कब डालनी चाहिए"
    assert data["language"] == "hi"


def test_detect_disease_hindi_voice_attachment(monkeypatch):
    import sarvam

    async def mock_tts(inputs, target_language_code="hi-IN", speaker="meera", model="bulbul:v1"):
        return ["UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="]

    monkeypatch.setattr(sarvam, "text_to_speech", mock_tts)

    img = Image.new("RGB", (224, 224), color=(34, 139, 34))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)

    response = client.post(
        "/api/detect-disease?lang=hi",
        files={"image": ("leaf.jpg", buf, "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert "voice_audio_base64" in data
    assert data["voice_audio_base64"] is not None


def test_get_status_hindi_voice_attachment(monkeypatch):
    import sarvam

    async def mock_tts(inputs, target_language_code="hi-IN", speaker="meera", model="bulbul:v1"):
        return ["UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="]

    monkeypatch.setattr(sarvam, "text_to_speech", mock_tts)
    monkeypatch.setattr(weather, "get_rain_forecast", lambda: (0.1, False))

    response = client.get("/api/status?device_id=harvex-node-1&lang=hi")
    assert response.status_code == 200
    data = response.json()
    assert "voice_audio_base64" in data
    assert data["voice_audio_base64"] is not None


def test_recommend_crops_endpoint():
    payload = {
        "farm_profile": {
            "state": "Maharashtra",
            "district": "Pune",
            "soil_type": "Black Soil (Regur)",
            "irrigation": "Drip Irrigation"
        },
        "language": "en"
    }
    response = client.post("/api/recommend-crops", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "season" in data
    assert "crops" in data
    assert len(data["crops"]) >= 1
    first_crop = data["crops"][0]
    assert "name" in first_crop
    assert "expected_yield" in first_crop
    assert "ideal_water" in first_crop
    assert "reason" in first_crop


def test_chat_voice_endpoint(monkeypatch):
    import sarvam

    async def mock_tts(inputs, target_language_code="hi-IN", speaker="meera", model="bulbul:v3"):
        return ["UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="]

    monkeypatch.setattr(sarvam, "text_to_speech", mock_tts)

    payload = {
        "message": "मेरी मिट्टी की नमी कैसी है?",
        "language": "hi",
        "farm_profile": {
            "state": "Maharashtra",
            "district": "Pune",
            "soil_type": "Black Soil (Regur)",
            "irrigation": "Drip Irrigation"
        },
        "sensor_context": {
            "soilMoisture": 45,
            "temperature": 29,
            "isWatering": False
        }
    }
    response = client.post("/api/chat-voice", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "reply_text" in data
    assert len(data["reply_text"]) > 0
    assert "audio_base64" in data
    assert data["language"] == "hi"


def test_chat_text_endpoint():
    payload = {
        "message": "What is the best fertilizer for wheat?",
        "language": "en",
        "farm_profile": {
            "state": "Punjab",
            "district": "Ludhiana",
            "soil_type": "Alluvial Loam",
            "irrigation": "Canal / Flood"
        }
    }
    response = client.post("/api/chat-text", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "reply" in data
    assert len(data["reply"]) > 0
    assert data["language"] == "en"


def test_sensor_telemetry_and_heartbeat():
    # 1. Post telemetry from NodeMCU
    res = client.post("/api/sensor-data", json={
        "device_id": "harvex-node-1",
        "soil_moisture_pct": 35.5,
        "temperature_c": 29.0,
        "humidity_pct": 52.0,
        "pump_status": "off"
    })
    assert res.status_code == 200
    assert res.json()["status"] == "success"

    # 2. Check sensor heartbeat returns both updated_at and last_updated_timestamp
    sensor_res = client.get("/api/sensor-data")
    assert sensor_res.status_code == 200
    sensor_data = sensor_res.json()
    assert "last_updated_timestamp" in sensor_data
    assert sensor_data["last_updated_timestamp"] is not None
    assert sensor_data["soil_moisture_pct"] == 35.5


def test_manual_pump_toggle_and_history():
    from telemetry_state import get_pending_pump_command

    # 1. Manually toggle pump to ON via web UI endpoint
    toggle_res = client.post("/api/pump/toggle", json={
        "state": "on",
        "duration_seconds": 30,
        "triggered_by": "WEBSITE"
    })
    assert toggle_res.status_code == 200
    assert toggle_res.json()["pump_command"] == "on"
    assert toggle_res.json()["display_message"] == "Web Pump ON"

    cmd = get_pending_pump_command()
    assert cmd["pump_command"] == "on"
    assert cmd["display_message"] == "Web Pump ON"

    # 2. Verify pump history has entry
    hist_res = client.get("/api/pump/history")
    assert hist_res.status_code == 200
    history = hist_res.json()
    assert len(history) > 0
    assert history[0]["action"] == "ON"
    assert history[0]["triggered_by"] == "WEBSITE"

    # 3. Manually toggle pump to OFF via web UI endpoint
    toggle_res2 = client.post("/api/pump/toggle", json={
        "state": "off",
        "triggered_by": "WEBSITE"
    })
    assert toggle_res2.status_code == 200
    assert toggle_res2.json()["pump_command"] == "off"
    assert toggle_res2.json()["display_message"] == "Web Pump OFF"

    cmd2 = get_pending_pump_command()
    assert cmd2["pump_command"] == "off"
    assert cmd2["display_message"] == "Web Pump OFF"


def test_sarvam_stt_and_voice_fallback():
    import io

    # 1. Test /api/sarvam/stt endpoint with dummy file
    dummy_wav = io.BytesIO(b"RIFF....WAVEfmt ....data....")
    res_stt = client.post(
        "/api/sarvam/stt",
        files={"file": ("test.wav", dummy_wav, "audio/wav")},
        data={"language": "hi-IN"}
    )
    assert res_stt.status_code == 200
    assert "transcript" in res_stt.json()

    # 2. Test /api/sarvam/voice fallback endpoint with empty audio
    empty_file = io.BytesIO(b"")
    res_voice = client.post(
        "/api/sarvam/voice",
        files={"file": ("test.wav", empty_file, "audio/wav")},
        data={"language": "hi-IN", "device_id": "harvex-node-1"}
    )
    assert res_voice.status_code == 200
    assert res_voice.json()["transcript"] == ""




