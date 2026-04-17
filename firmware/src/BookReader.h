#pragma once
#include <Arduino.h>
#include <string>
#include <vector>

// Reads pre-paginated .txt and .idx files written by the shelf to /book/.
// .txt files use PAGE-marker delimiters. .idx files are binary uint32 arrays
// of character offsets in the original source text (one entry per page).
class BookReader {
 public:
  // Open /book/{font}_{size}.txt and build page offset index.
  // Returns false if file doesn't exist.
  bool open(const String& font, int size);

  int pageCount() const { return (int)_pageOffsets.size(); }

  // Returns lines for page N (between PAGE markers). Empty on error.
  std::vector<std::string> getPageLines(int page) const;

  // Returns the source-text char offset for page N from the .idx file.
  // Returns 0 on error.
  uint32_t charOffsetForPage(int page) const;

  // Binary-searches font/size's .idx for the closest page at or before charOffset.
  static int pageForCharOffset(const String& font, int size, uint32_t charOffset);

  const String& font() const { return _font; }
  int size() const { return _size; }

 private:
  String _font;
  int _size = 0;
  String _txtPath;
  String _idxPath;
  std::vector<uint32_t> _pageOffsets;  // file offsets of each page's first content line

  void buildPageOffsets();
};
