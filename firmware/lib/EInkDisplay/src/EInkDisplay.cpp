// Source: https://github.com/open-x4-epaper/community-sdk (MIT License)
// Vendored into x4-onebook/firmware/lib for standalone build — no submodule required.
#include "EInkDisplay.h"

#include <cstring>
#include <fstream>
#include <vector>

#define CMD_SOFT_RESET           0x12
#define CMD_BOOSTER_SOFT_START   0x0C
#define CMD_DRIVER_OUTPUT_CONTROL 0x01
#define CMD_BORDER_WAVEFORM      0x3C
#define CMD_TEMP_SENSOR_CONTROL  0x18
#define CMD_DATA_ENTRY_MODE      0x11
#define CMD_SET_RAM_X_RANGE      0x44
#define CMD_SET_RAM_Y_RANGE      0x45
#define CMD_SET_RAM_X_COUNTER    0x4E
#define CMD_SET_RAM_Y_COUNTER    0x4F
#define CMD_WRITE_RAM_BW         0x24
#define CMD_WRITE_RAM_RED        0x26
#define CMD_AUTO_WRITE_BW_RAM    0x46
#define CMD_AUTO_WRITE_RED_RAM   0x47
#define CMD_DISPLAY_UPDATE_CTRL1 0x21
#define CMD_DISPLAY_UPDATE_CTRL2 0x22
#define CMD_MASTER_ACTIVATION    0x20
#define CTRL1_NORMAL             0x00
#define CTRL1_BYPASS_RED         0x40
#define CMD_WRITE_LUT            0x32
#define CMD_GATE_VOLTAGE         0x03
#define CMD_SOURCE_VOLTAGE       0x04
#define CMD_WRITE_VCOM           0x2C
#define CMD_WRITE_TEMP           0x1A
#define CMD_DEEP_SLEEP           0x10

const unsigned char lut_grayscale[] PROGMEM = {
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x54,0x54,0x40,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0xAA,0xA0,0xA8,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0xA2,0x22,0x20,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x01,0x01,0x01,0x01,0x00, 0x01,0x01,0x01,0x01,0x00,
    0x01,0x01,0x01,0x01,0x00, 0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,
    0x8F,0x8F,0x8F,0x8F,0x8F,
    0x17,0x41,0xA8,0x32,0x30,
    0x00,0x00};

const unsigned char lut_grayscale_revert[] PROGMEM = {
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x54,0x54,0x54,0x54,0x00,0x00,0x00,0x00,0x00,0x00,
    0xA8,0xA8,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0xFC,0xFC,0xFC,0xFC,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x01,0x01,0x01,0x01,0x01, 0x01,0x01,0x01,0x01,0x01,
    0x01,0x01,0x01,0x01,0x00, 0x01,0x01,0x01,0x01,0x00,
    0x00,0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,
    0x8F,0x8F,0x8F,0x8F,0x8F,
    0x17,0x41,0xA8,0x32,0x30,
    0x00,0x00};

const uint8_t lut_x3_vcom_full[] PROGMEM = {0x00,0x06,0x02,0x06,0x06,0x01,0x00,0x05,0x01,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_ww_full[]   PROGMEM = {0x20,0x06,0x02,0x06,0x06,0x01,0x00,0x05,0x01,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_bw_full[]   PROGMEM = {0xAA,0x06,0x02,0x06,0x06,0x01,0x80,0x05,0x01,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_wb_full[]   PROGMEM = {0x55,0x06,0x02,0x06,0x06,0x01,0x40,0x05,0x01,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_bb_full[]   PROGMEM = {0x10,0x06,0x02,0x06,0x06,0x01,0x00,0x05,0x01,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};

const uint8_t lut_x3_vcom_gray[] PROGMEM = {0x00,0x03,0x02,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_ww_gray[]   PROGMEM = {0x20,0x03,0x02,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_bw_gray[]   PROGMEM = {0x80,0x03,0x02,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_wb_gray[]   PROGMEM = {0x00,0x03,0x02,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_bb_gray[]   PROGMEM = {0x00,0x03,0x02,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};

const uint8_t lut_x3_vcom_img[]  PROGMEM = {0x00,0x08,0x0B,0x02,0x03,0x01,0x00,0x0C,0x02,0x07,0x02,0x01,0x00,0x01,0x00,0x02,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_ww_img[]    PROGMEM = {0xA8,0x08,0x0B,0x02,0x03,0x01,0x44,0x0C,0x02,0x07,0x02,0x01,0x04,0x01,0x00,0x02,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_bw_img[]    PROGMEM = {0x80,0x08,0x0B,0x02,0x03,0x01,0x62,0x0C,0x02,0x07,0x02,0x01,0x00,0x01,0x00,0x02,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_wb_img[]    PROGMEM = {0x88,0x08,0x0B,0x02,0x03,0x01,0x60,0x0C,0x02,0x07,0x02,0x01,0x00,0x01,0x00,0x02,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_bb_img[]    PROGMEM = {0x00,0x08,0x0B,0x02,0x03,0x01,0x4A,0x0C,0x02,0x07,0x02,0x01,0x88,0x01,0x00,0x02,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};

const uint8_t lut_x3_vcom_fast[] PROGMEM = {0x00,0x18,0x18,0x01,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_ww_fast[]   PROGMEM = {0x60,0x18,0x18,0x01,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_bw_fast[]   PROGMEM = {0x20,0x18,0x18,0x01,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_wb_fast[]   PROGMEM = {0x10,0x18,0x18,0x01,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};
const uint8_t lut_x3_bb_fast[]   PROGMEM = {0x90,0x18,0x18,0x01,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00};

// ---- Implementation (verbatim from open-x4-epaper/community-sdk) ----

void EInkDisplay::setDisplayDimensions(uint16_t width, uint16_t height) {
  displayWidth = width; displayHeight = height;
  displayWidthBytes = width / 8; bufferSize = displayWidthBytes * height;
  _x3Mode = false;
}
void EInkDisplay::setDisplayX3() { setDisplayDimensions(X3_DISPLAY_WIDTH, X3_DISPLAY_HEIGHT); _x3Mode = true; }
void EInkDisplay::requestResync(uint8_t settlePasses) {
  _x3ForceFullSyncNext = _x3Mode; _x3ForcedConditionPassesNext = _x3Mode ? settlePasses : 0;
}

EInkDisplay::EInkDisplay(int8_t sclk, int8_t mosi, int8_t cs, int8_t dc, int8_t rst, int8_t busy)
    : _sclk(sclk), _mosi(mosi), _cs(cs), _dc(dc), _rst(rst), _busy(busy),
      frameBuffer(nullptr),
#ifndef EINK_DISPLAY_SINGLE_BUFFER_MODE
      frameBufferActive(nullptr),
#endif
      customLutActive(false) {}

void EInkDisplay::begin() {
  frameBuffer = frameBuffer0;
#ifndef EINK_DISPLAY_SINGLE_BUFFER_MODE
  frameBufferActive = frameBuffer1;
#endif
  memset(frameBuffer0, 0xFF, bufferSize);
  _x3RedRamSynced = false; _x3InitialFullSyncsRemaining = _x3Mode ? 2 : 0;
  _x3ForceFullSyncNext = false; _x3ForcedConditionPassesNext = 0; _x3GrayState = {};
#ifndef EINK_DISPLAY_SINGLE_BUFFER_MODE
  memset(frameBuffer1, 0xFF, bufferSize);
#endif
  SPI.begin(_sclk, -1, _mosi, _cs);
  const uint32_t spiHz = _x3Mode ? 10000000 : 40000000;
  spiSettings = SPISettings(spiHz, MSBFIRST, SPI_MODE0);
  pinMode(_cs, OUTPUT); pinMode(_dc, OUTPUT); pinMode(_rst, OUTPUT); pinMode(_busy, INPUT);
  digitalWrite(_cs, HIGH); digitalWrite(_dc, HIGH);
  resetDisplay(); initDisplayController();
}

void EInkDisplay::resetDisplay() {
  digitalWrite(_rst, HIGH); delay(20); digitalWrite(_rst, LOW); delay(2);
  digitalWrite(_rst, HIGH); delay(20);
  if (_x3Mode) delay(50);
}

void EInkDisplay::waitForRefresh(const char* comment) {
  unsigned long start = millis();
  if (!_x3Mode) {
    while (digitalRead(_busy) == HIGH) { delay(1); if (millis()-start > 30000) break; }
  } else {
    bool sawLow = false;
    while (digitalRead(_busy) == HIGH) { delay(1); if (millis()-start > 1000) break; }
    if (digitalRead(_busy) == LOW) { sawLow = true; while (digitalRead(_busy)==LOW) { delay(1); if (millis()-start>30000) break; } }
    if (!sawLow) return;
  }
  if (comment && Serial) Serial.printf("[%lu]   Refresh done: %s (%lu ms)\n", millis(), comment, millis()-start);
}

void EInkDisplay::waitWhileBusy(const char* comment) {
  unsigned long start = millis();
  if (!_x3Mode) {
    while (digitalRead(_busy) == HIGH) { delay(1); if (millis()-start > 30000) break; }
  } else {
    bool sawLow = false;
    while (digitalRead(_busy) == HIGH) { delay(1); if (millis()-start > 1000) break; }
    if (digitalRead(_busy) == LOW) { sawLow = true; while (digitalRead(_busy)==LOW) { delay(1); if (millis()-start>30000) break; } }
    if (!sawLow) return;
  }
  if (comment && Serial) Serial.printf("[%lu]   Wait: %s (%lu ms)\n", millis(), comment, millis()-start);
}

void EInkDisplay::sendCommand(uint8_t command) {
  SPI.beginTransaction(spiSettings); digitalWrite(_dc,LOW); digitalWrite(_cs,LOW);
  SPI.transfer(command); digitalWrite(_cs,HIGH); SPI.endTransaction();
}
void EInkDisplay::sendData(uint8_t data) {
  SPI.beginTransaction(spiSettings); digitalWrite(_dc,HIGH); digitalWrite(_cs,LOW);
  SPI.transfer(data); digitalWrite(_cs,HIGH); SPI.endTransaction();
}
void EInkDisplay::sendData(const uint8_t* data, uint16_t length) {
  SPI.beginTransaction(spiSettings); digitalWrite(_dc,HIGH); digitalWrite(_cs,LOW);
  SPI.writeBytes(data, length); digitalWrite(_cs,HIGH); SPI.endTransaction();
}

void EInkDisplay::initDisplayController() {
  if (_x3Mode) {
    sendCommand(0x00); sendData(0x3F); sendData(0x08);
    sendCommand(0x61); sendData(0x03); sendData(0x18); sendData(0x02); sendData(0x58);
    sendCommand(0x65); sendData(0x00); sendData(0x00); sendData(0x00); sendData(0x00);
    sendCommand(0x03); sendData(0x1D);
    sendCommand(0x01); sendData(0x07); sendData(0x17); sendData(0x3F); sendData(0x3F); sendData(0x17);
    sendCommand(0x82); sendData(0x1D);
    sendCommand(0x06); sendData(0x25); sendData(0x25); sendData(0x3C); sendData(0x37);
    sendCommand(0x30); sendData(0x09);
    sendCommand(0xE1); sendData(0x02);
    sendCommand(0x20); sendData(lut_x3_vcom_full, 42);
    sendCommand(0x21); sendData(lut_x3_ww_full, 42);
    sendCommand(0x22); sendData(lut_x3_bw_full, 42);
    sendCommand(0x23); sendData(lut_x3_wb_full, 42);
    sendCommand(0x24); sendData(lut_x3_bb_full, 42);
    isScreenOn = false; return;
  }
  sendCommand(CMD_SOFT_RESET); waitWhileBusy("SOFT_RESET");
  sendCommand(CMD_TEMP_SENSOR_CONTROL); sendData(0x80);
  sendCommand(CMD_BOOSTER_SOFT_START); sendData(0xAE); sendData(0xC7); sendData(0xC3); sendData(0xC0); sendData(0x40);
  sendCommand(CMD_DRIVER_OUTPUT_CONTROL); sendData((displayHeight-1)%256); sendData((displayHeight-1)/256); sendData(0x02);
  sendCommand(CMD_BORDER_WAVEFORM); sendData(0x01);
  setRamArea(0, 0, displayWidth, displayHeight);
  sendCommand(CMD_AUTO_WRITE_BW_RAM); sendData(0xF7); waitWhileBusy("AUTO_BW");
  sendCommand(CMD_AUTO_WRITE_RED_RAM); sendData(0xF7); waitWhileBusy("AUTO_RED");
}

void EInkDisplay::setRamArea(const uint16_t x, uint16_t y, uint16_t w, uint16_t h) {
  y = displayHeight - y - h;
  sendCommand(CMD_DATA_ENTRY_MODE); sendData(0x01);
  sendCommand(CMD_SET_RAM_X_RANGE); sendData(x%256); sendData(x/256); sendData((x+w-1)%256); sendData((x+w-1)/256);
  sendCommand(CMD_SET_RAM_Y_RANGE); sendData((y+h-1)%256); sendData((y+h-1)/256); sendData(y%256); sendData(y/256);
  sendCommand(CMD_SET_RAM_X_COUNTER); sendData(x%256); sendData(x/256);
  sendCommand(CMD_SET_RAM_Y_COUNTER); sendData((y+h-1)%256); sendData((y+h-1)/256);
}

void EInkDisplay::clearScreen(const uint8_t color) const { memset(frameBuffer, color, bufferSize); }

void EInkDisplay::drawImage(const uint8_t* imageData, const uint16_t x, const uint16_t y,
                            const uint16_t w, const uint16_t h, const bool fromProgmem) const {
  const uint16_t imageWidthBytes = w / 8;
  for (uint16_t row = 0; row < h; row++) {
    const uint16_t destY = y + row; if (destY >= displayHeight) break;
    const uint16_t destOffset = destY * displayWidthBytes + (x/8);
    const uint16_t srcOffset  = row * imageWidthBytes;
    for (uint16_t col = 0; col < imageWidthBytes; col++) {
      if ((x/8 + col) >= displayWidthBytes) break;
      frameBuffer[destOffset+col] = fromProgmem ? pgm_read_byte(&imageData[srcOffset+col]) : imageData[srcOffset+col];
    }
  }
}

void EInkDisplay::drawImageTransparent(const uint8_t* imageData, const uint16_t x, const uint16_t y,
                                       const uint16_t w, const uint16_t h, const bool fromProgmem) const {
  const uint16_t imageWidthBytes = w / 8;
  for (uint16_t row = 0; row < h; row++) {
    const uint16_t destY = y + row; if (destY >= displayHeight) break;
    const uint16_t destOffset = destY * displayWidthBytes + (x/8);
    const uint16_t srcOffset  = row * imageWidthBytes;
    for (uint16_t col = 0; col < imageWidthBytes; col++) {
      if ((x/8 + col) >= displayWidthBytes) break;
      uint8_t b = fromProgmem ? pgm_read_byte(&imageData[srcOffset+col]) : imageData[srcOffset+col];
      frameBuffer[destOffset+col] &= b;
    }
  }
}

void EInkDisplay::writeRamBuffer(uint8_t ramBuffer, const uint8_t* data, uint32_t size) {
  sendCommand(ramBuffer); sendData(data, size);
}
void EInkDisplay::setFramebuffer(const uint8_t* bwBuffer) const { memcpy(frameBuffer, bwBuffer, bufferSize); }

#ifndef EINK_DISPLAY_SINGLE_BUFFER_MODE
void EInkDisplay::swapBuffers() { uint8_t* t = frameBuffer; frameBuffer = frameBufferActive; frameBufferActive = t; }
#endif

void EInkDisplay::grayscaleRevert() {
  if (!inGrayscaleMode) return;
  inGrayscaleMode = false;
  setCustomLUT(true, lut_grayscale_revert);
  refreshDisplay(FAST_REFRESH);
  setCustomLUT(false);
}

void EInkDisplay::copyGrayscaleLsbBuffers(const uint8_t* lsbBuffer) {
  if (!lsbBuffer) { _x3GrayState.lsbValid = false; return; }
  if (_x3Mode) {
    uint8_t row[128];
    sendCommand(0x10);
    for (uint16_t y = 0; y < displayHeight; y++) {
      const uint16_t srcY = displayHeight-1-y;
      const uint8_t* src = lsbBuffer + (uint32_t)srcY * displayWidthBytes;
      for (uint16_t x = 0; x < displayWidthBytes; x++) row[x] = src[x];
      sendData(row, displayWidthBytes);
    }
    _x3GrayState.lsbValid = true; return;
  }
  setRamArea(0, 0, displayWidth, displayHeight);
  writeRamBuffer(CMD_WRITE_RAM_BW, lsbBuffer, bufferSize);
}

void EInkDisplay::copyGrayscaleMsbBuffers(const uint8_t* msbBuffer) {
  if (!msbBuffer) return;
  if (_x3Mode) {
    if (!_x3GrayState.lsbValid) return;
    uint8_t row[128];
    sendCommand(0x13);
    for (uint16_t y = 0; y < displayHeight; y++) {
      const uint16_t srcY = displayHeight-1-y;
      const uint8_t* src = msbBuffer + (uint32_t)srcY * displayWidthBytes;
      for (uint16_t x = 0; x < displayWidthBytes; x++) row[x] = src[x];
      sendData(row, displayWidthBytes);
    }
    return;
  }
  setRamArea(0, 0, displayWidth, displayHeight);
  writeRamBuffer(CMD_WRITE_RAM_RED, msbBuffer, bufferSize);
}

void EInkDisplay::copyGrayscaleBuffers(const uint8_t* lsbBuffer, const uint8_t* msbBuffer) {
  if (_x3Mode) { copyGrayscaleLsbBuffers(lsbBuffer); copyGrayscaleMsbBuffers(msbBuffer); return; }
  setRamArea(0, 0, displayWidth, displayHeight);
  writeRamBuffer(CMD_WRITE_RAM_BW, lsbBuffer, bufferSize);
  writeRamBuffer(CMD_WRITE_RAM_RED, msbBuffer, bufferSize);
}

#ifdef EINK_DISPLAY_SINGLE_BUFFER_MODE
void EInkDisplay::cleanupGrayscaleBuffers(const uint8_t* bwBuffer) {
  if (_x3Mode) {
    if (!bwBuffer) return;
    uint8_t row[128];
    auto sendMirrored = [&](const uint8_t* plane, bool invert) {
      for (uint16_t y = 0; y < displayHeight; y++) {
        const uint16_t srcY = displayHeight-1-y;
        const uint8_t* src = plane + (uint32_t)srcY * displayWidthBytes;
        for (uint16_t x = 0; x < displayWidthBytes; x++) row[x] = invert ? ~src[x] : src[x];
        sendData(row, displayWidthBytes);
      }
    };
    sendCommand(0x13); sendMirrored(bwBuffer, false);
    sendCommand(0x10); sendMirrored(bwBuffer, false);
    _x3RedRamSynced = true; _x3ForceFullSyncNext = false; _x3ForcedConditionPassesNext = 0; return;
  }
  setRamArea(0, 0, displayWidth, displayHeight);
  writeRamBuffer(CMD_WRITE_RAM_RED, bwBuffer, bufferSize);
}
#endif

void EInkDisplay::displayBuffer(RefreshMode mode, const bool turnOffScreen) {
  if (!_x3Mode && !isScreenOn && !turnOffScreen) mode = HALF_REFRESH;
  if (inGrayscaleMode) { inGrayscaleMode = false; grayscaleRevert(); }

  if (_x3Mode) {
    const bool fastMode = (mode != FULL_REFRESH);
    uint8_t row[128];
    auto sendX3 = [&](uint8_t cmd, const uint8_t* data, uint16_t len) {
      SPI.beginTransaction(spiSettings); digitalWrite(_cs,LOW); digitalWrite(_dc,LOW); SPI.transfer(cmd);
      if (len>0&&data) { digitalWrite(_dc,HIGH); SPI.writeBytes(data,len); }
      digitalWrite(_cs,HIGH); SPI.endTransaction();
    };
    auto sendX3b = [&](uint8_t cmd, uint8_t d0, uint8_t d1) { const uint8_t d[2]={d0,d1}; sendX3(cmd,d,2); };
    auto sendMirrored = [&](const uint8_t* plane, bool invert) {
      for (uint16_t y=0;y<displayHeight;y++) {
        const uint16_t srcY=displayHeight-1-y;
        const uint8_t* src=plane+(uint32_t)srcY*displayWidthBytes;
        for (uint16_t x=0;x<displayWidthBytes;x++) row[x]=invert?~src[x]:src[x];
        sendData(row,displayWidthBytes);
      }
    };
    const bool forcedFullSync = _x3ForceFullSyncNext;
    const bool doFullSync = !fastMode||!_x3RedRamSynced||_x3InitialFullSyncsRemaining>0||forcedFullSync;
    _x3GrayState.lastBaseWasPartial = !doFullSync;
    if (doFullSync) {
      sendX3(0x20,lut_x3_vcom_img,42); sendX3(0x21,lut_x3_ww_img,42); sendX3(0x22,lut_x3_bw_img,42); sendX3(0x23,lut_x3_wb_img,42); sendX3(0x24,lut_x3_bb_img,42);
      sendCommand(0x13); sendMirrored(frameBuffer,true);
      sendCommand(0x10); sendMirrored(frameBuffer,true);
      sendX3b(0x50,0xA9,0x07);
    } else {
      sendX3(0x20,lut_x3_vcom_full,42); sendX3(0x21,lut_x3_ww_full,42); sendX3(0x22,lut_x3_bw_full,42); sendX3(0x23,lut_x3_wb_full,42); sendX3(0x24,lut_x3_bb_full,42);
      sendCommand(0x13); sendMirrored(frameBuffer,false);
      sendX3b(0x50,0x29,0x07);
    }
    if (!isScreenOn||doFullSync) { sendCommand(0x04); waitForRefresh("X3_CMD04"); isScreenOn=true; }
    sendCommand(0x12); waitForRefresh("X3_CMD12");
    if (turnOffScreen) { sendCommand(0x02); waitForRefresh("X3_POWEROFF"); isScreenOn=false; }
    if (!fastMode) delay(200);
    uint8_t postPasses = 0;
    if (doFullSync) {
      if (forcedFullSync) postPasses=_x3ForcedConditionPassesNext;
      else if (_x3InitialFullSyncsRemaining==1) postPasses=1;
    }
    if (postPasses>0) {
      const uint8_t w[9]={0,0,0,(uint8_t)(displayWidth-1),(uint8_t)((displayWidth-1)>>8),0,0,(uint8_t)(displayHeight-1),(uint8_t)((displayHeight-1)>>8)};
      sendX3(0x20,lut_x3_vcom_full,42); sendX3(0x21,lut_x3_ww_full,42); sendX3(0x22,lut_x3_bw_full,42); sendX3(0x23,lut_x3_wb_full,42); sendX3(0x24,lut_x3_bb_full,42);
      sendX3b(0x50,0x29,0x07);
      for (uint8_t i=0;i<postPasses;i++) {
        sendCommand(0x91); sendX3(0x90,w,9);
        sendCommand(0x13); sendMirrored(frameBuffer,false);
        sendCommand(0x92);
        if (!isScreenOn) { sendCommand(0x04); waitForRefresh("X3_COND04"); isScreenOn=true; }
        sendCommand(0x12); waitForRefresh("X3_COND12");
      }
    }
    sendCommand(0x10); sendMirrored(frameBuffer,false);
    _x3RedRamSynced=true;
    if (doFullSync&&_x3InitialFullSyncsRemaining>0) _x3InitialFullSyncsRemaining--;
    _x3ForceFullSyncNext=false; _x3ForcedConditionPassesNext=0;
    return;
  }

  setRamArea(0,0,displayWidth,displayHeight);
  if (mode!=FAST_REFRESH) { writeRamBuffer(CMD_WRITE_RAM_BW,frameBuffer,bufferSize); writeRamBuffer(CMD_WRITE_RAM_RED,frameBuffer,bufferSize); }
  else {
    writeRamBuffer(CMD_WRITE_RAM_BW,frameBuffer,bufferSize);
#ifndef EINK_DISPLAY_SINGLE_BUFFER_MODE
    writeRamBuffer(CMD_WRITE_RAM_RED,frameBufferActive,bufferSize);
#endif
  }
#ifndef EINK_DISPLAY_SINGLE_BUFFER_MODE
  swapBuffers();
#endif
  refreshDisplay(mode,turnOffScreen);
#ifdef EINK_DISPLAY_SINGLE_BUFFER_MODE
  setRamArea(0,0,displayWidth,displayHeight);
  writeRamBuffer(CMD_WRITE_RAM_RED,frameBuffer,bufferSize);
#endif
}

void EInkDisplay::displayWindow(uint16_t x, uint16_t y, uint16_t w, uint16_t h, const bool turnOffScreen) {
  if (x+w>displayWidth||y+h>displayHeight) return;
  if (x%8!=0||w%8!=0) return;
  if (!frameBuffer) return;
  if (inGrayscaleMode) { inGrayscaleMode=false; grayscaleRevert(); }
  const uint16_t wBytes=(uint16_t)(w/8);
  std::vector<uint8_t> winBuf(wBytes*h);
  for (uint16_t row=0;row<h;row++) { memcpy(&winBuf[row*wBytes],&frameBuffer[(y+row)*displayWidthBytes+(x/8)],wBytes); }
  setRamArea(x,y,w,h);
  writeRamBuffer(CMD_WRITE_RAM_BW,winBuf.data(),winBuf.size());
#ifndef EINK_DISPLAY_SINGLE_BUFFER_MODE
  std::vector<uint8_t> prevBuf(wBytes*h);
  for (uint16_t row=0;row<h;row++) { memcpy(&prevBuf[row*wBytes],&frameBufferActive[(y+row)*displayWidthBytes+(x/8)],wBytes); }
  writeRamBuffer(CMD_WRITE_RAM_RED,prevBuf.data(),prevBuf.size());
#endif
  refreshDisplay(FAST_REFRESH,turnOffScreen);
#ifdef EINK_DISPLAY_SINGLE_BUFFER_MODE
  setRamArea(x,y,w,h); writeRamBuffer(CMD_WRITE_RAM_RED,winBuf.data(),winBuf.size());
#endif
}

void EInkDisplay::displayGrayBuffer(const bool turnOffScreen) {
  if (_x3Mode) {
    drawGrayscale=false; inGrayscaleMode=false;
    if (!_x3GrayState.lsbValid) return;
    auto sendX3=[&](uint8_t cmd,const uint8_t* data,uint16_t len){
      SPI.beginTransaction(spiSettings);digitalWrite(_cs,LOW);digitalWrite(_dc,LOW);SPI.transfer(cmd);
      if(len>0&&data){digitalWrite(_dc,HIGH);SPI.writeBytes(data,len);}
      digitalWrite(_cs,HIGH);SPI.endTransaction();
    };
    auto sendX3b=[&](uint8_t cmd,uint8_t d0,uint8_t d1){const uint8_t d[2]={d0,d1};sendX3(cmd,d,2);};
    sendX3(0x20,lut_x3_vcom_gray,42); sendX3(0x21,lut_x3_ww_gray,42); sendX3(0x22,lut_x3_bw_gray,42); sendX3(0x23,lut_x3_wb_gray,42); sendX3(0x24,lut_x3_bb_gray,42);
    sendX3b(0x50,0x29,0x07);
    if (!isScreenOn) { sendCommand(0x04); waitForRefresh("X3_GRAY04"); isScreenOn=true; }
    sendCommand(0x12); waitForRefresh("X3_GRAY12");
    if (turnOffScreen) { sendCommand(0x02); waitForRefresh("X3_GRAY_OFF"); isScreenOn=false; }
    _x3RedRamSynced=false; _x3ForceFullSyncNext=false; _x3ForcedConditionPassesNext=0; _x3GrayState.lsbValid=false;
    return;
  }
  drawGrayscale=false; inGrayscaleMode=true;
  setCustomLUT(true,lut_grayscale);
  refreshDisplay(FAST_REFRESH,turnOffScreen);
  setCustomLUT(false);
}

void EInkDisplay::refreshDisplay(const RefreshMode mode, const bool turnOffScreen) {
  if (_x3Mode) { displayBuffer(mode,turnOffScreen); return; }
  sendCommand(CMD_DISPLAY_UPDATE_CTRL1);
  sendData((mode==FAST_REFRESH) ? CTRL1_NORMAL : CTRL1_BYPASS_RED);
  uint8_t displayMode=0x00;
  if (!isScreenOn) { isScreenOn=true; displayMode|=0xC0; }
  if (turnOffScreen) { isScreenOn=false; displayMode|=0x03; }
  if (mode==FULL_REFRESH) displayMode|=0x34;
  else if (mode==HALF_REFRESH) { sendCommand(CMD_WRITE_TEMP); sendData(0x5A); displayMode|=0xD4; }
  else displayMode|=(customLutActive?0x0C:0x1C);
  sendCommand(CMD_DISPLAY_UPDATE_CTRL2); sendData(displayMode);
  sendCommand(CMD_MASTER_ACTIVATION);
  waitWhileBusy(mode==FULL_REFRESH?"full":mode==HALF_REFRESH?"half":"fast");
}

void EInkDisplay::setCustomLUT(const bool enabled, const unsigned char* lutData) {
  if (enabled) {
    sendCommand(CMD_WRITE_LUT);
    for (uint16_t i=0;i<105;i++) sendData(pgm_read_byte(&lutData[i]));
    sendCommand(CMD_GATE_VOLTAGE);  sendData(pgm_read_byte(&lutData[105]));
    sendCommand(CMD_SOURCE_VOLTAGE); sendData(pgm_read_byte(&lutData[106])); sendData(pgm_read_byte(&lutData[107])); sendData(pgm_read_byte(&lutData[108]));
    sendCommand(CMD_WRITE_VCOM);    sendData(pgm_read_byte(&lutData[109]));
    customLutActive=true;
  } else { customLutActive=false; }
}

void EInkDisplay::deepSleep() {
  if (isScreenOn) {
    sendCommand(CMD_DISPLAY_UPDATE_CTRL1); sendData(CTRL1_BYPASS_RED);
    sendCommand(CMD_DISPLAY_UPDATE_CTRL2); sendData(0x03);
    sendCommand(CMD_MASTER_ACTIVATION); waitWhileBusy("power-down"); isScreenOn=false;
  }
  sendCommand(CMD_DEEP_SLEEP); sendData(0x01);
}

void EInkDisplay::saveFrameBufferAsPBM(const char* filename) {
#ifndef ARDUINO
  const uint8_t* buffer = getFrameBuffer();
  std::ofstream file(filename, std::ios::binary);
  if (!file) return;
  const int W=DISPLAY_WIDTH, H=DISPLAY_HEIGHT, WB=W/8;
  file << "P4\n" << H << " " << W << "\n";
  std::vector<uint8_t> rot((H/8)*W, 0);
  for (int outY=0;outY<W;outY++) for (int outX=0;outX<H;outX++) {
    int inX=outY, inY=H-1-outX;
    bool isWhite=(buffer[inY*WB+(inX/8)]>>(7-(inX%8)))&1;
    if (!isWhite) rot[outY*(H/8)+(outX/8)]|=(1<<(7-(outX%8)));
  }
  file.write((const char*)rot.data(), rot.size());
#else
  (void)filename;
#endif
}
