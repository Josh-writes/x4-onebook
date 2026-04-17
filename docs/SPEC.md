# x4-onebook — System Specification

Full technical spec for the x4-onebook system. All design decisions are recorded here with rationale.

The name reflects the core philosophy: **one book at a time** on the device.

> **Status (2026-04-17):** Shelf app complete. Firmware ~90% done (book reader, page renderer, state/sync, WiFi multi-network support implemented; untested on hardware).

---

## 1. System Overview

Two components:

- **Shelf** — Node.js + Express server with a React frontend, running locally on the user's computer at `localhost:3000`. The brain of the system. Owns all books, state, and metrics. No cloud dependencies. Everything stays on the user's machine.
- **X4 Firmware** — Minimal C++ firmware on the ESP32-C3. Reads pre-converted text files from SD card. Reports position. Nothing else.

### Distribution

Open source on GitHub. No code signing. No cloud accounts. Setup:

```
1. Install Node.js  (one-time)
2. git clone https://github.com/...
3. npm install
4. npm start
5. Open localhost:3000
```

A `start.bat` / `start.sh` in the repo root wraps steps 3–5 for users who don't want a terminal.

---

## 2. The Book File Format

### Why pre-paginated variants

The X4 display has fixed dimensions. Pagination depends on font family and size. Rather than doing layout on-device (which requires font metrics and layout logic), the shelf pre-computes pagination for every supported font/size combination and stores each as a separate `.txt` file. Since the device holds only one book at a time, storage cost is irrelevant.

### Supported variants

3 fonts × 4 sizes = **12 variants**:

| Font | Sizes |
|---|---|
| Bookerly (serif) | 12, 14, 16, 18 |
| Noto Sans | 12, 14, 16, 18 |
| OpenDyslexic | 10, 12, 14, 16 |

### File naming

```
{font}_{size}.txt     — pre-paginated text
{font}_{size}.idx     — character offset index (one uint32 per page)
```

Example: `bookerly_14.txt`, `bookerly_14.idx`

### Page marker format

Pages are delimited by a `PAGE` marker on its own line:

```
PAGE
Chapter 1: The Beginning

It was a dark and stormy night...
PAGE
...continued text...
```

The firmware reads between `PAGE` markers. No layout logic required.

### Index file format

Each `.idx` file is a flat array of `uint32_t` values. Entry `i` is the byte offset into the original source text (pre-conversion) where page `i` begins. Used for progress normalization across fonts.

Binary format: `[uint32 page0_char_offset, uint32 page1_char_offset, ...]`

A 300-page book = 300 × 4 bytes = 1.2KB.

---

## 3. Full File Set Sent to Device

```
/book/
  bookerly_10.txt    bookerly_10.idx
  bookerly_12.txt    bookerly_12.idx
  bookerly_14.txt    bookerly_14.idx
  bookerly_16.txt    bookerly_16.idx
  notosans_10.txt    notosans_10.idx
  notosans_12.txt    notosans_12.idx
  notosans_14.txt    notosans_14.idx
  notosans_16.txt    notosans_16.idx
  dyslexic_10.txt    dyslexic_10.idx
  dyslexic_12.txt    dyslexic_12.idx
  dyslexic_14.txt    dyslexic_14.idx
  dyslexic_16.txt    dyslexic_16.idx
  cover.bmp
  meta.json
  state.json
```

### meta.json

```json
{
  "title": "The Name of the Wind",
  "author": "Patrick Rothfuss",
  "total_chars": 891204
}
```

`total_chars` enables font-agnostic percentage progress: `char_offset / total_chars`.

### state.json (written by device, read by shelf)

```json
{
  "font": "bookerly",
  "size": 14,
  "page": 47
}
```

This is the only data that ever flows from device → shelf. ~50 bytes.

---

## 4. Progress Normalization

Progress is stored as a **character offset** in the source text, not a page number. Page numbers are font-dependent; character offsets are not.

### Font switch on device

1. Read `state.json` → current font/size and page N
2. Load `{font}_{size}.idx`, read `idx[N]` → char offset X
3. Binary search `{new_font}_{new_size}.idx` for X → page M
4. Load `{new_font}_{new_size}.txt`, seek to page M
5. Write updated `state.json`

Binary search on a ~1KB file. Runs in microseconds.

### Sync to shelf

Shelf reads `state.json`, looks up `idx[page]` from the appropriate index file to get the canonical char offset, stores that in the DB.

---

## 5. Device Lifecycle

```
SEND      Write /book/* to SD card. Mark book as on_device in shelf DB.
SYNC      Read state.json → convert page to char offset → update shelf DB.
RETURN    Sync + delete /book/* from SD card. Mark book as off_device.
REPLACE   Sync old book → delete /book/* → write new /book/*.
```

---

## 6. Connectivity

### WiFi background sync

When the device and computer are on the same network, sync happens automatically in the background without user action.

**Device behavior:**
- On every sleep event: briefly wake WiFi, POST `state.json` to shelf server at known local IP, disconnect WiFi, enter deep sleep.
- WiFi is active for ~1-2 seconds per sleep cycle only.

**Shelf behavior:**
- Shelf server listens for POST `/sync` from device.
- On receipt: convert page → char offset → update `reading_progress` and create/extend reading session in DB.
- Shelf can detect active reading sessions from the cadence of incoming syncs.

**Device discovery:**
- Shelf IP stored in device config. Can be set manually or auto-discovered via mDNS (`x4-bookshelf.local`).

### USB

For initial send and return when WiFi is not available. Uses serial protocol over USB-C. Shelf uses `serialport` npm package to communicate.

---

## 7. Reading Metrics

All computed server-side from session data.

| Metric | Calculation |
|---|---|
| Words per minute | `(end_char - start_char) / avg_word_length / session_duration_minutes` |
| Pages per day | Rolling 7-day average of pages read |
| Reading streak | Consecutive days with at least one sync |
| Time remaining | `(total_chars - current_char) / avg_chars_per_minute` |
| Session history | All sessions stored, queryable by book or date range |

### Session detection

A session is created when a sync arrives after a gap of > 30 minutes (configurable). Syncs within the same session extend it. When the device goes to sleep, the final sync closes the session.

---

## 8. Data Model (SQLite)

```sql
CREATE TABLE books (
  id            TEXT PRIMARY KEY,   -- UUID
  title         TEXT NOT NULL,
  author        TEXT,
  epub_path     TEXT NOT NULL,      -- original source file (stays in place)
  cover_path    TEXT,               -- extracted cover image (in data/covers/)
  total_chars   INTEGER NOT NULL,
  added_at      TEXT NOT NULL       -- ISO8601
);

CREATE TABLE reading_progress (
  book_id         TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  char_offset     INTEGER NOT NULL DEFAULT 0,
  last_synced_at  TEXT,
  on_device       INTEGER NOT NULL DEFAULT 0  -- boolean
);

CREATE TABLE reading_sessions (
  id              TEXT PRIMARY KEY,
  book_id         TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  start_char      INTEGER NOT NULL,
  end_char        INTEGER,
  wpm             REAL
);

CREATE TABLE bookmarks (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  char_offset INTEGER NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE shelves (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE shelf_books (
  shelf_id TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  book_id  TEXT NOT NULL REFERENCES books(id)   ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shelf_id, book_id)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
  -- seeds: libraryPaths=[], port=3001, deviceIp=''
);
```

---

## 9. Shelf App UI

See status line above for overall state.

**Shelf view** — two modes toggled via Grid/Shelves button in toolbar:

- **Grid mode:** grid of 160px book cards.
  - Default: cover art + title
  - Hover: stats popup (% complete, last read, avg WPM, time remaining) + Send/Return/Delete buttons
  - On-device: dark overlay with live stats

- **Shelves mode:** named shelf rows displayed as literal horizontal shelves with a visual plank. Books sit upright (72px, 2:3 ratio) on each row. Drag books between shelves and the Unshelved row at the bottom. Create shelves with "+ New Shelf". Rename by double-clicking. Delete shelves without removing books.

**Device bar** — persistent bottom strip: WiFi/USB status, on-device book, manual sync button.

**Settings page** — multiple library folder paths (add/remove, first = primary), device IP.

**Library import** — two-step: fast scan shows count, then sequential import-one loop with progress. Books appear as they come in.

### Future

- Spine view (thickness proportional to length, color from cover)
- Drag-to-reorder books within a shelf

---

## 10. Conversion Pipeline (shelf server)

**Lazy:** conversion runs only when a book is first sent to the device, not on import. Import is fast (~54ms/book — just EPUB parse + metadata).

Single pass over the EPUB source text for all 12 variants:

1. Unzip EPUB → parse OPF spine → extract chapters in order
2. Strip HTML tags → normalize whitespace → resolve entities
3. For each font/size variant:
   - Walk text, wrap lines at correct character width for this font's metrics
   - Emit `PAGE` markers when line count reaches display height
   - Record char offset at each page break into idx array
4. Write all `.txt` and `.idx` files to `data/converted/{bookId}/`
5. Write `meta.json`
6. Cover image extracted at import time, stored in `data/covers/{id}.{ext}`

Converted files persist after first send — subsequent sends reuse them.

Font metrics read from actual TTF/OTF files in `crosspoint-reader/lib/EpdFont/builtinFonts/source/` using opentype.js. Line height (advanceY) from font header files. **These metrics must match exactly what the firmware renders.**

## 11. Library Management

- Multiple library folder paths stored in `settings` table as JSON array
- First path = primary (uploaded EPUBs copied here)
- EPUB files stay in their original location (not moved to data/)
- Dedup by absolute file path — same file can't be imported twice
- `GET /api/books/library-scan` — fast directory listing only, no I/O beyond readdir
- `POST /api/books/import-one` — called per-book by client during library import loop

---

## 12. WiFi Credential Management

### Rationale

User may read in multiple locations (home, work, coffee shop, family houses). Store multiple networks on device, connect automatically to the first available. Manage all credentials from the Shelf app.

### SQLite Schema

```sql
CREATE TABLE wifi_networks (
  id          TEXT PRIMARY KEY,   -- UUID
  ssid        TEXT NOT NULL,
  password   TEXT NOT NULL,       -- stored plaintext, device-only
  priority   INTEGER NOT NULL DEFAULT 0,  -- lower = higher priority
  created_at TEXT NOT NULL,
  synced     INTEGER NOT NULL DEFAULT 0   -- boolean: sent to device
);
```

### Shelf API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wifi` | List all networks (without passwords) |
| POST | `/api/wifi` | Add new network |
| PUT | `/api/wifi/:id` | Update network |
| DELETE | `/api/wifi/:id` | Remove network |
| POST | `/api/wifi/sync` | Send selected networks to device |

### Device Sync Payload

```json
{
  "networks": [
    { "ssid": "HomeNetwork", "password": "secret123", "priority": 0 },
    { "ssid": "OfficeWiFi", "password": "office456", "priority": 1 }
  ]
}
```

Credentials sent to device via SD card file `/wifi/networks.json` during book send/return, or standalone via USB.

### Device Behavior

- On boot, read `wifi_networks.json` from SD card, store in ESP32 NVS
- Try networks in priority order until one connects
- On WiFi background sync, attempt connection to any stored network
- If all fail, skip sync until next sleep cycle

### UI - Device Settings Page

**WiFi Networks section:**
- List stored networks with name, priority, sync status
- Add Network: modal with SSID input, password input, priority dropdown
- Edit/Delete per-row actions
- Checkbox column: select which networks to sync to device
- "Sync to Device" button: sends checked networks via USB or WiFi
