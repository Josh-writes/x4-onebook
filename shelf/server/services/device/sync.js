/**
 * Sync service — polls the device and drives the exchange.
 * 
 * The device runs an HTTP server; we connect to it and drive all operations:
 * - GET /state → record progress
 * - POST /book/* → upload pending book files
 * - DELETE /book → clear device
 * - POST /sync-complete → tell device to stop
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const queries  = require('../../db/queries');
const metrics  = require('../metrics');
const usbSync  = require('./usb-sync');
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');

let eventEmitter = null;

function setEventEmitter(ee) {
  eventEmitter = ee;
}

function emit(event, data) {
  if (eventEmitter) {
    eventEmitter.emit(event, data);
  }
}

const DEVICE_DEFAULT_IP  = '192.168.4.1';  // ESP32 AP default
const DEVICE_MDNS_HOST   = 'x4book.local';
const POLL_INTERVAL_MS   = 2000;
const REQUEST_TIMEOUT_MS = 10000;

function httpRequest(method, urlPath, timeoutMs = REQUEST_TIMEOUT_MS, host = DEVICE_DEFAULT_IP) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: 80,
      path: urlPath,
      method,
      timeout: timeoutMs,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

function isIpv4Address(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

// Upload a file buffer to the device using multipart/form-data so binary
// files (idx, bmp) are safe and large txt files stream instead of buffering.
function uploadFile(filename, fileBuffer, deviceIp, timeoutMs = 60000) {
  const boundary = '----X4BookBoundary';
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const totalLen = header.length + fileBuffer.length + footer.length;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: deviceIp,
      port: 80,
      path: `/book/${filename}`,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': totalLen,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Upload timeout')); });
    req.write(header);
    req.write(fileBuffer);
    req.write(footer);
    req.end();
  });
}

// Only open the serial port when there is work to do — this keeps it free for
// the firmware flash tool (Web Serial) the rest of the time.
// After a failed sync, stop retrying until the device reconnects.
let _lastUsbPort = null;
let _usbBusy     = false;
let _usbFailed   = false;

async function poll() {
  // ── USB first ───────────────────────────────────────────────────────────────
  const usbPort = await usbSync.findX4Port();
  if (usbPort) {
    const isNew = usbPort.path !== _lastUsbPort;
    if (isNew) {
      _lastUsbPort = usbPort.path;
      _usbFailed   = false;  // fresh connection — allow retry
    }

    const hasPending = !!queries.getPendingSendBook() ||
                       !!queries.getOnDeviceBook()?.pending_return;

    if (hasPending && !_usbBusy && !_usbFailed) {
      _usbBusy = true;
      usbSync.trySync(emit)
        .then(ok => { if (!ok) _usbFailed = true; })
        .catch(err => {
          console.error('[sync] USB error:', err.message);
          emit('sync:error', { error: err.message });
          _usbFailed = true;
        })
        .finally(() => { _usbBusy = false; });
    }
    return;  // don't try WiFi while USB device is present
  }
  _lastUsbPort = null;
  _usbFailed   = false;  // reset when device unplugged

  // ── WiFi fallback ────────────────────────────────────────────────────────────
  const configuredIp = (queries.getSetting('deviceIp') || '').trim();
  const probeHosts = [configuredIp, DEVICE_MDNS_HOST, DEVICE_DEFAULT_IP]
    .filter(Boolean)
    .filter((host, idx, arr) => arr.indexOf(host) === idx);

  let deviceHost = null;
  for (const host of probeHosts) {
    try {
      const pong = await httpRequest('GET', '/ping', 3000, host);
      if (pong.status === 200 && pong.body.ok) {
        deviceHost = host;
        break;
      }
    } catch {
      // try next host
    }
  }
  if (!deviceHost) return;

  console.log('[sync] Device detected at', deviceHost);
  emit('sync:device-detected', { ip: deviceHost });
  if (isIpv4Address(deviceHost) && configuredIp !== deviceHost) {
    queries.setSetting('deviceIp', deviceHost);
  }

  try {
    const stateResp = await httpRequest('GET', '/state', REQUEST_TIMEOUT_MS, deviceHost);
    if (stateResp.status !== 200) throw new Error('Failed to get state');

    const deviceState = stateResp.body;
    console.log('[sync] Device state:', deviceState);

    // Record progress and update on_device tracking
    if (deviceState.bookId) {
      const book = queries.getBook(deviceState.bookId);
      if (book) {
        try {
          const convertedDir = path.join(DATA_DIR, 'converted', deviceState.bookId);
          const charOffset = metrics.pageToCharOffset(
            convertedDir, deviceState.font, Number(deviceState.size), Number(deviceState.page)
          );
          metrics.recordSync(deviceState.bookId, charOffset);

          const prev = queries.getOnDeviceBook();
          if (prev && prev.id !== deviceState.bookId) {
            queries.setOnDevice(prev.id, false);
            queries.setPendingReturn(prev.id, false);
          }
          queries.setOnDevice(deviceState.bookId, true);
          queries.setPendingSend(deviceState.bookId, false);

          console.log('[sync] Progress recorded:', charOffset, 'chars');
          emit('sync:progress', { bookId: deviceState.bookId, charOffset });
        } catch (err) {
          console.error('[sync] Progress error:', err.message);
        }
      }
    } else {
      const stale = queries.getOnDeviceBook();
      if (stale) {
        queries.setOnDevice(stale.id, false);
        queries.setPendingReturn(stale.id, false);
      }
    }

    const onDevice = queries.getOnDeviceBook();
    const pending  = queries.getPendingSendBook();

    if (onDevice && onDevice.pending_return) {
      console.log('[sync] Returning book...');
      emit('sync:returning', {});
      await httpRequest('DELETE', '/book', REQUEST_TIMEOUT_MS, deviceHost);
      queries.setOnDevice(onDevice.id, false);
      queries.setPendingReturn(onDevice.id, false);

    } else if (pending && (!onDevice || pending.id !== onDevice.id)) {
      console.log('[sync] Sending book:', pending.title);
      emit('sync:sending', { title: pending.title });

      const convertedDir = path.join(DATA_DIR, 'converted', pending.id);

      // Build file list: { publicName, diskName }
      const files = [];
      for (const name of fs.readdirSync(convertedDir)) {
        if (name.endsWith('.txt') || name.endsWith('.idx')) {
          files.push({ publicName: name, diskName: name });
        }
      }
      if (fs.existsSync(path.join(convertedDir, 'meta.json')))
        files.push({ publicName: 'meta.json',  diskName: 'meta.json' });
      if (fs.existsSync(path.join(convertedDir, '_state.json')))
        files.push({ publicName: 'state.json', diskName: '_state.json' });  // shelf stores as _state.json
      if (fs.existsSync(path.join(convertedDir, 'cover.bmp')))
        files.push({ publicName: 'cover.bmp',  diskName: 'cover.bmp' });

      for (let i = 0; i < files.length; i++) {
        const { publicName, diskName } = files[i];
        const content = fs.readFileSync(path.join(convertedDir, diskName));
        await uploadFile(publicName, content, deviceHost);
        console.log('[sync] Uploaded', publicName, `${i + 1}/${files.length}`);
        emit('sync:send-progress', { filename: publicName, progress: ((i + 1) / files.length) * 100 });
      }

      queries.setPendingSend(pending.id, false);
      queries.setOnDevice(pending.id, true);
    }

    console.log('[sync] Complete, signaling device...');
    emit('sync:complete', {});
    await httpRequest('POST', '/sync-complete', REQUEST_TIMEOUT_MS, deviceHost);

  } catch (err) {
    console.error('[sync] Error:', err.message);
    emit('sync:error', { error: err.message });
  }
}


let pollInterval = null;

function start() {
  if (pollInterval) return;
  pollInterval = setInterval(poll, POLL_INTERVAL_MS);
  console.log('[sync] Polling started');
}

function stop() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[sync] Polling stopped');
  }
}

module.exports = {
  setEventEmitter,
  start,
  stop,
  poll,
};
