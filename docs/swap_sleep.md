# Swap & Sleep — Book Transfer and Progress Sync

## The Two WiFi Flows

These are distinct operations and must not be conflated.

---

### 1. Sleep Sync (already designed, needs firewall fix)

**Trigger:** Device goes to sleep (power button long-press or 5-minute auto-sleep).

**Purpose:** Send current reading position back to the shelf so the shelf tracks progress, WPM, and sessions.

**Flow:**
1. Device enters sleep sequence
2. Connects to WiFi
3. POSTs `{ bookId, font, size, page }` to `POST /api/sync`
4. Shelf records progress, returns `{ ok, returnBook, pendingBook }`
5. Device disconnects WiFi and enters deep sleep

**What the shelf does with the sync:**
- Updates `char_offset` in the progress table
- Records a reading session for metrics
- If `returnBook` is pending, tells device to clear its SD card
- If `pendingBook` is waiting, tells device (device ignores this during sleep — it acts on it at next wake)

**At next wake:**
- If `pendingBook` flag was set, device immediately downloads the new book before showing anything

**Note:** This flow already exists in the firmware and shelf. It is broken only because Windows Firewall blocks port 3001. Fix: `netsh advfirewall firewall add rule name="x4-onebook" dir=in action=allow protocol=tcp localport=3001`

---

### 2. Swap Book (device-initiated, needs to be built)

**Trigger:** User navigates to Settings on the device and selects "Swap Book".

**Purpose:** Download a new book from the shelf over WiFi without needing to sleep.

**Flow:**
1. User selects "Swap Book" from device settings menu
2. Device shows "Connecting to shelf..." screen
3. Device connects to WiFi
4. Device calls `POST /api/sync` — shelf responds with `pendingBook: true` if one is queued
5. If no pending book: device shows "No book queued. Send one from the shelf app." and waits, polling every few seconds
6. Once shelf has a pending book, device shows "Downloading: [title]" with a progress bar
7. Device downloads all book files to SD card (`/book/`)
8. Device disconnects WiFi
9. Device loads the new book and returns to reading

**Shelf app side:**
- "Send" button on BookDetail queues the book (already works)
- While a book is pending, BookDetail shows "Waiting for device..."
- When device syncs and confirms download (`on_device` flips), shows "On device ✓"
- No new API endpoints needed — shelf polls `GET /api/device/status` for state

---

## Build Plan

### Phase 1 — Fix Sleep Sync (server only, no firmware change)

- [x] Firewall rule added for port 3001
- [x] Sync route clears stale `on_device` records when device reports no book
- [ ] Verify sync POST reaches server when device wakes
- [ ] Verify `pendingBook` response triggers download on device

### Phase 2 — Swap Book firmware

**`firmware/src/SettingsMenu.cpp`**
- [x] Add row 3: "Swap Book" (below Orientation)
- [x] CONFIRM on Swap Book row returns a special sentinel value to main.cpp (e.g., set a flag or return a dedicated BookState signal)

**`firmware/src/main.cpp`**
- [x] Detect Swap Book selection from SettingsMenu::run()
- [x] Call a new `doSwap()` function that:
  - [x] Renders "Connecting to shelf..."
  - [x] Calls `SyncManager::connect(config)`
  - [x] Polls `POST /api/sync` until `pendingBook: true` (with timeout and cancel via BACK button)
  - [x] Renders "Downloading: [title]..." with progress bar
  - [x] Calls `SyncManager::downloadBook(config, progressCb)`
  - [x] Disconnects WiFi
  - [x] Reloads state and returns to reading

**`firmware/src/SettingsMenu.h`**
- [x] Add `isSwapRequested()` function to signal swap intent

### Phase 3 — Shelf app feedback

**`shelf/client/src/components/BookCard.jsx`**
- [x] After Send, poll `GET /api/books` every 3 seconds
- [x] Show status badge: "Queued → Waiting for device → On device ✓"
- [x] Stop polling once `on_device` is confirmed

**`shelf/server/routes/books.js`**
- [x] Include `pending_send` in enriched book response

---

## What Does NOT Change

- Book files always live on the shelf and are served via `GET /api/device/book/:filename`
- The device never pushes files to the shelf — data only flows shelf → device (book) and device → shelf (position)
- Sleep sync remains the primary mechanism for recording reading progress
- USB is used only for: firmware flashing (Web Serial) and WiFi credential setup (X4SETUP serial command)
- No cloud, no persistent connection, no background WiFi on the device
