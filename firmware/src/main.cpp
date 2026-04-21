#include <Arduino.h>
#include <GfxRenderer.h>
#include <HalDisplay.h>
#include <HalGPIO.h>
#include <HalPowerManager.h>
#include <HalStorage.h>
#include <HalSystem.h>
#include <Logging.h>
#include <builtinFonts/all.h>
#include <Bitmap.h>

#include "BookReader.h"
#include "Config.h"
#include "DeviceServer.h"
#include "PageRenderer.h"
#include "SettingsMenu.h"
#include "StateManager.h"
#include "UsbSetup.h"
#include "UsbSync.h"

// Forward declarations
void renderCoverSleepScreen();

// ── Singletons (same pattern as crosspoint-reader) ───────────────────────────
GfxRenderer renderer(display);

// ── Fonts (regular weight only — we render pre-wrapped plain text) ────────────
EpdFont bookerly12Font(&bookerly_12_regular);   EpdFontFamily bookerly12Family(&bookerly12Font);
EpdFont bookerly14Font(&bookerly_14_regular);   EpdFontFamily bookerly14Family(&bookerly14Font);
EpdFont bookerly16Font(&bookerly_16_regular);   EpdFontFamily bookerly16Family(&bookerly16Font);
EpdFont bookerly18Font(&bookerly_18_regular);   EpdFontFamily bookerly18Family(&bookerly18Font);
EpdFont notosans12Font(&notosans_12_regular);   EpdFontFamily notosans12Family(&notosans12Font);
EpdFont notosans14Font(&notosans_14_regular);   EpdFontFamily notosans14Family(&notosans14Font);
EpdFont notosans16Font(&notosans_16_regular);   EpdFontFamily notosans16Family(&notosans16Font);
EpdFont notosans18Font(&notosans_18_regular);   EpdFontFamily notosans18Family(&notosans18Font);
EpdFont dyslexic10Font(&opendyslexic_10_regular); EpdFontFamily dyslexic10Family(&dyslexic10Font);
EpdFont dyslexic12Font(&opendyslexic_12_regular); EpdFontFamily dyslexic12Family(&dyslexic12Font);
EpdFont dyslexic14Font(&opendyslexic_14_regular); EpdFontFamily dyslexic14Family(&dyslexic14Font);
EpdFont ui12Font(&ubuntu_12_regular);             EpdFontFamily ui12Family(&ui12Font);

// ── App state ─────────────────────────────────────────────────────────────────
BookReader reader;
BookState  state;
bool       bookLoaded = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

void registerFonts() {
  renderer.insertFont(-1905494168, bookerly12Family);  // BOOKERLY_12
  renderer.insertFont( 1233852315, bookerly14Family);  // BOOKERLY_14
  renderer.insertFont( 1588566790, bookerly16Family);  // BOOKERLY_16
  renderer.insertFont(  681638548, bookerly18Family);  // BOOKERLY_18
  renderer.insertFont(-1559651934, notosans12Family);  // NOTOSANS_12
  renderer.insertFont(-1014561631, notosans14Family);  // NOTOSANS_14
  renderer.insertFont(-1422711852, notosans16Family);  // NOTOSANS_16
  renderer.insertFont( 1237754772, notosans18Family);  // NOTOSANS_18
  renderer.insertFont(-1374689004, dyslexic10Family);  // OPENDYSLEXIC_10
  renderer.insertFont( -795539541, dyslexic12Family);  // OPENDYSLEXIC_12
  renderer.insertFont(-1676627620, dyslexic14Family);  // OPENDYSLEXIC_14
  renderer.insertFont( -359249323, ui12Family);        // UI_12
}

void renderPage() {
  auto lines = reader.getPageLines(state.page);
  auto orientation = static_cast<GfxRenderer::Orientation>(state.orientation);
  PageRenderer::render(renderer, lines, state.font, state.size,
                       state.page, reader.pageCount(), orientation);
}


void enterSleep() {
  LOG_INF("MAIN", "Sleeping — syncing progress");

  DeviceServer::begin([]() {
  });

  for (int i = 0; i < 40; i++) {
    DeviceServer::handleLoop();
    delay(250);
  }

  DeviceServer::end();

  renderCoverSleepScreen();

  display.deepSleep();
  powerManager.startDeepSleep(gpio);
}

void doSwap() {
  LOG_INF("MAIN", "Swap Book requested");

  PageRenderer::renderSyncScreen(renderer, "Connecting to shelf...");

  DeviceServer::begin([]() {
  });

  PageRenderer::renderSyncScreen(renderer, "Waiting for shelf...");

  const unsigned long start = millis();
  while (millis() - start < 30000) {
    DeviceServer::handleLoop();
    delay(50);
    if (!DeviceServer::isRunning()) break;
  }

  DeviceServer::end();

  state = StateManager::load();
  if (!StateManager::exists()) {
    PageRenderer::renderMessage(renderer, "No book queued.", "Send one from the shelf app.");
    return;
  }

  if (!reader.open(state.font, state.size)) {
    PageRenderer::renderMessage(renderer, "Book file missing.", "Re-send from shelf.");
    return;
  }

  if (state.page >= reader.pageCount()) state.page = reader.pageCount() - 1;
  if (state.page < 0) state.page = 0;

  renderPage();
}

void doReturn() {
  LOG_INF("MAIN", "Return Book requested");

  PageRenderer::renderSyncScreen(renderer, "Connecting to shelf...");

  DeviceServer::begin([]() {
  });

  PageRenderer::renderSyncScreen(renderer, "Waiting for shelf...");

  const unsigned long start = millis();
  while (millis() - start < 30000) {
    DeviceServer::handleLoop();
    delay(50);
    if (!DeviceServer::isRunning()) break;
  }

  DeviceServer::end();

  Storage.removeDir("/book");
  Storage.mkdir("/book");
  StateManager::save(BookState{});

  PageRenderer::renderMessage(renderer, "Book returned.", "Send a new one from the shelf app.");
}

// Render the book cover as the sleep screen
void renderCoverSleepScreen() {
  HalFile file;
  if (!Storage.openFileForRead("MAIN", "/book/cover.bmp", file)) {
    LOG_WRN("MAIN", "No cover.bmp for sleep screen");
    return;
  }

  Bitmap bitmap(file);
  if (bitmap.parseHeaders() != BmpReaderError::Ok) {
    LOG_ERR("MAIN", "Failed to parse cover.bmp");
    return;
  }

  const int pageWidth = renderer.getScreenWidth();
  const int pageHeight = renderer.getScreenHeight();

  // Calculate scaling to fit within display while preserving aspect ratio
  int x = 0, y = 0;
  float cropX = 0, cropY = 0;

  if (bitmap.getWidth() > pageWidth || bitmap.getHeight() > pageHeight) {
    float ratio = static_cast<float>(bitmap.getWidth()) / static_cast<float>(bitmap.getHeight());
    float screenRatio = static_cast<float>(pageWidth) / static_cast<float>(pageHeight);

    if (ratio > screenRatio) {
      // Image wider than screen — scale to fit width
      x = 0;
      y = std::round((static_cast<float>(pageHeight) - static_cast<float>(pageWidth) / ratio) / 2);
    } else {
      // Image taller than screen — scale to fit height
      x = std::round((static_cast<float>(pageWidth) - static_cast<float>(pageHeight) * ratio) / 2);
      y = 0;
    }
  } else {
    // Center smaller images
    x = (pageWidth - bitmap.getWidth()) / 2;
    y = (pageHeight - bitmap.getHeight()) / 2;
  }

  renderer.clearScreen();
  renderer.drawBitmap(bitmap, x, y, pageWidth, pageHeight, cropX, cropY);
  renderer.displayBuffer(HalDisplay::HALF_REFRESH);

  LOG_INF("MAIN", "Sleep screen: cover displayed");
}

// ── setup() ───────────────────────────────────────────────────────────────────

void setup() {
  HalSystem::begin();
  gpio.begin();
  powerManager.begin();

  Serial.begin(115200);
  const unsigned long t = millis();
  while (!Serial && millis() - t < 500) delay(10);

  if (!Storage.begin()) {
    display.begin();
    renderer.begin();
    registerFonts();
    PageRenderer::renderMessage(renderer, "SD card error.", "Check card and restart.");
    return;
  }

  config.load();
  display.begin();
  renderer.begin();
  registerFonts();

  state = StateManager::load();

  if (!StateManager::exists()) {
    PageRenderer::renderMessage(renderer,
      "No book loaded.",
      "Connect via USB to send a book.");
    // Don't return — loop() must run so USB sync can receive files
  } else if (!reader.open(state.font, state.size)) {
    PageRenderer::renderMessage(renderer, "Book file missing.", "Re-send from shelf.");
    // Don't return — same reason
  } else {
    bookLoaded = true;
    if (state.page >= reader.pageCount()) state.page = reader.pageCount() - 1;
    if (state.page < 0) state.page = 0;
    renderPage();
  }
}

// ── loop() ────────────────────────────────────────────────────────────────────

void loop() {
  gpio.update();

  // Dispatch serial commands while USB is connected
  if (gpio.isUsbConnected() && Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (UsbSync::handleLine(line, renderer)) {
      state = StateManager::load();
      bookLoaded = StateManager::exists() && reader.open(state.font, state.size);
      if (bookLoaded) {
        if (state.page >= reader.pageCount()) state.page = reader.pageCount() - 1;
        if (state.page < 0) state.page = 0;
        renderPage();
      } else {
        PageRenderer::renderMessage(renderer, "No book on device.", "Send one from the shelf.");
      }
    } else if (UsbSetup::handleLine(line, config)) {
      PageRenderer::renderMessage(renderer, "Config updated.", nullptr);
      delay(1500);
      if (StateManager::exists()) renderPage();
    }
  }

  const bool goBack    = gpio.wasPressed(HalGPIO::BTN_UP)   || gpio.wasPressed(HalGPIO::BTN_LEFT);
  const bool goForward = gpio.wasPressed(HalGPIO::BTN_DOWN) || gpio.wasPressed(HalGPIO::BTN_RIGHT);

  if (bookLoaded) {
    // Page navigation
    if (goBack && state.page > 0) {
      state.page--;
      StateManager::save(state);
      renderPage();
    } else if (goForward && state.page < reader.pageCount() - 1) {
      state.page++;
      StateManager::save(state);
      renderPage();
    }
  }

  // Settings menu (accessible even without a book)
  if (gpio.wasPressed(HalGPIO::BTN_CONFIRM)) {
    BookState updated = SettingsMenu::run(renderer, gpio, state);
    if (SettingsMenu::isSwapRequested(updated)) {
      doSwap();
    } else if (bookLoaded && (updated.font != state.font || updated.size != state.size)) {
      if (reader.open(updated.font, updated.size)) {
        if (updated.page >= reader.pageCount()) updated.page = reader.pageCount() - 1;
        state = updated;
        StateManager::save(state);
      }
    } else {
      state = updated;
      StateManager::save(state);
    }
    if (bookLoaded) renderPage();
  }

  // Power button long press → sleep
  if (gpio.isPressed(HalGPIO::BTN_POWER) && gpio.getHeldTime() > 800) {
    enterSleep();
  }

  // Auto-sleep after 5 minutes of inactivity
  static unsigned long lastActivity = millis();
  if (goBack || goForward || gpio.wasAnyPressed()) lastActivity = millis();
  if (millis() - lastActivity > 5UL * 60UL * 1000UL) {
    enterSleep();
  }

  delay(10);
}
