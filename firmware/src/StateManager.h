#pragma once
#include <Arduino.h>

struct BookState {
  String bookId;           // shelf book ID — included in every sync so shelf can route correctly
  String font  = "bookerly";
  int size     = 14;
  int page     = 0;
  int orientation = 0;    // 0=Portrait, 1=LandscapeCW, 2=PortraitInv, 3=LandscapeCCW
};

namespace StateManager {
  // Loads /book/state.json. Returns default state if missing.
  BookState load();
  // Writes /book/state.json. Returns false on failure.
  bool save(const BookState& state);
  bool exists();
}
