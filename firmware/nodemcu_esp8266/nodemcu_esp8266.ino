/*
 * Harvex NodeMCU ESP8266 Field Telemetry & Pump Controller
 * 
 * Hardware Wiring:
 *   - DHT11 / DHT22: Pin D4 (GPIO2), VCC to 3.3V, GND to GND
 *   - Soil Moisture Sensor: Analog Out to Pin A0, VCC to 3.3V, GND to GND
 *   - 5V Relay Module: IN to Pin D1 (GPIO5), VCC to Vin (5V), GND to GND
 * 
 * Backend Compatibility:
 *   - POST /api/sensor-data : Sends soil moisture %, temp °C, humidity %, and pump status
 *   - GET  /api/pump-command : Polls 3-state control mode ('auto' threshold, 'manual_on', 'manual_off')
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

// ----------------------------------------------------
// 1. PIN DEFINITIONS & HARDWARE CONSTANTS
// ----------------------------------------------------
#define DHTPIN D4             // DHT sensor data pin (D4 = GPIO2)
#define DHTTYPE DHT11         // DHT11 or DHT22
#define SOIL_PIN A0           // NodeMCU ADC pin for capacitive/resistive soil sensor
#define RELAY_PIN D1          // Relay module control pin (D1 = GPIO5)

// Most standard 5V relay modules are ACTIVE-LOW (LOW = Relay Energized / ON)
// Set to false if your relay module is Active-HIGH.
const bool RELAY_ACTIVE_LOW = true;

// Calibration raw values (Adjust after testing in Serial Monitor)
const int DRY_SOIL_RAW = 850; // Raw ADC reading in dry air (0% moisture)
const int WET_SOIL_RAW = 350; // Raw ADC reading submerged in water (100% moisture)

// ----------------------------------------------------
// 2. NETWORK & SERVER CONFIGURATION
// ----------------------------------------------------
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Replace with your laptop's Wi-Fi IP address (port 8000)
const char* SERVER_BASE   = "http://192.168.0.131:8000";
const char* DEVICE_ID     = "harvex-node-1";

// ----------------------------------------------------
// 3. OBJECTS & STATE VARIABLES
// ----------------------------------------------------
DHT dht(DHTPIN, DHTTYPE);

// Fallback values in case of transient DHT reading failure
float lastValidTemp     = 26.0;
float lastValidHumidity = 55.0;
bool isPumpActive       = false;

// Helper to set physical relay state
void setRelay(bool turnOn) {
  isPumpActive = turnOn;
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(RELAY_PIN, turnOn ? LOW : HIGH);
  } else {
    digitalWrite(RELAY_PIN, turnOn ? HIGH : LOW);
  }
}

// ----------------------------------------------------
// SETUP
// ----------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("==========================================");
  Serial.println("   Harvex NodeMCU ESP8266 Controller     ");
  Serial.println("==========================================");

  // Initialize Relay pin (ensure pump is OFF initially)
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);

  // Initialize DHT sensor
  dht.begin();

  // Connect to Wi-Fi
  Serial.printf("Connecting to Wi-Fi '%s'...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected successfully!");
    Serial.print("[WiFi] NodeMCU IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Connection timed out! Retrying in main loop...");
  }
}

// ----------------------------------------------------
// MAIN LOOP
// ----------------------------------------------------
void loop() {
  // Ensure Wi-Fi remains connected
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Reconnecting...");
    WiFi.reconnect();
    delay(3000);
    return;
  }

  readAndSendSensors();
  pollPumpCommand();

  // Loop delay: 3 seconds (matches dashboard polling interval)
  delay(3000);
}

// ----------------------------------------------------
// READ SENSORS & POST TO BACKEND (/api/sensor-data)
// ----------------------------------------------------
void readAndSendSensors() {
  // 1. Read DHT Sensor with error validation
  float humidity = dht.readHumidity();
  float temp = dht.readTemperature();

  if (isnan(humidity) || isnan(temp)) {
    Serial.println("[DHT] Failed to read sensor! Retaining previous valid readings.");
    temp = lastValidTemp;
    humidity = lastValidHumidity;
  } else {
    lastValidTemp = temp;
    lastValidHumidity = humidity;
  }

  // 2. Read Soil Moisture Raw ADC & Map to 0-100%
  int rawSoil = analogRead(SOIL_PIN);
  
  // Inverted mapping: higher raw ADC = drier soil
  float soilMoisturePct = (float)map(rawSoil, DRY_SOIL_RAW, WET_SOIL_RAW, 0, 100);
  soilMoisturePct = constrain(soilMoisturePct, 0.0, 100.0);

  Serial.println("------------------------------------------");
  Serial.printf("[Sensors] Raw ADC: %d | Moisture: %.1f%% | Temp: %.1f°C | Hum: %.1f%% | Pump: %s\n",
                rawSoil, soilMoisturePct, temp, humidity, isPumpActive ? "ON" : "OFF");

  // 3. Prepare JSON Payload for Harvex Backend
  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_BASE) + "/api/sensor-data";

  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> doc;
    doc["device_id"]     = DEVICE_ID;
    doc["soil_moisture"] = serialized(String(soilMoisturePct, 1));
    doc["temperature"]   = serialized(String(temp, 1));
    doc["humidity"]      = serialized(String(humidity, 1));
    doc["pump_status"]   = isPumpActive ? "on" : "off";

    String jsonPayload;
    serializeJson(doc, jsonPayload);

    int httpCode = http.POST(jsonPayload);
    if (httpCode > 0) {
      String response = http.getString();
      Serial.printf("[Telemetry POST] HTTP %d -> %s\n", httpCode, response.c_str());
    } else {
      Serial.printf("[Telemetry POST] Failed: %s\n", http.errorToString(httpCode).c_str());
    }
    http.end();
  }
}

// ----------------------------------------------------
// POLL PUMP COMMAND FROM BACKEND (/api/pump-command)
// ----------------------------------------------------
void pollPumpCommand() {
  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_BASE) + "/api/pump-command?device_id=" + String(DEVICE_ID);

  if (http.begin(client, url)) {
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      String payload = http.getString();

      StaticJsonDocument<256> doc;
      DeserializationError error = deserializeJson(doc, payload);

      if (!error) {
        const char* command = doc["pump_command"];      // "on" or "off"
        int maxRuntime     = doc["max_runtime_seconds"]; // e.g., 30
        const char* msg     = doc["display_message"];     // e.g. "Auto Pump ON", "Manual ON", "Manual OFF"

        Serial.printf("[Pump Command] Target: %s | Max Runtime: %ds | Msg: '%s'\n", command, maxRuntime, msg);

        if (String(command) == "on") {
          if (!isPumpActive) {
            Serial.println("[Relay] >>> TURNING PUMP ON <<<");
            setRelay(true);
          }
        } else {
          if (isPumpActive) {
            Serial.println("[Relay] >>> TURNING PUMP OFF <<<");
            setRelay(false);
          }
        }
      } else {
        Serial.printf("[Pump Command] JSON Parse Error: %s\n", error.c_str());
      }
    } else {
      Serial.printf("[Pump Command] HTTP GET Failed: %d\n", httpCode);
    }
    http.end();
  }
}
