#pragma once
#include <GfxRenderer.h>
#include <HalGPIO.h>
#include "StateManager.h"

// Full-screen settings overlay. Call run() — it blocks until the user
// confirms or cancels, then returns the (possibly updated) state.
// Font switch uses the .idx files to preserve reading position.
namespace SettingsMenu {
  BookState run(GfxRenderer& renderer, HalGPIO& gpio, const BookState& current);
  bool isSwapRequested(const BookState& state);
}
