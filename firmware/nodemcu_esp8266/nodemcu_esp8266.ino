/*
 * Harvex Field Telemetry & Pump Controller
 * Compatible with ESP32 and ESP8266
 * 
 * Hardware Wiring:
 *   - DHT11/DHT22: Data pin (D4=GPIO2 on ESP8266, GPIO4 on ESP32)
 *   - Soil Moisture Sensor: Analog Out (A0 on ESP8266, GPIO34-39 on ESP32)
 *   - 5V Relay Module: IN pin (D1=GPIO5 on ESP8266, GPIO16 on ESP32)
 *   - 16x2 LCD via I2C (optional): SDA=GPIO21, SCL=GPIO22 (ESP32)
 * 
 * Backend Compatibility:
 *   - POST /api/sensor-data: Sends soil_moisture_pct, temperature_c, humidity_pct, timestamp, pump_status
 *   - GET /api/pump-command: Returns pump_command (on/off), max_runtime_seconds, display_message
 */

#include <ArduinoJson.h>

// ----------------------------------------------------
// 1. PIN DEFINITIONS & HARDWARE CONSTANTS
// ----------------------------------------------------
#define DHTTYPE DHT11

// ESP32 pins (uncomment for ESP32)
#define DHTPIN 4
#define SOIL_PIN 34
#define RELAY_PIN 16
#define SDA_PIN 21
#define SCL_PIN 22

// ESP8266 pins (uncomment for ESP8266)
// #define DHTPIN 4
// #define SOIL_PIN A0
// #define RELAY_PIN 5

const bool RELAY_ACTIVE_LOW = true;

// Calibration raw values (adjust for your sensor)
// ESP32 (12-bit ADC 0-4095): DRY ~3200, WET ~1100
// ESP8266 (10-bit ADC 0-1023): DRY ~850, WET ~350
const int DRY_SOIL_RAW = 3200;
const int WET_SOIL_RAW = 1100;

// Safety timeout: relay forced OFF after this duration regardless of backend state
const int MAX_PUMP_RUNTIME_MS = 30000;

// Network & Server
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_BASE = "http://YOUR_BACKEND_IP:8000";
const char* DEVICE_ID = "harvex-node-1";

// ----------------------------------------------------
// 2. OBJECTS & STATE VARIABLES
// ----------------------------------------------------
#include <DHT.h>
DHT dht(DHTPIN, DHTTYPE);

float lastValidTemp = 26.0;
float lastValidHumidity = 55.0;
bool isPumpActive = false;
unsigned long pumpStartTime = 0;
bool pumpTimeoutActive = false;

// LCD (optional, requires LiquidCrystal_I2C)
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
bool lcdInitialized = false;

// ----------------------------------------------------
// HELPER FUNCTIONS
// ----------------------------------------------------
void setRelay(bool turnOn) {
  isPumpActive = turnOn;
  pumpStartTime = millis();
  pumpTimeoutActive = true;
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(RELAY_PIN, turnOn ? LOW : HIGH);
  } else {
    digitalWrite(RELAY_PIN, turnOn ? HIGH : LOW);
  }
}

void forcePumpOff() {
  isPumpActive = false;
  pumpTimeoutActive = false;
  setRelay(false);
}

void checkPumpTimeout() {
  if (pumpTimeoutActive && (millis() - pumpStartTime) >= MAX_PUMP_RUNTIME_MS) {
    forcePumpOff();
  }
}

void initLCD() {
  Wire.begin(SDA_PIN, SCL_PIN);
  lcd.init();
  lcd.backlight();
  lcdInitialized = true;
}

void updateLCD(float soilMoisture, float temp, float humidity, bool pumpOn, bool wifiOnline) {
  if (!lcdInitialized) return;
  lcd.setCursor(0, 0);
  lcd.print("M:" + String(soilMoisture, 0) + "% T:" + String(temp, 1) + "C");
  lcd.setCursor(0, 1);
  lcd.print("P:" + String(pumpOn ? "ON" : "OFF") + " W:" + String(wifiOnline ? "OK" : "OFF"));
}

// ----------------------------------------------------
// SETUP
// ----------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);

  dht.begin();

  Serial.println("==========================================");
  Serial.println("   Harvex Field Node (ESP32/ESP8266)     ");
  Serial.println("==========================================");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());
    initLCD();
  } else {
    Serial.println("\n[WiFi] Connection failed! Operating offline.");
    initLCD();
  }
}

// ----------------------------------------------------
// MAIN LOOP
// ----------------------------------------------------
void loop() {
  checkPumpTimeout();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Reconnecting...");
    WiFi.reconnect();
    delay(3000);
    return;
  }

  readAndSendSensors();
  pollPumpCommand();

  // Safety timeout enforcement on WiFi loss
  if (!WiFi.isConnected()) {
    if (isPumpActive && pumpTimeoutActive && (millis() - pumpStartTime) >= MAX_PUMP_RUNTIME_MS) {
      forcePumpOff();
    }
  }

  delay(3000); // Match backend polling interval
}

// ----------------------------------------------------
// READ SENSORS & POST TO BACKEND
// ----------------------------------------------------
void readAndSendSensors() {
  float humidity = dht.readHumidity();
  float temp = dht.readTemperature();

  if (isnan(humidity) || isnan(temp)) {
    temp = lastValidTemp;
    humidity = lastValidHumidity;
  } else {
    lastValidTemp = temp;
    lastValidHumidity = humidity;
  }

  int rawSoil = analogRead(SOIL_PIN);
  float soilMoisturePct = (float)map(rawSoil, DRY_SOIL_RAW, WET_SOIL_RAW, 0, 100);
  soilMoisturePct = constrain(soilMoisturePct, 0.0, 100.0);

  // Simple median filter: take 3 readings
  float soilReadings[3];
  for (int i = 0; i < 3; i++) {
    soilReadings[i] = (float)map(analogRead(SOIL_PIN), DRY_SOIL_RAW, WET_SOIL_RAW, 0, 100);
    delay(10);
  }
  soilMoisturePct = (soilReadings[0] + soilReadings[1] + soilReadings[2]) / 3.0;
  soilMoisturePct = constrain(soilMoisturePct, 0.0, 100.0);

  Serial.printf("[Sensors] Moisture: %.1f%% | Temp: %.1fC | Humidity: %.1f%% | Pump: %s\n",
                soilMoisturePct, temp, humidity, isPumpActive ? "ON" : "OFF");

  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_BASE) + "/api/sensor-data";

  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> doc;
    doc["device_id"] = DEVICE_ID;
    doc["soil_moisture_pct"] = soilMoisturePct;
    doc["temperature_c"] = temp;
    doc["humidity_pct"] = humidity;
    doc["pump_status"] = isPumpActive ? "on" : "off";
    doc["timestamp"] = ""; // Backend generates timestamp

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
// POLL PUMP COMMAND FROM BACKEND
// ----------------------------------------------------
void pollPumpCommand() {
  WiFiClient client;
  HTTPClient http;
  String url = String(SERVER_BASE) + "/api/pump-command?device_id=" + String(DEVICE_ID);

  if (http.begin(client, url)) {
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      String payload = http.getString();

      DynamicJsonDocument doc(256);
      DeserializationError error = deserializeJson(doc, payload);

      if (!error) {
        const char* command = doc["pump_command"];
        int maxRuntime = doc["max_runtime_seconds"];
        const char* msg = doc["display_message"];

        Serial.printf("[Pump Cmd] Target: %s | Max Runtime: %ds | Msg: '%s'\n", command, maxRuntime, msg);

        if (String(command) == "on" && !isPumpActive) {
          Serial.println("[Relay] >>> TURNING PUMP ON <<<");
          setRelay(true);
        } else if (String(command) == "off" && isPumpActive) {
          Serial.println("[Relay] >>> TURNING PUMP OFF <<<");
          forcePumpOff();
        }
      }
    } else {
      Serial.printf("[Pump Cmd] HTTP GET Failed: %d\n", httpCode);
    }
    http.end();
  }
}
