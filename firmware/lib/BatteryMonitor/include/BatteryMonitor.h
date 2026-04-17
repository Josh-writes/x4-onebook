#pragma once
#include <cstdint>

class BatteryMonitor {
public:
  explicit BatteryMonitor(uint8_t adcPin, float dividerMultiplier = 2.0f);
  uint16_t readPercentage() const;
  uint16_t readMillivolts() const;
  double   readVolts() const;
  static uint16_t percentageFromMillivolts(uint16_t millivolts);
private:
  uint8_t _adcPin;
  float   _dividerMultiplier;
};
