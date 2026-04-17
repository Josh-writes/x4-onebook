#pragma once
#include <GfxRenderer.h>

namespace UsbSync {
  // Call from main loop when USB is connected and a serial line was read.
  // If line == "X4SYNC", takes over and runs a full sync (blocking).
  // Returns true if sync completed — caller should reload state and re-render.
  bool handleLine(const String& line, GfxRenderer& renderer);
}
