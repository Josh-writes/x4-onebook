# x4-serve — Device-as-Server Sync Architecture

## Why This Replaces the Old Design

The original design had the device POST to the shelf. This required:
- The device to know the shelf's IP address (USB credential push)
- Windows Firewall exceptions on the PC
- VPN split-tunnel configuration
- Complex DB flag state (`pending_send`, `pending_return`) to coordinate async actions

Both working reference implementations (crosspoint-reader, microslate_sync) use the opposite model: **the device runs an HTTP server, the shelf connects to it.** This eliminates all of the above.

---

## New Model: Device is the Server

```
User action on device
  → device connects WiFi
  → device starts HTTP server
  → shelf detects device, connects
  → shelf drives the exchange (read state, push book, or clear SD)
  → shelf POSTs /sync-complete
  → device shuts WiFi off
```

The device never needs to know the shelf's address. The shelf finds the device via mDNS (`x4book.local`) or a stored IP.

---

## Device HTTP Endpoints

All endpoints are on port **80**.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ping` | Health check. Returns `{"ok":true}` |
| `GET` | `/state` | Current reading state. Returns `{"bookId","font","size","page","orientation"}` |
| `POST` | `/book/:filename` | Receive a book file from shelf. Body is raw bytes. |
| `DELETE` | `/book` | Clear all SD card book files (return). |
| `POST` | `/sync-complete` | Shelf signals exchange is done. Device shuts WiFi off. |

### `/state` response
```json
{ "bookId": "abc123", "font": "bookerly", "size": 14, "page": 47, "orientation": 0 }
```
Empty `bookId` means no book loaded.

### `/book/:filename` upload
- Shelf streams each file as raw bytes in the POST body
- Device writes directly to `/book/:filename` on SD
- Returns `{"ok":true}` on success, `{"error":"..."}` on failure
- Files: all `.txt`, `.idx`, `meta.json`, `state.json`, `cover.bmp`

### `/sync-complete`
- Shelf calls this when the exchange is fully done
- Device shuts down the HTTP server and WiFi
- If device is in sleep-sync mode: enters deep sleep
- If device is in swap/return mode: transitions to next screen

---

## Three Sync Flows

### 1. Sleep Sync (automatic on every sleep)

Device wants to record progress before sleeping.

```
Device:  connect WiFi → start server → show cover sleep screen
Shelf:   poll x4book.local → GET /state → record progress in DB
         → if pending book queued: POST /book/* (all files)
         → POST /sync-complete
Device:  receive sync-complete → stop server → WiFi off → deep sleep
```

**Timeout:** If shelf doesn't connect within 8 seconds, device sleeps anyway — sync was optional.

### 2. Swap Book (user-initiated from Settings)

User wants a new book. They've already queued one from the shelf app.

```
Device:  show "Connecting..." → connect WiFi → start server
         → show "Waiting for shelf..."
Shelf:   detect device → GET /state → record progress
         → POST /book/* for pending book (with progress updates to device)
         → POST /sync-complete
Device:  receive sync-complete → stop server → WiFi off
         → load new book → return to reading
```

**Cancel:** BACK button on device stops the server and disconnects.

### 3. Return Book (user-initiated from Settings)

User wants to give the book back.

```
Device:  show "Connecting..." → connect WiFi → start server
         → show "Waiting for shelf..."
Shelf:   detect device → GET /state → record final progress
         → DELETE /book
         → POST /sync-complete
Device:  receive sync-complete → clear /book/* from SD
         → stop server → WiFi off
         → show "Book returned. Send a new one from the shelf app."
```

---

## Shelf Polling Behavior

The shelf polls `http://x4book.local/ping` (or stored device IP) every 2 seconds.

On device detected:
1. `GET /state` → record progress + update `char_offset`, `last_synced_at`
2. Check DB for pending actions:
   - **Pending send:** POST all book files to `/book/:filename` in order
   - **Pending return:** `DELETE /book`
   - **Nothing pending:** just recorded progress, done
3. `POST /sync-complete`

The shelf drives everything. The device just serves and waits.

### Device Discovery

- Primary: mDNS `x4book.local` (device advertises this when server is running)
- Fallback: last known IP stored in shelf `settings` table as `deviceIp`
- The shelf updates `deviceIp` every time it successfully connects

---

## What Changes

### Firmware

**Remove:** `SyncManager.cpp/h` (device-as-client POST logic)

**Add:** `DeviceServer.cpp/h` — lightweight HTTP server using ESP32's built-in `WebServer` library:
- Runs only during sync window (Swap, Return, or Sleep)
- mDNS advertisement as `x4book.local`
- Handles the 5 endpoints above
- Calls a `onSyncComplete` callback when shelf signals done

**Simplify:** `Config` no longer needs `shelfIp` or `shelfPort`. Only WiFi credentials needed.

**Simplify:** `UsbSetup` only needs to push WiFi credentials — no shelf IP.

### Shelf

**Remove:** `routes/sync.js` (POST receiver)

**Add:** `services/device/sync.js` — polling loop:
- Runs as background interval when shelf is running
- Polls for device, drives the exchange
- Emits SSE events to frontend for live status updates

**Simplify:** `routes/device.js` — remove `/send/:bookId` trigger logic; send is now driven by the polling service detecting a pending book.

**Simplify:** DB — `pending_send` and `pending_return` flags still used as signals to the polling service, but no async coordination needed — shelf acts on them immediately when device is present.

---

## WiFi Credentials

Still pushed via USB (`X4SETUP` serial command) — unchanged. The only difference is the payload no longer includes `shelfIp` or `shelfPort`.

```json
{
  "wifiNetworks": [
    { "ssid": "HomeNetwork", "password": "secret", "priority": 0 }
  ]
}
```

---

## mDNS

Device advertises `x4book.local` using the ESP32 `ESPmDNS` library when the server is running. Shelf resolves this via the OS mDNS stack (works on Windows 10+, macOS, Linux without extra config).
