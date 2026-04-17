#include "SettingsMenu.h"
#include "BookReader.h"
#include "PageRenderer.h"
#include <HalDisplay.h>
#include <Logging.h>

// Font + size options. Dyslexic only goes to 14 (no 16pt header in firmware).
static const char* FONTS[]      = { "bookerly", "notosans", "dyslexic" };
static const int   FONT_COUNT   = 3;

static const int BOOKERLY_SIZES[]  = { 12, 14, 16, 18 };
static const int NOTOSANS_SIZES[]  = { 12, 14, 16, 18 };
static const int DYSLEXIC_SIZES[]  = { 10, 12, 14 };

static const int*  fontSizes(int fontIdx, int& count) {
  if (fontIdx == 0) { count = 4; return BOOKERLY_SIZES; }
  if (fontIdx == 1) { count = 4; return NOTOSANS_SIZES; }
  count = 3; return DYSLEXIC_SIZES;
}

static const char* ORIENTATION_LABELS[] = {
  "Portrait", "Landscape CW", "Portrait Inv", "Landscape CCW"
};
static const GfxRenderer::Orientation ORIENTATIONS[] = {
  GfxRenderer::Portrait,
  GfxRenderer::LandscapeClockwise,
  GfxRenderer::PortraitInverted,
  GfxRenderer::LandscapeCounterClockwise,
};
static const int ORIENTATION_COUNT = 4;

#define UI_12 (-359249323)

static const int ROW_COUNT = 4;
static const int ROW_FONT = 0;
static const int ROW_SIZE = 1;
static const int ROW_ORIENT = 2;
static const int ROW_SWAP  = 3;

static void drawMenu(GfxRenderer& renderer,
                     int fontIdx, int sizeIdx, int orientIdx,
                     int activeRow) {
  renderer.setOrientation(GfxRenderer::Portrait);
  renderer.clearScreen();

  renderer.drawCenteredText(UI_12, 40, "Settings");
  renderer.drawLine(20, 60, 460, 60);

  // Row 0: Font
  const char* fontLabel = FONTS[fontIdx];
  if (activeRow == 0) renderer.fillRect(20, 80, 440, 40, true);
  renderer.drawText(UI_12, 30, 90, "Font");
  {
    char buf[32];
    snprintf(buf, sizeof(buf), "< %s >", fontLabel);
    renderer.drawCenteredText(UI_12, 90, buf);
  }

  // Row 1: Size
  int sizeCount;
  const int* sizes = fontSizes(fontIdx, sizeCount);
  if (activeRow == 1) renderer.fillRect(20, 140, 440, 40, true);
  renderer.drawText(UI_12, 30, 150, "Size");
  {
    char buf[16];
    snprintf(buf, sizeof(buf), "< %d >", sizes[sizeIdx]);
    renderer.drawCenteredText(UI_12, 150, buf);
  }

  // Row 2: Orientation
  if (activeRow == 2) renderer.fillRect(20, 200, 440, 40, true);
  renderer.drawText(UI_12, 30, 210, "Orientation");
  {
    char buf[32];
    snprintf(buf, sizeof(buf), "< %s >", ORIENTATION_LABELS[orientIdx]);
    renderer.drawCenteredText(UI_12, 210, buf);
  }

  // Row 3: Swap Book
  if (activeRow == 3) renderer.fillRect(20, 260, 440, 40, true);
  renderer.drawText(UI_12, 30, 270, "Swap Book");
  renderer.drawText(UI_12, 380, 270, "→");

  renderer.drawLine(20, 320, 460, 320);
  renderer.drawCenteredText(UI_12, 340, "UP/DOWN: select row");
  renderer.drawCenteredText(UI_12, 374, "LEFT/RIGHT: change value");
  renderer.drawCenteredText(UI_12, 408, "CONFIRM: save   BACK: cancel");

  renderer.displayBuffer(HalDisplay::HALF_REFRESH);
}

namespace SettingsMenu {

BookState run(GfxRenderer& renderer, HalGPIO& gpio, const BookState& current) {
  // Map current state to indices
  int fontIdx = 0;
  for (int i = 0; i < FONT_COUNT; i++) {
    if (current.font == FONTS[i]) { fontIdx = i; break; }
  }

  int sizeCount;
  const int* sizes = fontSizes(fontIdx, sizeCount);
  int sizeIdx = 0;
  for (int i = 0; i < sizeCount; i++) {
    if (sizes[i] == current.size) { sizeIdx = i; break; }
  }

  int orientIdx = current.orientation;
  if (orientIdx < 0 || orientIdx >= ORIENTATION_COUNT) orientIdx = 0;

  int activeRow = 0;
  drawMenu(renderer, fontIdx, sizeIdx, orientIdx, activeRow);

  while (true) {
    gpio.update();

    if (gpio.wasPressed(HalGPIO::BTN_UP)) {
      activeRow = (activeRow + ROW_COUNT - 1) % ROW_COUNT;
      drawMenu(renderer, fontIdx, sizeIdx, orientIdx, activeRow);
    } else if (gpio.wasPressed(HalGPIO::BTN_DOWN)) {
      activeRow = (activeRow + 1) % ROW_COUNT;
      drawMenu(renderer, fontIdx, sizeIdx, orientIdx, activeRow);
    } else if (gpio.wasPressed(HalGPIO::BTN_LEFT)) {
      if (activeRow == ROW_FONT) {
        fontIdx = (fontIdx + FONT_COUNT - 1) % FONT_COUNT;
        sizeIdx = 0;
      } else if (activeRow == ROW_SIZE) {
        sizeIdx = (sizeIdx + sizeCount - 1) % sizeCount;
      } else if (activeRow == ROW_ORIENT) {
        orientIdx = (orientIdx + ORIENTATION_COUNT - 1) % ORIENTATION_COUNT;
      }
      sizes = fontSizes(fontIdx, sizeCount);
      drawMenu(renderer, fontIdx, sizeIdx, orientIdx, activeRow);
    } else if (gpio.wasPressed(HalGPIO::BTN_RIGHT)) {
      if (activeRow == ROW_FONT) {
        fontIdx = (fontIdx + 1) % FONT_COUNT;
        sizeIdx = 0;
      } else if (activeRow == ROW_SIZE) {
        sizeIdx = (sizeIdx + 1) % sizeCount;
      } else if (activeRow == ROW_ORIENT) {
        orientIdx = (orientIdx + 1) % ORIENTATION_COUNT;
      }
      sizes = fontSizes(fontIdx, sizeCount);
      drawMenu(renderer, fontIdx, sizeIdx, orientIdx, activeRow);
    } else if (gpio.wasPressed(HalGPIO::BTN_CONFIRM)) {
      if (activeRow == ROW_SWAP) {
        BookState sentinel;
        sentinel.bookId = "__swap__";
        return sentinel;
      }

      // Resolve new page via char offset if font/size changed
      BookState next = current;
      next.font = FONTS[fontIdx];
      next.size = sizes[sizeIdx];

      next.orientation = orientIdx;

      if (next.font != current.font || next.size != current.size) {
        // Get char offset for current page in old variant
        BookReader oldReader;
        if (oldReader.open(current.font, current.size)) {
          uint32_t charOffset = oldReader.charOffsetForPage(current.page);
          // Find closest page in new variant
          next.page = BookReader::pageForCharOffset(next.font, next.size, charOffset);
          LOG_INF("SETTINGS", "Font switch: %s%d p%d → %s%d p%d (offset %u)",
            current.font.c_str(), current.size, current.page,
            next.font.c_str(), next.size, next.page, charOffset);
        }
      }
      return next;
    } else if (gpio.wasPressed(HalGPIO::BTN_BACK)) {
      return current;  // cancel — no change
    }

    delay(10);
  }
}

}  // namespace SettingsMenu

bool SettingsMenu::isSwapRequested(const BookState& state) {
  return state.bookId == "__swap__";
}
