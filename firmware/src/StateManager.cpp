#include "StateManager.h"
#include <ArduinoJson.h>
#include <HalStorage.h>
#include <Logging.h>

static const char* STATE_PATH = "/book/state.json";

namespace StateManager {

BookState load() {
  BookState state;
  String json = Storage.readFile(STATE_PATH);
  if (json.isEmpty()) return state;

  JsonDocument doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok) {
    LOG_ERR("STATE", "Failed to parse state.json");
    return state;
  }

  state.bookId      = doc["bookId"]      | "";
  state.font        = doc["font"]        | "bookerly";
  state.size        = doc["size"]        | 14;
  state.page        = doc["page"]        | 0;
  state.orientation = doc["orientation"] | 0;
  return state;
}

bool save(const BookState& state) {
  JsonDocument doc;
  doc["bookId"]      = state.bookId;
  doc["font"]        = state.font;
  doc["size"]        = state.size;
  doc["page"]        = state.page;
  doc["orientation"] = state.orientation;

  String out;
  serializeJson(doc, out);
  return Storage.writeFile(STATE_PATH, out);
}

bool exists() {
  return Storage.exists(STATE_PATH);
}

}  // namespace StateManager
