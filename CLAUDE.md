# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Vision

**x4-onebook** — one book at a time on the Xteink X4. Books live on your computer, you pull one onto the device to read it, then put it back. The shelf tracks everything.

Two components in this repo:

- **Shelf** (`shelf/`) — Node.js + React app running locally on the user's computer at `localhost:3000`. All books, reading state, metrics, and processing live here.
- **Firmware** (`firmware/`) — Minimal C++ firmware for the ESP32-C3 X4. Reads pre-converted text files from SD card, reports position, nothing else.

See `docs/SPEC.md` for all design decisions in detail.

## Repository Structure

The repo is `x4-onebook`. Components are `shelf/` and `firmware/` — no separate product names. Users refer to "the x4-onebook shelf app" and "the x4-onebook firmware."

```
x4-onebook/
├── shelf/                  # The computer-side app
│   ├── server/             # Node.js + Express backend
│   │   ├── routes/         # REST API endpoints
│   │   ├── services/
│   │   │   ├── epub/       # EPUB parsing + text extraction
│   │   │   ├── converter/  # Text → paginated .txt variants
│   │   │   ├── device/     # USB + WiFi sync with X4
│   │   │   └── metrics/    # WPM, session calculations
│   │   └── db/             # SQLite schema + queries
│   └── client/             # React + Vite frontend
│       └── views/
│           ├── Shelf/      # Bookshelf grid with covers
│           ├── BookDetail/ # Stats, send/return controls
│           ├── Device/     # Connection status + sync
│           └── Stats/      # Reading metrics dashboard
├── firmware/               # X4 firmware (minimal display-only)
├── docs/                   # Architecture and spec documents
│   └── SPEC.md
├── crosspoint-reader/      # Legacy reference firmware (do not modify)
├── start.bat               # Windows one-click start
├── start.sh                # Mac/Linux one-click start
└── CLAUDE.md
```

## Tech Stack

| Layer | Choice |
|---|---|
| Server | Node.js + Express |
| Frontend | React + Vite + Tailwind CSS |
| Database | SQLite (`better-sqlite3`) |
| USB/Serial | `serialport` npm package |
| EPUB parsing | Custom (EPUBs are ZIPs containing HTML/XML) |

## Key Design Constraints

- **All processing on computer.** EPUB parsing, font metric calculations, text layout, and image conversion all happen in the shelf server. Nothing heavy runs on the X4.
- **All state on computer.** Bookmarks, reading progress, and metrics live exclusively in the shelf's SQLite DB. Progress is stored as a character offset (font-agnostic), never a page number.
- **One book at a time on device.** Sending a new book syncs the old one's progress first, then replaces all files.
- **Device is read-only from the shelf's perspective.** The only thing that flows back from the device is `{ bookId, font, size, page }` on sync. No text files return to the computer.
- **Battery life first.** WiFi is only active during sleep sync or user-initiated swap. No background connectivity.
- **Fully local, no cloud.** No hosted services, no accounts. Open source on GitHub. Distribution is clone + `npm install` + `npm start`.

## WiFi Flows — Two Distinct Operations

See `docs/swap_sleep.md` for full detail and build plan.

### Sleep Sync
Device POSTs reading position to shelf on every sleep. Shelf records progress and metrics. Lightweight — device disconnects immediately after.

### Swap Book (device-initiated)
User selects "Swap Book" from device settings menu. Device connects to WiFi, polls shelf for a pending book, downloads it, disconnects. Shelf app shows "Waiting for device → Downloading → On device". No USB involved.

## USB Usage
USB is used for two things only:
- **Firmware flashing** — via Web Serial in the shelf app (Flash Firmware button)
- **WiFi credential setup** — shelf sends `X4SETUP:{json}` command over serial; device saves credentials to SD card and restarts

## Commands

_Populated once the project is scaffolded._
