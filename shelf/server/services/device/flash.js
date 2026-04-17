const path = require('path');
const fs   = require('fs');
const os   = require('os');

const FIRMWARE_ROOT = path.join(__dirname, '..', '..', '..', '..', 'firmware');
const BUILD_DIR     = path.join(FIRMWARE_ROOT, '.pio', 'build', 'default');
const FIRMWARE_BIN  = path.join(BUILD_DIR, 'firmware.bin');

function getFirmwareStatus() {
  const compiled = fs.existsSync(FIRMWARE_BIN);
  return { compiled, buildDir: BUILD_DIR };
}

function getFirmwarePath() {
  return fs.existsSync(FIRMWARE_BIN) ? FIRMWARE_BIN : null;
}

/** Returns all non-loopback IPv4 addresses of this machine. */
function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const entry of list) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

function getAllLocalIps() {
  const ifaces = os.networkInterfaces();
  const result = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const entry of list) {
      if (entry.family === 'IPv4' && !entry.internal) {
        result.push({ name, address: entry.address });
      }
    }
  }
  return result;
}

module.exports = { getFirmwareStatus, getFirmwarePath, getLocalIp, getAllLocalIps };
