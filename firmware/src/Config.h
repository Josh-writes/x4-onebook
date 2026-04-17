#pragma once
#include <Arduino.h>
#include <vector>

struct WifiNetwork {
  String ssid;
  String password;
  uint8_t priority = 0;
};

struct Config {
  std::vector<WifiNetwork> wifiNetworks;

  bool isConfigured() const { return !wifiNetworks.empty(); }

  bool load();
  bool save() const;
};

extern Config config;