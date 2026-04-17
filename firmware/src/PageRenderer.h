#pragma once
#include <GfxRenderer.h>
#include <string>
#include <vector>

// Margins must match shelf/server/services/converter/fontMetrics.js exactly.
// Any change here requires a matching change there.
namespace PageRenderer {
  constexpr int MARGIN_LEFT   = 8;
  constexpr int MARGIN_RIGHT  = 8;
  constexpr int MARGIN_TOP    = 14;
  constexpr int MARGIN_BOTTOM = 28;  // includes 20px status bar
  constexpr int STATUS_BAR_Y  = 800 - MARGIN_BOTTOM;  // 772

  // Map our font name + size to GfxRenderer font ID.
  // Returns 0 if not found (should never happen with valid state).
  int fontId(const String& font, int size);

  // Render a page of pre-wrapped lines plus a status bar.
  // orientation is applied to the renderer before drawing.
  void render(GfxRenderer& renderer,
              const std::vector<std::string>& lines,
              const String& font,
              int size,
              int pageN,
              int totalPages,
              GfxRenderer::Orientation orientation);

  // Full-screen message (no book, error, etc.)
  void renderMessage(GfxRenderer& renderer, const char* line1, const char* line2 = nullptr);

  // Sync / progress overlay
  void renderSyncScreen(GfxRenderer& renderer, const char* status);

  // "New book ready" confirmation screen
  void renderConfirmBook(GfxRenderer& renderer, const char* title, const char* author);

  // Download progress (0-100)
  void renderDownloadProgress(GfxRenderer& renderer, const char* title, int percent);
}
