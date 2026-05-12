# Cannot Send Book to Device — Investigation

Date: 2026-05-05

---

## Issue

User cannot send a book from the shelf app to the X4 device. Clicking "Send" produces no response. Both USB and WiFi have been attempted.

---

## Primary Root Cause: Firmware Mismatch

The X4 device is running the **crosspoint-reader** firmware (from `reference-code/crosspoint-reader/`), but the **shelf app** (`shelf/`) speaks an entirely different protocol designed for the **x4-onebook** firmware (`firmware/`). These are not interoperable at any protocol layer.

### Protocol Comparison

| Transport | crosspoint-reader (on device) | x4-onebook (shelf expects) |
|---|---|---|
| USB protocol | Debug logging + screenshot command only; no file transfer | `X4SYNC` — `X4READY:{state}` — `X4FILE:name:size` + raw bytes — `X4OK` — `X4SYNCDONE` — `X4BYE` |
| WiFi HTTP upload | `POST /upload` (multipart to arbitrary SD paths) | `POST /book/:filename` (multipart to `/book/*`) |
| WiFi HTTP API | WebDAV (Class 1), WebSocket :81, full file manager HTML UI | REST: `GET /ping`, `GET /state`, `POST /book/*`, `DELETE /book`, `POST /sync-complete` |
| Book format | Full EPUB files parsed on-device | Pre-paginated `.txt` + `.idx` files (12 variants across 3 fonts) |
| WiFi activation | Manual: user navigates to WiFi activity screen on device | Automatic: triggered by sleep event, "Swap Book", or "Return Book" in settings |
| Who runs HTTP server | Device (persistent while in WiFi activity) | Device (only during sync sessions; 30–120s window) |
| Who initiates | User opens browser → device | Shelf polls device → drives all operations |

### Why This Causes "No Response"

The shelf's poll loop (`shelf/server/services/device/sync.js`) runs every 2 seconds:

1. **USB path**: Sends `X4SYNC\n` over serial — crosspoint-reader firmware has no handler for this, never responds `X4READY`
2. **WiFi path**: Probes `GET /ping` — crosspoint-reader may respond to `/ping` if its web server is active, but the shelf then sends `GET /state`, `POST /book/*`, `POST /sync-complete` to endpoints that don't exist in crosspoint-reader

Result: the shelf never detects a compatible device. Books remain in `pending_send` state indefinitely with "Waiting for device..." shown in the UI.

**Solution: Flash the x4-onebook firmware from `firmware/` to the device.**

---

## Secondary Bugs & Platform Issues

### 1. `dyslexic_16` variant mismatch — Medium

| File | Line | Detail |
|---|---|---|
| `shelf/server/services/converter/fontMetrics.js` | 83 | `VARIANTS` defines dyslexic sizes as `[10, 12, 14, 16]` |
| `firmware/src/main.cpp` | 36–38 | Only registers `dyslexic10Font`, `dyslexic12Font`, `dyslexic14Font` — **no dyslexic 16** |
| `firmware/src/DeviceServer.cpp` | 22–24 | `BOOK_FILES[]` delete list also missing `dyslexic_16.txt` and `dyslexic_16.idx` |

**Impact**: Shelf generates and sends `dyslexic_16.txt` and `dyslexic_16.idx` files the firmware can never use. They also won't be deleted during a book return (`DELETE /book` only clears files in `BOOK_FILES[]`).

**Fix**: Remove size `16` from the dyslexic variant in `fontMetrics.js:83`, changing it to `[10, 12, 14]`.

---

### 2. USB port fallback never matches on Windows — Medium

| File | Line | Detail |
|---|---|---|
| `shelf/server/services/device/usb-sync.js` | 119–126 | Fallback port detection after VID check uses patterns: `ttyacm`, `ttyusb`, `usbmodem` |

These patterns are exclusively Linux/macOS device names. On Windows, COM ports appear as `COM3`, `COM4`, etc. — none of these patterns will match.

**Impact**: If the primary VID `303a` / manufacturer "espressif" check fails for any reason (driver issue, VID not exposed), USB sync silently fails on Windows with no fallback.

**Fix**: Add Windows COM port detection (e.g., `com` prefix) to the fallback, or remove the fallback entirely and rely solely on the VID/manufacturer check with better error messaging.

---

### 3. mDNS resolution may fail on Windows — Medium

| File | Line | Detail |
|---|---|---|
| `shelf/server/services/device/sync.js` | 147 | Probe hosts include `x4book.local` |

Windows does not include a native mDNS resolver. Devices advertise `x4book.local` via mDNS, but Node.js's `http.request` uses the system DNS resolver, which on Windows cannot resolve `.local` hostnames without Bonjour (from iTunes) or another mDNS implementation being installed.

**Impact**: If the configured IP is blank and the user's computer hasn't connected to the device's AP at `192.168.4.1`, the WiFi path is completely broken because the middle probe (`x4book.local`) will always fail to resolve.

**Fix**: Swap probe order to `[configuredIp, 192.168.4.1, x4book.local]` so the direct IP fallback is tried before mDNS, or add explicit IP discovery.

---

### 4. WiFi upload buffers entire file in memory — Low

| File | Line | Detail |
|---|---|---|
| `shelf/server/services/device/sync.js` | 242–243 | `const content = fs.readFileSync(path.join(convertedDir, diskName))` loads the full file into a Buffer |

For large books (e.g., `bookerly_12.txt` with thousands of pages could be several MB), this is fine. But for edge cases with very large files, `readFileSync` can cause Node.js to run out of memory. The upload already uses multipart form-data; it could be refactored to stream via `fs.createReadStream`.

**Impact**: Low — unlikely to hit with typical book sizes, but worth noting.

---

### 5. Design constraint: WiFi requires device-side user action

| File | Line | Detail |
|---|---|---|
| `firmware/src/main.cpp` | 92–126, 128–151 | `doSwap()` and `doReturn()` are only called from `SettingsMenu::run()` |
| `firmware/src/main.cpp` | 71–90 | `enterSleep()` is triggered by power button long-press or 5-min inactivity |

The shelf cannot push a book to the device over WiFi. The device must enter WiFi server mode — either by:
- User selecting "Swap Book" from device settings
- User pressing the power button (sleep sync)
- 5 minutes of inactivity (auto-sleep)

**Impact**: After clicking "Send" in the shelf, the user must then perform an action on the device to complete the transfer. The shelf UI shows "Waiting for device..." but provides no instruction to the user about what to do next.

**Fix**: Add guidance text to the shelf UI after queuing a book (e.g., "Book queued. Put device to sleep or select Swap Book from device settings to complete the transfer.").

---

## Full Book-Sending Flow (with x4-onebook firmware)

For reference, once the correct firmware is flashed:

```
Shelf UI                    Shelf Server                     X4 Device
────────                    ────────────                     ────────
Click "Send"
                       →   POST /api/device/send/:id
                           - Parse EPUB → plain text
                           - Convert to 12 .txt + .idx variants
                           - Write _state.json
                           - Convert cover → cover.bmp
                           - DB: pending_send = true
                       ←   { ok: true }
"Queued..."
                           
                           [Poll loop, every 2s]
                           
                           ── USB path ──
                           Find port (VID 303a)
                           Open serial @115200
                       →   X4SYNC\n
                                               ←   X4READY:{bookId,font,size,page}
                           Record progress
                           For each file in converted/:
                       →   X4FILE:name:size\n + raw bytes
                                               ←   X4OK
                       →   X4SYNCDONE\n
                                               ←   X4BYE
                           DB: pending_send=false, on_device=true
                           
                           ── WiFi path ──
                   (device enters WiFi mode via sleep/swap)
                           GET /ping          ←   { ok: true }
                           GET /state         ←   { bookId, font, size, page }
                           Record progress
                           POST /book/*       ←   { ok: true }  (per file)
                           POST /sync-complete ←  { ok: true }
                                               →   WiFi off, load new book
                           DB: pending_send=false, on_device=true
```

---

## File Index

| # | File | Role |
|---|---|---|
| 1 | `shelf/server/routes/device.js` | `POST /api/device/send/:bookId` — converts book, flags `pending_send` |
| 2 | `shelf/server/services/device/sync.js` | Poll loop: detects device, drives WiFi file upload |
| 3 | `shelf/server/services/device/usb-sync.js` | USB serial protocol: `X4SYNC`/`X4FILE`/`X4SYNCDONE` |
| 4 | `shelf/server/services/device/index.js` | Helpers: `buildFileSet`, `writeStateJson`, `convertCoverToBmp` |
| 5 | `shelf/server/services/converter/index.js` | Text → paginated `.txt` + `.idx` variants |
| 6 | `shelf/server/services/converter/fontMetrics.js` | Font variant definitions, display geometry, character widths |
| 7 | `shelf/server/db/queries.js` | `getPendingSendBook`, `setPendingSend`, `setOnDevice` |
| 8 | `firmware/src/main.cpp` | Device entry point: setup, loop, USB dispatch, sleep/swap/return |
| 9 | `firmware/src/DeviceServer.cpp` | WiFi HTTP server: `/ping`, `/state`, `/book/*`, `/sync-complete` |
| 10 | `firmware/src/UsbSync.cpp` | USB serial protocol handler: `X4SYNC` → `X4READY` → `X4FILE` → `X4SYNCDONE` |
| 11 | `firmware/src/BookReader.cpp` | Opens pre-paginated `.txt` files, scans `PAGE` markers |
| 12 | `firmware/src/StateManager.cpp` | Reads/writes `/book/state.json` with `{ bookId, font, size, page, orientation }` |
| 13 | `reference-code/crosspoint-reader/` | Reference (incompatible) firmware — do not modify |
| 14 | `docs/SPEC.md` | Full system specification |
| 15 | `docs/x4-serve.md` | Device-as-server architecture rationale |

---

## Recommended Fix Order

1. **Flash x4-onebook firmware to device** — this alone resolves the primary issue
2. **Remove `dyslexic_16`** from `fontMetrics.js:83` — reconcile variants
3. **Fix USB fallback on Windows** — add `com` prefix detection or remove fallback
4. **Reorder WiFi probe hosts** — put IP before mDNS to avoid Windows resolution gap
5. **Add user-facing guidance** — tell user what to do after clicking "Send" (sleep device or select Swap Book)
