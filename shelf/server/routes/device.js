const express = require('express');
const path    = require('path');
const fs      = require('fs');

const queries    = require('../db/queries');
const deviceSvc  = require('../services/device');
const flashSvc   = require('../services/device/flash');
const { parseEpub }   = require('../services/epub');
const { convertBook } = require('../services/converter');

const router   = express.Router();
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// ── GET /api/device/status ────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  const deviceIp      = queries.getSetting('deviceIp');
  const onDevice      = queries.getOnDeviceBook();
  const wifiReachable = deviceIp ? await deviceSvc.pingDevice(deviceIp) : false;

  res.json({
    wifi:     { configured: !!deviceIp, ip: deviceIp, reachable: wifiReachable },
    usb:      { available: deviceSvc.isUsbAvailable() },
    onDevice: onDevice ? { id: onDevice.id, title: onDevice.title } : null,
  });
});

// ── POST /api/device/send/:bookId ─────────────────────────────────────────────
// Queues a book to be pulled by the device on next wake. Converts if needed.
router.post('/send/:bookId', async (req, res) => {
  const { bookId } = req.params;
  const book = queries.getBook(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found' });

  // Only one book can be pending at a time
  const alreadyPending = queries.getPendingSendBook();
  if (alreadyPending && alreadyPending.id !== bookId) {
    queries.setPendingSend(alreadyPending.id, false);
  }

  const convertedDir = path.join(DATA_DIR, 'converted', bookId);
  const isConverted  = fs.existsSync(path.join(convertedDir, 'meta.json'));

  if (!isConverted) {
    console.log(`Converting "${book.title}" before send…`);
    try {
      const { title, author, text } = parseEpub(book.epub_path);
      convertBook(text, convertedDir, { title, author });
      console.log(`  ✓ Conversion complete`);
    } catch (err) {
      console.error('Conversion failed:', err.message);
      return res.status(500).json({ error: `Conversion failed: ${err.message}` });
    }
  }

  const progress = queries.getProgress(bookId);
  deviceSvc.writeStateJson(convertedDir, bookId, progress?.char_offset ?? 0);

  // Convert cover image to BMP for sleep screen (only once)
  if (book.cover_path && !fs.existsSync(path.join(convertedDir, 'cover.bmp'))) {
    const bmpPath = await deviceSvc.convertCoverToBmp(book.cover_path, convertedDir);
    if (bmpPath) {
      console.log(`  ✓ Cover converted to BMP for sleep screen`);
    }
  }

  queries.setPendingSend(bookId, true);

  res.json({ ok: true, bookId, title: book.title });
});

// ── POST /api/device/return ───────────────────────────────────────────────────
// Signals that the current book should be cleared from the device on next wake.
router.post('/return', (req, res) => {
  const book = queries.getOnDeviceBook();
  if (!book) return res.status(404).json({ error: 'No book on device' });

  queries.setPendingReturn(book.id, true);

  res.json({ ok: true, bookId: book.id, title: book.title });
});


// ── GET /api/device/ports ─────────────────────────────────────────────────────
// Returns available serial ports. isX4 is true for Espressif USB CDC devices.
router.get('/ports', async (req, res) => {
  const raw = await deviceSvc.listPorts();
  const ports = raw.map(p => ({
    ...p,
    isX4: (p.vendorId?.toLowerCase() === '303a') ||
          (p.manufacturer?.toLowerCase().includes('espressif')),
  }));
  res.json(ports);
});

// ── GET /api/device/firmware-status ──────────────────────────────────────────
router.get('/firmware-status', (_req, res) => {
  res.json(flashSvc.getFirmwareStatus());
});

// ── GET /api/device/firmware ──────────────────────────────────────────────────
// Serves firmware.bin so the browser-side esptool-js flash can fetch it.
router.get('/firmware', (_req, res) => {
  const p = flashSvc.getFirmwarePath();
  if (!p) return res.status(404).json({ error: 'firmware.bin not found — run: cd firmware && pio run' });
  res.sendFile(p);
});

// ── GET /api/device/local-ip ──────────────────────────────────────────────────
router.get('/local-ip', (_req, res) => {
  res.json({ ip: flashSvc.getLocalIp() });
});

// ── GET /api/device/local-ips ─────────────────────────────────────────────────
router.get('/local-ips', (_req, res) => {
  res.json(flashSvc.getAllLocalIps());
});


module.exports = router;
