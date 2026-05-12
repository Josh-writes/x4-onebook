#include "UsbSync.h"
#include "PageRenderer.h"
#include "StateManager.h"
#include <ArduinoJson.h>
#include <HalStorage.h>
#include <Logging.h>

#define CHUNK_SIZE 512
#define CMD_TIMEOUT_MS 10000

namespace {

bool waitForLine(String& out, unsigned long timeoutMs = CMD_TIMEOUT_MS) {
  const unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    if (Serial.available()) {
      out = Serial.readStringUntil('\n');
      out.trim();
      return true;
    }
    delay(5);
  }
  return false;
}

bool receiveFile(const String& filename, uint32_t fileSize) {
  if (filename.isEmpty() || filename.indexOf("..") >= 0) {
    LOG_ERR("USB", "Bad filename: %s", filename.c_str());
    return false;
  }

  String p = String("/book/") + filename;
  Storage.ensureDirectoryExists("/book");

  HalFile file;
  if (!Storage.openFileForWrite("USB", p, file)) {
    LOG_ERR("USB", "Cannot open %s for write", p.c_str());
    return false;
  }

  static uint8_t buf[CHUNK_SIZE];
  uint32_t remaining = fileSize;
  bool ok = true;

  while (remaining > 0 && ok) {
    size_t toRead = min((uint32_t)CHUNK_SIZE, remaining);
    size_t n = Serial.readBytes(buf, toRead);
    if (n == 0) {
      LOG_ERR("USB", "Read timeout receiving %s", filename.c_str());
      ok = false;
      break;
    }
    if (file.write(buf, n) != n) {
      LOG_ERR("USB", "SD write failed for %s", filename.c_str());
      ok = false;
      break;
    }
    remaining -= n;
  }

  file.close();
  if (!ok) Storage.remove(p.c_str());
  return ok;
}

bool runSync(GfxRenderer& renderer) {
  BookState state = StateManager::load();
  JsonDocument doc;
  if (state.bookId.length() > 0) {
    doc["bookId"] = state.bookId;
    doc["font"]   = state.font;
    doc["size"]   = state.size;
    doc["page"]   = state.page;
  } else {
    doc["bookId"] = nullptr;
  }
  String stateJson;
  serializeJson(doc, stateJson);

  // Render the screen BEFORE sending X4READY so the shelf doesn't start
  // sending file data while the e-ink display is blocking the loop.
  // The shelf retries X4SYNC every ~1.2s for 20s, so a few seconds here
  // is fine. Flush any X4SYNC lines that arrived during the render.
  PageRenderer::renderMessage(renderer, "USB sync...", "Do not disconnect.");
  while (Serial.available()) Serial.read();

  Serial.print("X4READY:");
  Serial.println(stateJson);

  // Set generous timeout for file data
  Serial.setTimeout(60000);

  while (true) {
    String cmd;
    if (!waitForLine(cmd, 120000)) {
      LOG_ERR("USB", "Command timeout");
      Serial.println("X4ERR:timeout");
      return false;
    }

    // Shelf reconnected mid-sync — re-announce and restart
    if (cmd == "X4SYNC") {
      Serial.print("X4READY:");
      Serial.println(stateJson);
      continue;
    }

    if (cmd.startsWith("X4FILE:")) {
      String rest = cmd.substring(7);
      int sep = rest.lastIndexOf(':');
      if (sep < 0) {
        Serial.println("X4ERR:bad header");
        continue;
      }
      String filename  = rest.substring(0, sep);
      uint32_t fileSize = (uint32_t)rest.substring(sep + 1).toInt();

      LOG_INF("USB", "Receiving %s (%u bytes)", filename.c_str(), fileSize);

      if (receiveFile(filename, fileSize)) {
        LOG_INF("USB", "OK %s", filename.c_str());
        Serial.println("X4OK");
      } else {
        Serial.println("X4ERR:write failed");
        return false;
      }

    } else if (cmd == "X4DELETE") {
      Storage.removeDir("/book");
      Storage.mkdir("/book");
      StateManager::save(BookState{});
      Serial.println("X4OK");
      LOG_INF("USB", "Book deleted");

    } else if (cmd == "X4SYNCDONE") {
      Serial.println("X4BYE");
      LOG_INF("USB", "Sync complete");
      return true;

    } else {
      LOG_WRN("USB", "Unknown cmd: %s", cmd.c_str());
    }
  }
}

}  // namespace

namespace UsbSync {

bool handleLine(const String& line, GfxRenderer& renderer) {
  if (line != "X4SYNC") return false;
  return runSync(renderer);
}

}  // namespace UsbSync
