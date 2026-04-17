#pragma once
#include <Arduino.h>
#include <SPI.h>

class EInkDisplay {
 public:
  static constexpr uint16_t DISPLAY_WIDTH        = 800;
  static constexpr uint16_t DISPLAY_HEIGHT       = 480;
  static constexpr uint16_t X3_DISPLAY_WIDTH     = 792;
  static constexpr uint16_t X3_DISPLAY_HEIGHT    = 528;
  static constexpr uint16_t DISPLAY_WIDTH_BYTES  = DISPLAY_WIDTH / 8;
  static constexpr uint32_t BUFFER_SIZE          = DISPLAY_WIDTH_BYTES * DISPLAY_HEIGHT;
  // Largest possible buffer (X3 panel)
  static constexpr uint32_t MAX_BUFFER_SIZE      = (X3_DISPLAY_WIDTH / 8) * X3_DISPLAY_HEIGHT;

  enum RefreshMode { FULL_REFRESH, HALF_REFRESH, FAST_REFRESH };

  EInkDisplay(int8_t sclk, int8_t mosi, int8_t cs, int8_t dc, int8_t rst, int8_t busy);

  void begin();

  // Panel geometry — must be called before begin() to activate X3 mode
  void setDisplayX3();
  void requestResync(uint8_t settlePasses = 2);

  // Frame buffer
  void clearScreen(uint8_t color = 0xFF) const;
  void drawImage(const uint8_t* imageData, uint16_t x, uint16_t y, uint16_t w, uint16_t h,
                 bool fromProgmem = false) const;
  void drawImageTransparent(const uint8_t* imageData, uint16_t x, uint16_t y, uint16_t w, uint16_t h,
                            bool fromProgmem = false) const;
  void setFramebuffer(const uint8_t* bwBuffer) const;

  // Display update
  void displayBuffer(RefreshMode mode = FAST_REFRESH, bool turnOffScreen = false);
  void refreshDisplay(RefreshMode mode = FAST_REFRESH, bool turnOffScreen = false);
  void displayWindow(uint16_t x, uint16_t y, uint16_t w, uint16_t h, bool turnOffScreen = false);

  // Grayscale
  void copyGrayscaleBuffers(const uint8_t* lsbBuffer, const uint8_t* msbBuffer);
  void copyGrayscaleLsbBuffers(const uint8_t* lsbBuffer);
  void copyGrayscaleMsbBuffers(const uint8_t* msbBuffer);
  void cleanupGrayscaleBuffers(const uint8_t* bwBuffer);
  void displayGrayBuffer(bool turnOffScreen = false);

  // Power
  void deepSleep();

  // Accessors
  uint8_t*  getFrameBuffer()       const { return frameBuffer; }
  uint16_t  getDisplayWidth()      const { return displayWidth; }
  uint16_t  getDisplayHeight()     const { return displayHeight; }
  uint16_t  getDisplayWidthBytes() const { return displayWidthBytes; }
  uint32_t  getBufferSize()        const { return bufferSize; }

  // Debug
  void saveFrameBufferAsPBM(const char* filename);

 private:
  // SPI pins
  int8_t _sclk, _mosi, _cs, _dc, _rst, _busy;
  SPISettings spiSettings;

  // Runtime geometry (changes when X3 mode is activated)
  uint16_t displayWidth      = DISPLAY_WIDTH;
  uint16_t displayHeight     = DISPLAY_HEIGHT;
  uint16_t displayWidthBytes = DISPLAY_WIDTH_BYTES;
  uint32_t bufferSize        = BUFFER_SIZE;

  // Frame buffers — statically allocated to max X3 size
  uint8_t frameBuffer0[MAX_BUFFER_SIZE];
#ifndef EINK_DISPLAY_SINGLE_BUFFER_MODE
  uint8_t frameBuffer1[MAX_BUFFER_SIZE];
  uint8_t* frameBufferActive;
#endif
  uint8_t* frameBuffer;

  // State flags
  bool isScreenOn      = false;
  bool inGrayscaleMode = false;
  bool drawGrayscale   = false;
  bool customLutActive = false;
  bool _x3Mode         = false;

  // X3 differential refresh tracking
  bool    _x3RedRamSynced                = false;
  uint8_t _x3InitialFullSyncsRemaining   = 0;
  bool    _x3ForceFullSyncNext           = false;
  uint8_t _x3ForcedConditionPassesNext   = 0;
  struct X3GrayState { bool lastBaseWasPartial = false; bool lsbValid = false; } _x3GrayState;

  // Low-level SPI
  void sendCommand(uint8_t command);
  void sendData(uint8_t data);
  void sendData(const uint8_t* data, uint16_t length);

  // Init / control helpers
  void resetDisplay();
  void initDisplayController();
  void setDisplayDimensions(uint16_t width, uint16_t height);
  void setRamArea(uint16_t x, uint16_t y, uint16_t w, uint16_t h);
  void writeRamBuffer(uint8_t ramBuffer, const uint8_t* data, uint32_t size);
  void waitWhileBusy(const char* comment = nullptr);
  void waitForRefresh(const char* comment = nullptr);
  void setCustomLUT(bool enabled, const unsigned char* lutData = nullptr);
  void grayscaleRevert();
#ifndef EINK_DISPLAY_SINGLE_BUFFER_MODE
  void swapBuffers();
#endif
};
