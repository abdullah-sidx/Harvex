# Harvex — AI Smart Farming Assistant
# Hardware: ESP32 or ESP8266 field node
# Compatible with ESP32 (recommended) and ESP8266

The NodeMCU ESP8266 firmware file `nodemcu_esp8266.ino` works with ESP8266 boards.
For ESP32 support, use the same file with ESP32-compatible pin definitions:
- DHTPIN: GPIO4 (DHT11/DHT22 data pin)
- SOIL_PIN: GPIO34 (analog input)
- RELAY_PIN: GPIO16 (relay control)
- I2C LCD: SDA=GPIO21, SCL=GPIO22

**Configuration constants:**
```cpp
#define WIFI_SSID        "your-network"
#define WIFI_PASSWORD    "your-password"
#define SERVER_BASE      "http://<backend-ip>:8000"
#define DEVICE_ID        "harvex-node-1"
#define DRY_SOIL_RAW     3200   // ESP32 12-bit ADC calibration (dry air)
#define WET_SOIL_RAW     1100   // ESP32 12-bit ADC calibration (submerged)
#define MAX_PUMP_RUNTIME_MS  30000  // Safety timeout in milliseconds
```

**Safety features:**
- Relay forced OFF after `MAX_PUMP_RUNTIME_MS` (30s) regardless of backend state
- On WiFi loss: continues local operation, pump defaults to OFF after timeout
- LCD shows live sensor readings and WiFi status (requires LiquidCrystal_I2C library)

**Calibration:**
- ESP32: DRY_SOIL_RAW ~3200, WET_SOIL_RAW ~1100 (12-bit ADC 0-4095)
- ESP8266: DRY_SOIL_RAW ~850, WET_SOIL_RAW ~350 (10-bit ADC 0-1023)
- Adjust raw values by testing in dry air and submerged in water via Serial Monitor

**Payload format:**
```json
{"device_id": "harvex-node-1", "soil_moisture_pct": 42.0, "temperature_c": 28.5, "humidity_pct": 61.0, "pump_status": "off", "timestamp": "2026-09-26T10:00:00Z"}
```

**Firmware behavior:**
- Reads sensors every 3 seconds (matches backend polling)
- POSTs telemetry to `/api/sensor-data`
- GETs `/api/pump-command` and controls relay accordingly
- 3-sample median filter for soil moisture readings
- Hard pump safety timeout: relay forced OFF after 30 seconds
