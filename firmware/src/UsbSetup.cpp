#include "UsbSetup.h"
#include <ArduinoJson.h>
#include <Logging.h>

static const char PREFIX[] = "X4SETUP:";
static const int  PREFIX_LEN = 8;

static bool parseAndSave(const String& line, Config& cfg) {
  if (!line.startsWith(PREFIX)) return false;
  String json = line.substring(PREFIX_LEN);
  json.trim();

  JsonDocument doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok) {
    LOG_ERR("USB", "Bad X4SETUP JSON");
    Serial.println("X4SETUP:ERR");
    return false;
  }

  // Support new format: wifiNetworks array
  if (doc["wifiNetworks"].is<JsonArray>()) {
    cfg.wifiNetworks.clear();
    for (JsonObjectConst net : doc["wifiNetworks"].as<JsonArray>()) {
      WifiNetwork wn;
      wn.ssid = net["ssid"].as<String>();
      wn.password = net["password"].as<String>();
      wn.priority = net["priority"] | 0;
      cfg.wifiNetworks.push_back(wn);
    }
  } else {
    // Legacy single-network format for backward compatibility
    String ssid = doc["wifiSsid"] | "";
    String pass = doc["wifiPass"] | "";
    if (ssid.length() > 0) {
      WifiNetwork wn;
      wn.ssid = ssid;
      wn.password = pass;
      wn.priority = 0;
      cfg.wifiNetworks.clear();
      cfg.wifiNetworks.push_back(wn);
    }
  }

  if (!cfg.isConfigured()) {
    LOG_ERR("USB", "X4SETUP missing networks");
    Serial.println("X4SETUP:ERR");
    return false;
  }

  if (!cfg.save()) {
    LOG_ERR("USB", "Failed to save config");
    Serial.println("X4SETUP:ERR");
    return false;
  }

  Serial.println("X4SETUP:OK");
  LOG_INF("USB", "Config saved — %d networks", cfg.wifiNetworks.size());
  return true;
}

namespace UsbSetup {

bool check(Config& cfg) {
  if (!logSerial.available()) return false;
  String line = logSerial.readStringUntil('\n');
  line.trim();
  if (!line.startsWith(PREFIX)) return false;
  return parseAndSave(line, cfg);
}

bool handleLine(const String& line, Config& cfg) {
  return parseAndSave(line, cfg);
}

bool waitForSetup(Config& cfg, unsigned long timeoutMs) {
  const unsigned long start = millis();
  while (true) {
    if (logSerial.available()) {
      String line = logSerial.readStringUntil('\n');
      line.trim();
      if (line.startsWith(PREFIX)) {
        if (parseAndSave(line, cfg)) return true;
      }
    }
    if (timeoutMs > 0 && millis() - start > timeoutMs) return false;
    delay(20);
  }
}

}  // namespace UsbSetup
