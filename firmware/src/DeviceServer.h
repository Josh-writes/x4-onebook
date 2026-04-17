#pragma once
#include <Arduino.h>
#include <functional>
#include "Config.h"
#include "StateManager.h"

namespace DeviceServer {
  using SyncCompleteCallback = std::function<void()>;

  void begin(SyncCompleteCallback onSyncComplete);
  void end();

  void handleLoop();
  bool isRunning();
}