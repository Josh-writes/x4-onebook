#include "Config.h"
#include <ArduinoJson.h>
#include <HalStorage.h>
#include <Logging.h>

Config config;

bool Config::load() {
  String json = Storage.readFile("/config.json");
  if (json.isEmpty()) return false;

  JsonDocument doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok) {
    LOG_ERR("CFG", "Failed to parse /config.json");
    return false;
  }

  if (doc["wifiNetworks"].is<JsonArray>()) {
    wifiNetworks.clear();
    for (JsonObjectConst net : doc["wifiNetworks"].as<JsonArray>()) {
      WifiNetwork wn;
      wn.ssid = net["ssid"].as<String>();
      wn.password = net["password"].as<String>();
      wn.priority = net["priority"] | 0;
      wifiNetworks.push_back(wn);
    }
  }

  return true;
}

bool Config::save() const {
  JsonDocument doc;

  JsonArray networks = doc["wifiNetworks"].to<JsonArray>();
  for (const auto& net : wifiNetworks) {
    JsonObject obj = networks.add<JsonObject>();
    obj["ssid"] = net.ssid;
    obj["password"] = net.password;
    obj["priority"] = net.priority;
  }

  String out;
  serializeJson(doc, out);
  return Storage.writeFile("/config.json", out);
}