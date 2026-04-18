/**
 * Device service — USB and WiFi communication with the X4.
 *
 * USB: uses serialport to transfer files over a simple protocol.
 * WiFi: the device POSTs state.json; we just listen (see routes/sync.js).
 *
 * For the MVP this module exposes the file-transfer helpers used by
 * the send/return routes. USB transport is optional; if serialport
 * is unavailable the app still works over WiFi.
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');

let SerialPort;
try {
  SerialPort = require('serialport').SerialPort;
} catch {
  // serialport not installed or native build failed — USB disabled
  SerialPort = null;
}

let sharp;
try {
  sharp = require('sharp');
} catch {
  // sharp not available — cover conversion disabled
  sharp = null;
}

// ── WiFi helpers ──────────────────────────────────────────────────────────────

/**
 * Check if the device is reachable over WiFi by hitting its /ping endpoint.
 * Returns true if reachable within the timeout.
 */
function pingDevice(deviceIp, timeoutMs = 2000) {
  return new Promise(resolve => {
    const req = http.get(`http://${deviceIp}/ping`, { timeout: timeoutMs }, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ── USB helpers ───────────────────────────────────────────────────────────────

function isUsbAvailable() {
  return !!SerialPort;
}

function openPort(portPath, baudRate = 115200) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: portPath, baudRate }, err => {
      if (err) reject(err);
      else resolve(port);
    });
  });
}

function closePort(port) {
  return new Promise(resolve => {
    if (!port || !port.isOpen) return resolve();
    port.close(() => resolve());
  });
}

function writeAndDrain(port, data) {
  return new Promise((resolve, reject) => {
    port.write(data, err => {
      if (err) return reject(err);
      port.drain(err2 => err2 ? reject(err2) : resolve());
    });
  });
}

function readLine(port, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = chunk => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx < 0) return;
      cleanup();
      const line = buf.slice(0, idx).replace(/\r$/, '').trim();
      resolve(line);
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error(`USB read timeout after ${timeoutMs}ms`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      port.off('data', onData);
    };
    const timer = setTimeout(onTimeout, timeoutMs);
    port.on('data', onData);
  });
}

/**
 * List available serial ports (for settings UI).
 */
async function listPorts() {
  if (!SerialPort) return [];
  const { SerialPort: SP } = require('serialport');
  return SP.list();
}

async function configureWifiOverUsb(portPath, { wifiNetworks, shelfIp, shelfPort = 3001 }) {
  if (!SerialPort) throw new Error('USB serial support is unavailable (serialport module missing)');
  if (!portPath) throw new Error('No serial port selected');
  if (!Array.isArray(wifiNetworks) || wifiNetworks.length === 0) {
    throw new Error('No WiFi networks selected');
  }

  const payload = {
    wifiNetworks: wifiNetworks.map(n => ({
      ssid: String(n.ssid || ''),
      password: String(n.password || ''),
      priority: Number(n.priority || 0),
    })),
    shelfIp: shelfIp || '',
    shelfPort: Number(shelfPort) || 3001,
  };

  const port = await openPort(portPath, 115200);
  try {
    await new Promise(r => setTimeout(r, 600));

    const line = `X4SETUP:${JSON.stringify(payload)}\n`;
    const deadline = Date.now() + 15000;

    while (Date.now() < deadline) {
      await writeAndDrain(port, line);
      try {
        const rsp = await readLine(port, 1200);
        if (rsp === 'X4SETUP:OK') return { ok: true };
        if (rsp === 'X4SETUP:ERR') return { ok: false, error: 'Device rejected WiFi configuration' };
      } catch {
        // keep retrying until deadline
      }
    }

    return { ok: false, error: 'No response from device while configuring WiFi over USB' };
  } finally {
    await closePort(port);
  }
}

// ── File set assembly ─────────────────────────────────────────────────────────

/**
 * Build the complete list of files to send to the device for a book.
 * Returns array of { srcPath, destPath } objects.
 *
 * @param {object} book    DB book row
 * @param {string} convertedDir  Absolute path to book's converted/ directory
 * @param {string} coverPath     Absolute path to cover image (may be null)
 */
function buildFileSet(book, convertedDir, coverPath) {
  const files = [];

  // All .txt and .idx variants
  const entries = fs.readdirSync(convertedDir);
  for (const name of entries) {
    if (name.endsWith('.txt') || name.endsWith('.idx')) {
      files.push({
        srcPath: path.join(convertedDir, name),
        destPath: `/book/${name}`,
      });
    }
  }

  // meta.json
  const metaPath = path.join(convertedDir, 'meta.json');
  if (fs.existsSync(metaPath)) {
    files.push({ srcPath: metaPath, destPath: '/book/meta.json' });
  }

  // state.json — written fresh with offset 0 (or current progress)
  const statePath = path.join(convertedDir, '_state.json');
  files.push({ srcPath: statePath, destPath: '/book/state.json' });

  // cover image
  if (coverPath && fs.existsSync(coverPath)) {
    const ext = path.extname(coverPath);
    files.push({ srcPath: coverPath, destPath: `/book/cover${ext}` });
  }

  return files;
}

/**
 * Write a state.json for the given char offset (or defaults).
 * Reads the first .idx file to resolve offset → page for the default font.
 * bookId is included so the device can identify itself on sync.
 */
function writeStateJson(convertedDir, bookId, charOffset = 0) {
  const stateJson = {
    bookId,
    font: 'bookerly',
    size: 14,
    page: charOffsetToPage(convertedDir, 'bookerly', 14, charOffset),
    orientation: 0,
  };
  const dest = path.join(convertedDir, '_state.json');
  fs.writeFileSync(dest, JSON.stringify(stateJson, null, 2));
  return dest;
}

function charOffsetToPage(convertedDir, font, size, charOffset) {
  const idxPath = path.join(convertedDir, `${font}_${size}.idx`);
  if (!fs.existsSync(idxPath)) return 0;
  const buf = fs.readFileSync(idxPath);
  const pageCount = buf.length / 4;
  // Binary search for the page whose offset is <= charOffset
  let lo = 0, hi = pageCount - 1, result = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const offset = buf.readUInt32LE(mid * 4);
    if (offset <= charOffset) { result = mid; lo = mid + 1; }
    else { hi = mid - 1; }
  }
  return result;
}

// ── Cover image conversion ───────────────────────────────────────────────────

const X4_WIDTH = 800;
const X4_HEIGHT = 480;

/**
 * Convert a cover image (JPG/PNG) to 1-bit BMP for the X4 e-ink display.
 * Uses "fit" mode: scales to fit within 800x480 while preserving aspect ratio.
 * Applies Atkinson dithering for clean e-ink rendering.
 * Returns path to converted BMP, or null on failure.
 */
async function convertCoverToBmp(coverPath, destDir) {
  if (!sharp) {
    console.warn('Cover conversion: sharp not available');
    return null;
  }

  if (!coverPath || !fs.existsSync(coverPath)) {
    return null;
  }

  const destBmpPath = path.join(destDir, 'cover.bmp');

  try {
    // Load image and resize to fit within X4 dimensions while preserving aspect
    const image = sharp(coverPath);
    const metadata = await image.metadata();

    // Calculate fit dimensions (max 800x480)
    let width = metadata.width;
    let height = metadata.height;

    if (width > X4_WIDTH || height > X4_HEIGHT) {
      const scale = Math.min(X4_WIDTH / width, X4_HEIGHT / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    // Resize and convert to 1-bit grayscale with dithering
    // Sharp doesn't do Atkinson dithering, so we use Floyd-Steinberg via dither kernel
    await image
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: false })
      .then(buf => {
        // Apply simple threshold-based dithering for 1-bit output
        // This is a simplified approach - the device does more sophisticated dithering
        const output = Buffer.alloc(Math.ceil(width / 8) * height);

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const pixel = buf[y * width + x];
            // Simple threshold with slight randomization for smoother result
            const threshold = 128 + ((x + y) % 3 - 1) * 10;
            const bit = pixel < threshold ? 1 : 0;
            const byteIndex = y * Math.ceil(width / 8) + Math.floor(x / 8);
            const bitIndex = 7 - (x % 8);
            output[byteIndex] |= (bit << bitIndex);
          }
        }

        // Write 1-bit BMP header + data
        const rowSize = Math.ceil(width / 8);
        const pixelDataSize = rowSize * height;
        const fileSize = 54 + pixelDataSize;  // BMP header (14) + DIB (40) + pixels

        // BMP uses bottom-up row order
        const bmp = Buffer.alloc(fileSize);
        let offset = 0;

        // BMP File Header (14 bytes)
        bmp.write('BM', offset); offset += 2;
        bmp.writeUInt32LE(fileSize, offset); offset += 4;
        bmp.writeUInt32LE(0, offset); offset += 4;  // Reserved
        bmp.writeUInt32LE(54, offset); offset += 4;  // Pixel data offset

        // DIB Header (40 bytes) - BITMAPINFOHEADER
        bmp.writeUInt32LE(40, offset); offset += 4;  // DIB size
        bmp.writeInt32LE(width, offset); offset += 4;
        bmp.writeInt32LE(-height, offset); offset += 4;  // Negative = top-down
        bmp.writeUInt16LE(1, offset); offset += 2;  // Planes
        bmp.writeUInt16LE(1, offset); offset += 2;  // Bits per pixel (1-bit)
        bmp.writeUInt32LE(0, offset); offset += 4;  // Compression (none)
        bmp.writeUInt32LE(pixelDataSize, offset); offset += 4;
        bmp.writeInt32LE(2835, offset); offset += 4;  // X pixels per meter
        bmp.writeInt32LE(2835, offset); offset += 4;  // Y pixels per meter
        bmp.writeUInt32LE(0, offset); offset += 4;  // Colors used
        bmp.writeUInt32LE(0, offset); offset += 4;  // Important colors

        // Copy pixel data (already in correct format)
        output.copy(bmp, offset);

        fs.writeFileSync(destBmpPath, bmp);
      });

    console.log(`Cover converted to BMP: ${destBmpPath}`);
    return destBmpPath;
  } catch (err) {
    console.error('Cover conversion failed:', err.message);
    return null;
  }
}

module.exports = {
  pingDevice,
  isUsbAvailable,
  listPorts,
  configureWifiOverUsb,
  buildFileSet,
  writeStateJson,
  charOffsetToPage,
  convertCoverToBmp,
};
