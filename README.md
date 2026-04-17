# x4-onebook

One book at a time on the [Xteink X4](https://xteink.com). Books live on your computer — you pull one onto the device to read, put it back when done. The shelf tracks everything.

**Fully local. No cloud. No accounts.**

---

## How it works

Two components work together:

- **Shelf** — a Node.js + React app that runs locally at `localhost:3000`. It holds your entire library, handles all EPUB processing, tracks reading progress and metrics, and syncs with the device.
- **Firmware** — minimal C++ firmware for the ESP32-C3. Reads pre-converted text files from the SD card. Reports position. Nothing else.

When you send a book to the X4, the shelf pre-paginates it for every supported font and size, generates index files, and writes everything to the device's SD card. On every sleep cycle, the device posts its current position back to the shelf over WiFi — no user action needed.

---

## Setup

### Requirements

- [Node.js](https://nodejs.org) v18+
- An Xteink X4 device (for device features; the shelf app works standalone)

### Install and run

```bash
git clone https://github.com/jhinton/x4-onebook
cd x4-onebook
```

**Mac / Linux:**
```bash
./start.sh
```

**Windows:**
```
start.bat
```

Or manually:
```bash
cd shelf
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000).

---

## Features

### Shelf app
- Import EPUB libraries from one or more folders
- Book covers, reading stats, and time-remaining estimates
- Grid view and visual shelves (drag-and-drop organization)
- Send a book to the X4 — one book at a time
- Return a book (syncs progress, clears device)
- Reading metrics: WPM, pages per day, reading streaks, session history

### Device sync
- **WiFi (automatic):** device posts position to shelf on every sleep; shelf records progress silently
- **USB:** used for firmware flashing and initial WiFi credential setup
- Multiple WiFi networks stored on device, tried in priority order

### Book format
- 12 pre-paginated variants per book (3 fonts × 4 sizes)
- Progress stored as character offset — font-agnostic, survives font changes on device
- Fonts: Bookerly, Noto Sans, OpenDyslexic

---

## Repository structure

```
x4-onebook/
├── shelf/                  # Computer-side app (Node.js + React)
│   ├── server/             # Express backend, REST API
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # EPUB parsing, conversion, device sync, metrics
│   │   └── db/             # SQLite schema and queries
│   └── client/             # React + Vite frontend
│       └── views/          # Shelf, BookDetail, Device, Stats, Settings
├── firmware/               # X4 firmware (ESP32-C3, PlatformIO)
│   └── src/
├── docs/
│   └── SPEC.md             # Full system specification
├── start.bat               # Windows one-click start
└── start.sh                # Mac/Linux one-click start
```

---

## Tech stack

| | |
|---|---|
| Server | Node.js + Express |
| Frontend | React + Vite + Tailwind CSS |
| Database | SQLite (`better-sqlite3`) |
| Firmware | C++ (PlatformIO, ESP32-C3) |
| USB/Serial | `serialport` npm package |
| EPUB parsing | Custom (EPUBs are ZIPs of HTML/XML) |

---

## Status

Shelf app is complete. Firmware is ~90% done — book reader, page renderer, state/sync, and multi-network WiFi all implemented; not yet tested on hardware.

---

## License

MIT
