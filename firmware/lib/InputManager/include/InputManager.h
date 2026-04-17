#pragma once

#include <Arduino.h>

class InputManager {
 public:
  InputManager();
  void begin();
  uint8_t getState();

  void update();

  bool isPressed(uint8_t buttonIndex) const;
  bool wasPressed(uint8_t buttonIndex) const;
  bool wasAnyPressed() const;
  bool wasReleased(uint8_t buttonIndex) const;
  bool wasAnyReleased() const;
  unsigned long getHeldTime() const;

  // Button indices
  static constexpr uint8_t BTN_BACK    = 0;
  static constexpr uint8_t BTN_CONFIRM = 1;
  static constexpr uint8_t BTN_LEFT    = 2;
  static constexpr uint8_t BTN_RIGHT   = 3;
  static constexpr uint8_t BTN_UP      = 4;
  static constexpr uint8_t BTN_DOWN    = 5;
  static constexpr uint8_t BTN_POWER   = 6;

  // Pins
  static constexpr int BUTTON_ADC_PIN_1 = 1;
  static constexpr int BUTTON_ADC_PIN_2 = 2;
  static constexpr int POWER_BUTTON_PIN = 3;

  bool isPowerButtonPressed() const;
  static const char* getButtonName(uint8_t buttonIndex);

 private:
  int getButtonFromADC(int adcValue, const int ranges[], int numButtons);

  uint8_t currentState;
  uint8_t lastState;
  uint8_t pressedEvents;
  uint8_t releasedEvents;
  unsigned long lastDebounceTime;
  unsigned long buttonPressStart;
  unsigned long buttonPressFinish;

  static constexpr int NUM_BUTTONS_1 = 4;
  static const int ADC_RANGES_1[];

  static constexpr int NUM_BUTTONS_2 = 2;
  static const int ADC_RANGES_2[];

  static constexpr int ADC_NO_BUTTON = 3800;
  static constexpr unsigned long DEBOUNCE_DELAY = 5;

  static const char* BUTTON_NAMES[];
};
