#include "PageRenderer.h"
#include <HalDisplay.h>
#include <Logging.h>

// Font IDs from crosspoint-reader/src/fontIds.h
#define BOOKERLY_12_FONT_ID  (-1905494168)
#define BOOKERLY_14_FONT_ID  (1233852315)
#define BOOKERLY_16_FONT_ID  (1588566790)
#define BOOKERLY_18_FONT_ID  (681638548)
#define NOTOSANS_12_FONT_ID  (-1559651934)
#define NOTOSANS_14_FONT_ID  (-1014561631)
#define NOTOSANS_16_FONT_ID  (-1422711852)
#define NOTOSANS_18_FONT_ID  (1237754772)
#define OPENDYSLEXIC_10_FONT_ID (-1374689004)
#define OPENDYSLEXIC_12_FONT_ID (-795539541)
#define OPENDYSLEXIC_14_FONT_ID (-1676627620)
#define UI_12_FONT_ID        (-359249323)

namespace PageRenderer {

int fontId(const String& font, int size) {
  if (font == "bookerly") {
    if (size == 12) return BOOKERLY_12_FONT_ID;
    if (size == 14) return BOOKERLY_14_FONT_ID;
    if (size == 16) return BOOKERLY_16_FONT_ID;
    if (size == 18) return BOOKERLY_18_FONT_ID;
  } else if (font == "notosans") {
    if (size == 12) return NOTOSANS_12_FONT_ID;
    if (size == 14) return NOTOSANS_14_FONT_ID;
    if (size == 16) return NOTOSANS_16_FONT_ID;
    if (size == 18) return NOTOSANS_18_FONT_ID;
  } else if (font == "dyslexic") {
    if (size == 10) return OPENDYSLEXIC_10_FONT_ID;
    if (size == 12) return OPENDYSLEXIC_12_FONT_ID;
    if (size == 14) return OPENDYSLEXIC_14_FONT_ID;
  }
  LOG_ERR("RENDER", "Unknown font %s %d — falling back to bookerly 14", font.c_str(), size);
  return BOOKERLY_14_FONT_ID;
}

void render(GfxRenderer& renderer,
            const std::vector<std::string>& lines,
            const String& font,
            int size,
            int pageN,
            int totalPages,
            GfxRenderer::Orientation orientation) {
  renderer.setOrientation(orientation);
  renderer.clearScreen();

  const int fid        = fontId(font, size);
  const int lineHeight = renderer.getLineHeight(fid);
  const int screenW    = renderer.getScreenWidth();
  const int screenH    = renderer.getScreenHeight();

  // Fixed margins (must match shelf/server/services/converter/fontMetrics.js)
  constexpr int top    = MARGIN_TOP;
  constexpr int left   = MARGIN_LEFT;
  constexpr int bottom = MARGIN_BOTTOM;
  constexpr int right  = MARGIN_RIGHT;

  int y = top;
  for (const auto& line : lines) {
    if (y + lineHeight > screenH - bottom) break;
    if (!line.empty()) {
      renderer.drawText(fid, left, y, line.c_str());
    }
    y += lineHeight;
  }

  // Status bar: progress text + thin progress line
  if (totalPages > 0) {
    const int barY     = screenH - bottom;          // top of 28px status area
    char status[32];
    const int pct = (pageN + 1) * 100 / totalPages;
    snprintf(status, sizeof(status), "%d%%   %d / %d", pct, pageN + 1, totalPages);
    renderer.drawText(UI_12_FONT_ID, left, barY + 4, status);

    // Thin filled progress bar at very bottom of status area
    const int barWidth = screenW - left - right;
    const int lineY    = screenH - right - 3;
    const int filled   = barWidth * (pageN + 1) / totalPages;
    if (filled > 0) renderer.fillRect(left, lineY, filled, 2, true);
  }

  renderer.displayBuffer(HalDisplay::FAST_REFRESH);
}

void renderMessage(GfxRenderer& renderer, const char* line1, const char* line2) {
  renderer.setOrientation(GfxRenderer::Portrait);
  renderer.clearScreen();
  const int cx = renderer.getScreenWidth() / 2;
  renderer.drawCenteredText(UI_12_FONT_ID, 380, line1);
  if (line2) renderer.drawCenteredText(UI_12_FONT_ID, 420, line2);
  renderer.displayBuffer(HalDisplay::HALF_REFRESH);
}

void renderSyncScreen(GfxRenderer& renderer, const char* status) {
  renderer.setOrientation(GfxRenderer::Portrait);
  renderer.clearScreen();
  renderer.drawCenteredText(UI_12_FONT_ID, 380, "Syncing...");
  renderer.drawCenteredText(UI_12_FONT_ID, 414, status);
  renderer.displayBuffer(HalDisplay::FAST_REFRESH);
}

void renderConfirmBook(GfxRenderer& renderer, const char* title, const char* author) {
  renderer.setOrientation(GfxRenderer::Portrait);
  renderer.clearScreen();
  renderer.drawCenteredText(UI_12_FONT_ID, 340, "New book ready:");
  renderer.drawCenteredText(BOOKERLY_14_FONT_ID, 390, title);
  renderer.drawCenteredText(UI_12_FONT_ID, 440, author);
  renderer.drawCenteredText(UI_12_FONT_ID, 520, "CONFIRM to load");
  renderer.drawCenteredText(UI_12_FONT_ID, 554, "BACK to keep current book");
  renderer.displayBuffer(HalDisplay::HALF_REFRESH);
}

void renderDownloadProgress(GfxRenderer& renderer, const char* title, int percent) {
  renderer.setOrientation(GfxRenderer::Portrait);
  renderer.clearScreen();
  renderer.drawCenteredText(UI_12_FONT_ID, 340, "Loading:");
  renderer.drawCenteredText(BOOKERLY_14_FONT_ID, 390, title);

  // Progress bar
  const int bx = 40, by = 460, bw = 400, bh = 16;
  renderer.drawRect(bx, by, bw, bh);
  const int filled = bw * percent / 100;
  if (filled > 0) renderer.fillRect(bx, by, filled, bh);

  char pct[8];
  snprintf(pct, sizeof(pct), "%d%%", percent);
  renderer.drawCenteredText(UI_12_FONT_ID, 494, pct);

  renderer.displayBuffer(HalDisplay::FAST_REFRESH);
}

}  // namespace PageRenderer
