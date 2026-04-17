#include "DeviceServer.h"
#include <algorithm>
#include <ArduinoJson.h>
#include <HalStorage.h>
#include <Logging.h>
#include <WebServer.h>
#include <WiFi.h>

static const char* AP_SSID = "x4book";
static const char* AP_IP   = "192.168.4.1";

static const char* BOOK_FILES[] = {
  "bookerly_12.txt",  "bookerly_12.idx",
  "bookerly_14.txt",  "bookerly_14.idx",
  "bookerly_16.txt",  "bookerly_16.idx",
  "bookerly_18.txt",  "bookerly_18.idx",
  "notosans_12.txt",  "notosans_12.idx",
  "notosans_14.txt",  "notosans_14.idx",
  "notosans_16.txt",  "notosans_16.idx",
  "notosans_18.txt",  "notosans_18.idx",
  "dyslexic_10.txt",  "dyslexic_10.idx",
  "dyslexic_12.txt",  "dyslexic_12.idx",
  "dyslexic_14.txt",  "dyslexic_14.idx",
  "meta.json",
  "state.json",
  "cover.bmp",
};
static const int BOOK_FILE_COUNT = sizeof(BOOK_FILES) / sizeof(BOOK_FILES[0]);

namespace {

WebServer* server = nullptr;
std::function<void()> onSyncCompleteCb = nullptr;

bool startAP() {
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(AP_SSID)) {
    LOG_ERR("SRV", "Failed to start AP");
    return false;
  }
  LOG_INF("SRV", "AP started — SSID: %s  IP: %s", AP_SSID, WiFi.softAPIP().toString().c_str());
  return true;
}

void handlePing() {
  JsonDocument doc;
  doc["ok"] = true;
  String out;
  serializeJson(doc, out);
  server->send(200, "application/json", out);
}

void handleState() {
  BookState state = StateManager::load();

  JsonDocument doc;
  if (state.bookId.length() > 0) {
    doc["bookId"] = state.bookId;
    doc["font"] = state.font;
    doc["size"] = state.size;
    doc["page"] = state.page;
    doc["orientation"] = state.orientation;
  } else {
    doc["bookId"] = nullptr;
  }

  String out;
  serializeJson(doc, out);
  server->send(200, "application/json", out);
}

// ── Book upload state (one upload at a time) ─────────────────────────────────
static HalFile  _uploadFile;
static String   _uploadPath;
static bool     _uploadOk = true;

// Called for each chunk of the multipart body — streams straight to SD.
void handleBookUploadChunk() {
  HTTPUpload& upload = server->upload();

  if (upload.status == UPLOAD_FILE_START) {
    // Extract filename from the request URI: /book/bookerly_14.txt
    String uri = server->uri();
    String filename = uri.substring(uri.lastIndexOf('/') + 1);

    if (filename.isEmpty() || filename.indexOf("..") >= 0) {
      _uploadOk = false;
      LOG_ERR("SRV", "Invalid upload filename: %s", filename.c_str());
      return;
    }

    _uploadPath = String("/book/") + filename;
    Storage.ensureDirectoryExists("/book");
    _uploadOk = Storage.openFileForWrite("SRV", _uploadPath, _uploadFile);
    if (!_uploadOk) LOG_ERR("SRV", "Cannot open %s for write", _uploadPath.c_str());

  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (_uploadOk) {
      size_t n = _uploadFile.write(upload.buf, upload.currentSize);
      if (n != upload.currentSize) {
        LOG_ERR("SRV", "SD write short: %d/%d", (int)n, (int)upload.currentSize);
        _uploadOk = false;
      }
    }

  } else if (upload.status == UPLOAD_FILE_END) {
    if (_uploadOk) _uploadFile.close();
  }
}

// Called once after all chunks are received.
void handleBookUploadDone() {
  if (_uploadOk) {
    LOG_INF("SRV", "Uploaded %s", _uploadPath.c_str());
    server->send(200, "application/json", "{\"ok\":true}");
  } else {
    Storage.remove(_uploadPath.c_str());
    server->send(500, "application/json", "{\"error\":\"Upload failed\"}");
  }
  _uploadPath = "";
  _uploadOk   = true;
}

void handleBookDelete() {
  Storage.ensureDirectoryExists("/book");

  for (int i = 0; i < BOOK_FILE_COUNT; i++) {
    String path = String("/book/") + BOOK_FILES[i];
    Storage.remove(path.c_str());
  }

  JsonDocument doc;
  doc["ok"] = true;
  String out;
  serializeJson(doc, out);
  server->send(200, "application/json", out);

  LOG_INF("SRV", "Deleted all book files");
}

void handleSyncComplete() {
  JsonDocument doc;
  doc["ok"] = true;
  String out;
  serializeJson(doc, out);
  server->send(200, "application/json", out);

  LOG_INF("SRV", "Sync complete — stopping server");

  if (onSyncCompleteCb) {
    onSyncCompleteCb();
  }
}

void handleNotFound() {
  JsonDocument doc;
  doc["error"] = "Not found";
  String out;
  serializeJson(doc, out);
  server->send(404, "application/json", out);
}

}  // anonymous namespace

namespace DeviceServer {

void begin(SyncCompleteCallback onSyncComplete) {
  onSyncCompleteCb = onSyncComplete;

  if (!startAP()) return;

  server = new WebServer(80);

  server->on("/ping", HTTP_GET, handlePing);
  server->on("/state", HTTP_GET, handleState);
  server->on("/book/*", HTTP_POST, handleBookUploadDone, handleBookUploadChunk);
  server->on("/book", HTTP_DELETE, handleBookDelete);
  server->on("/sync-complete", HTTP_POST, handleSyncComplete);

  server->onNotFound(handleNotFound);

  server->begin();
  LOG_INF("SRV", "Server started on port 80");
}

void end() {
  if (server) {
    server->stop();
    delete server;
    server = nullptr;
  }
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
  LOG_INF("SRV", "Server stopped, AP off");
}

void handleLoop() {
  if (server) {
    server->handleClient();
  }
}

bool isRunning() {
  return server != nullptr;
}

}  // namespace DeviceServer