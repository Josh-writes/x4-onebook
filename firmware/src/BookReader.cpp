#include "BookReader.h"
#include <HalStorage.h>
#include <Logging.h>

// File format: lines separated by '\n', pages delimited by "PAGE\n".
// First line is always "PAGE". No trailing PAGE at end.

bool BookReader::open(const String& font, int size) {
  _font    = font;
  _size    = size;
  _txtPath = String("/book/") + font + "_" + size + ".txt";
  _idxPath = String("/book/") + font + "_" + size + ".idx";

  if (!Storage.exists(_txtPath.c_str())) {
    LOG_ERR("BOOK", "Missing %s", _txtPath.c_str());
    return false;
  }

  _pageOffsets.clear();
  buildPageOffsets();
  LOG_INF("BOOK", "Opened %s — %d pages", _txtPath.c_str(), pageCount());
  return true;
}

void BookReader::buildPageOffsets() {
  HalFile f;
  if (!Storage.openFileForRead("BOOK", _txtPath, f)) return;

  // Walk the file scanning for "PAGE\n" markers.
  // Record the file offset of the byte immediately after each PAGE\n.
  static const char PAGE_MARKER[] = "PAGE";
  const size_t fileSize = f.fileSize();
  size_t pos = 0;
  String line;
  line.reserve(512);

  while (pos < fileSize) {
    // Read one line
    line = "";
    int c;
    size_t lineStart = pos;
    while (pos < fileSize) {
      c = f.read();
      if (c < 0) break;
      pos++;
      if (c == '\n') break;
      if (c != '\r') line += (char)c;
    }

    if (line == PAGE_MARKER) {
      // pos is now pointing at the first byte of the page content
      _pageOffsets.push_back((uint32_t)pos);
    }
  }
  f.close();
}

std::vector<std::string> BookReader::getPageLines(int page) const {
  std::vector<std::string> lines;
  if (page < 0 || page >= pageCount()) return lines;

  HalFile f;
  if (!Storage.openFileForRead("BOOK", _txtPath, f)) return lines;

  f.seekSet(_pageOffsets[page]);

  const size_t fileSize = f.fileSize();
  size_t pos = _pageOffsets[page];

  // Determine end of this page: start of next PAGE marker or EOF
  size_t end = fileSize;
  if (page + 1 < pageCount()) {
    // Next page offset minus the "PAGE\n" prefix (5 bytes)
    end = _pageOffsets[page + 1] - 5;
  }

  while (pos < end) {
    std::string line;
    int c;
    while (pos < end) {
      c = f.read();
      if (c < 0) break;
      pos++;
      if (c == '\n') break;
      if (c != '\r') line += (char)c;
    }
    lines.push_back(line);
  }

  f.close();
  return lines;
}

uint32_t BookReader::charOffsetForPage(int page) const {
  if (page < 0 || page >= pageCount()) return 0;

  HalFile f;
  if (!Storage.openFileForRead("BOOK", _idxPath, f)) return 0;

  f.seekSet(page * 4);
  uint32_t offset = 0;
  f.read(&offset, 4);
  f.close();
  return offset;
}

int BookReader::pageForCharOffset(const String& font, int size, uint32_t charOffset) {
  String idxPath = String("/book/") + font + "_" + size + ".idx";
  HalFile f;
  if (!Storage.openFileForRead("BOOK", idxPath, f)) return 0;

  const size_t fileSize = f.fileSize();
  const int pageCount = (int)(fileSize / 4);
  if (pageCount == 0) { f.close(); return 0; }

  // Binary search for largest entry <= charOffset
  int lo = 0, hi = pageCount - 1, result = 0;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    f.seekSet(mid * 4);
    uint32_t entry = 0;
    f.read(&entry, 4);
    if (entry <= charOffset) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  f.close();
  return result;
}
