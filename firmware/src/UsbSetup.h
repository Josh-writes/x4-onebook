#pragma once
#include "Config.h"

// Handles the one-time WiFi credential push from the shelf app over USB serial.
//
// Protocol (shelf → device):
//   X4SETUP:{"wifiSsid":"...","wifiPass":"...","shelfIp":"...","shelfPort":3001}
//
// Device responds:
//   X4SETUP:OK     — credentials saved
//   X4SETUP:ERR    — parse or save failed
namespace UsbSetup {
  // Check for a pending X4SETUP command on Serial (reads one line).
  // Returns true if credentials were received and saved.
  // Non-blocking: returns false immediately if nothing available.
  bool check(Config& cfg);

  // Process a pre-read line. Returns true if it was an X4SETUP command and succeeded.
  bool handleLine(const String& line, Config& cfg);

  // Block until X4SETUP received or timeout (ms). Used on first-boot setup screen.
  bool waitForSetup(Config& cfg, unsigned long timeoutMs = 0 /*0 = forever*/);
}
