/**
 * USB sync — transfers a pending book to the X4 over serial when it's plugged in.
 *
 * Protocol (shelf → device / device → shelf):
 *   Shelf:  "X4SYNC\n"
 *   Device: "X4READY:{state_json}\n"
 *   Shelf:  "X4FILE:filename:bytecount\n" + <raw bytes>
 *   Device: "X4OK\n"  (per file)
 *   Shelf:  "X4DELETE\n"  (to clear book instead of send)
 *   Device: "X4OK\n"
 *   Shelf:  "X4SYNCDONE\n"
 *   Device: "X4BYE\n"
 */

const fs   = require('fs');
const path = require('path');

const queries  = require('../../db/queries');
const metrics  = require('../metrics');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');

let SerialPort;
try { SerialPort = require('serialport').SerialPort; } catch { SerialPort = null; }

// ── Helpers ───────────────────────────────────────────────────────────────────

// Simple line-reader: listens on port.data, resolves promises for each '\n'.
class LineReader {
  constructor(port) {
    this._buf      = '';
    this._queue    = [];
    this._waiters  = [];
    port.on('data', chunk => {
      this._buf += chunk.toString('binary');
      const lines = this._buf.split('\n');
      this._buf = lines.pop();
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '').trim();
        if (!line) continue;
        if (this._waiters.length > 0) {
          const { resolve, timer } = this._waiters.shift();
          clearTimeout(timer);
          resolve(line);
        } else {
          this._queue.push(line);
        }
      }
    });
  }

  read(timeoutMs = 5000) {
    if (this._queue.length > 0) return Promise.resolve(this._queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) this._waiters.splice(idx, 1);
        reject(new Error(`USB read timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this._waiters.push({ resolve, timer });
    });
  }
}

function writeAndDrain(port, data) {
  return new Promise((resolve, reject) => {
    port.write(data, err => {
      if (err) return reject(err);
      port.drain(err2 => err2 ? reject(err2) : resolve());
    });
  });
}

function openPort(portPath) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: portPath, baudRate: 115200 }, err => {
      if (err) reject(err); else resolve(port);
    });
  });
}

function closePort(port) {
  return new Promise(resolve => port.isOpen ? port.close(() => resolve()) : resolve());
}

// Read lines, skipping device log output, until one starts with `prefix`.
// Returns the matching line, or null on timeout.
async function waitForPrefix(reader, prefix, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const line = await reader.read(Math.min(remaining, 1000));
      if (line.startsWith(prefix)) return line;
      // log lines from device — ignore silently
    } catch {
      continue; // individual read timed out — keep waiting until deadline
    }
  }
  return null;
}

// ── Port detection ────────────────────────────────────────────────────────────

async function findX4Port() {
  if (!SerialPort) return null;
  try {
    const ports = await SerialPort.list();
    const match = ports.find(p =>
      p.vendorId?.toLowerCase() === '303a' ||
      p.manufacturer?.toLowerCase()?.includes('espressif')
    );
    if (match) return match;

    // Fallback for environments where VID/manufacturer aren't exposed by the
    // serial backend (common on some Linux/macOS setups).
    return ports.find(p => {
      const path = (p.path || '').toLowerCase();
      return (
        path.includes('ttyacm') ||
        path.includes('ttyusb') ||
        path.includes('usbmodem') ||
        path.startsWith('com')
      );
    }) || null;
  } catch {
    return null;
  }
}

// ── Core sync ─────────────────────────────────────────────────────────────────

async function runSync(portPath, emit) {
  const port = await openPort(portPath);
  const reader = new LineReader(port);

  try {
    // Give USB CDC time to settle. Some X4 boards reset on open (DTR toggle),
    // so we retry handshake while boot logs are still printing.
    await new Promise(r => setTimeout(r, 600));

    // Device serial also carries boot/log output — keep sending X4SYNC until
    // we receive X4READY (or timeout). This avoids missing the command during
    // early boot when the board just reset on port-open.
    const readyDeadline = Date.now() + 20000;
    let ready = null;
    while (!ready && Date.now() < readyDeadline) {
      await writeAndDrain(port, 'X4SYNC\n');
      ready = await waitForPrefix(reader, 'X4READY:', 1200);
    }
    if (!ready) {
      console.warn('[usb-sync] No X4READY response');
      emit('sync:error', { error: 'Device did not respond to USB handshake', transport: 'usb' });
      return false;
    }

    const deviceState = JSON.parse(ready.slice(8));
    console.log('[usb-sync] Device state:', deviceState);
    emit('sync:device-detected', { transport: 'usb' });

    // Record progress if device has a book
    if (deviceState.bookId) {
      const book = queries.getBook(deviceState.bookId);
      if (book) {
        try {
          const convertedDir = path.join(DATA_DIR, 'converted', deviceState.bookId);
          const charOffset = metrics.pageToCharOffset(
            convertedDir,
            deviceState.font,
            Number(deviceState.size),
            Number(deviceState.page)
          );
          metrics.recordSync(deviceState.bookId, charOffset);
          queries.setOnDevice(deviceState.bookId, true);
          queries.setPendingSend(deviceState.bookId, false);
          emit('sync:progress', { bookId: deviceState.bookId, charOffset });
        } catch (err) {
          console.error('[usb-sync] Progress error:', err.message);
        }
      }
    }

    const onDevice = queries.getOnDeviceBook();
    const pending  = queries.getPendingSendBook();

    if (onDevice?.pending_return) {
      emit('sync:returning', {});
      await writeAndDrain(port, 'X4DELETE\n');
      await reader.read(10000);
      queries.setOnDevice(onDevice.id, false);
      queries.setPendingReturn(onDevice.id, false);

    } else if (pending && (!onDevice || pending.id !== onDevice.id)) {
      emit('sync:sending', { title: pending.title });
      const convertedDir = path.join(DATA_DIR, 'converted', pending.id);

      const files = [];
      for (const name of fs.readdirSync(convertedDir)) {
        if (name.endsWith('.txt') || name.endsWith('.idx'))
          files.push({ publicName: name, diskName: name });
      }
      if (fs.existsSync(path.join(convertedDir, 'meta.json')))
        files.push({ publicName: 'meta.json',  diskName: 'meta.json' });
      if (fs.existsSync(path.join(convertedDir, '_state.json')))
        files.push({ publicName: 'state.json', diskName: '_state.json' });
      if (fs.existsSync(path.join(convertedDir, 'cover.bmp')))
        files.push({ publicName: 'cover.bmp',  diskName: 'cover.bmp' });

      for (let i = 0; i < files.length; i++) {
        const { publicName, diskName } = files[i];
        const buf = fs.readFileSync(path.join(convertedDir, diskName));
        await writeAndDrain(port, `X4FILE:${publicName}:${buf.length}\n`);
        await writeAndDrain(port, buf);
        const ack = await waitForPrefix(reader, 'X4', 120000);
        if (ack !== 'X4OK') throw new Error(`Bad ack for ${publicName}: ${ack}`);
        console.log(`[usb-sync] Sent ${publicName} (${buf.length} bytes)`);
        emit('sync:send-progress', {
          filename: publicName,
          progress: Math.round(((i + 1) / files.length) * 100),
        });
      }

      queries.setPendingSend(pending.id, false);
      queries.setOnDevice(pending.id, true);
    }

    await writeAndDrain(port, 'X4SYNCDONE\n');
    await reader.read(5000);  // X4BYE

    emit('sync:complete', { transport: 'usb' });
    console.log('[usb-sync] Sync complete');
    return true;

  } finally {
    await closePort(port);
  }
}

// ── Public: called from poll() in sync.js ─────────────────────────────────────

// Returns the X4 port if present, null otherwise.
// Exported so sync.js can check without opening the port.
async function trySync(emit) {
  if (!SerialPort) return false;

  const portInfo = await findX4Port();
  if (!portInfo) return false;

  try {
    return await runSync(portInfo.path, emit);
  } catch (err) {
    console.error('[usb-sync] Error:', err.message);
    emit('sync:error', { error: err.message, transport: 'usb' });
    return false;
  }
}

module.exports = { trySync, findX4Port };
