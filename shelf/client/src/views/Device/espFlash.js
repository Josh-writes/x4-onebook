/**
 * Browser-side OTA flash for the X4.
 *
 * Uses esptool-js (Web Serial API) to write only firmware.bin to the
 * backup OTA partition, then update otadata so the device boots into it.
 * This is ~2 min vs ~25 min for a full 4-image flash, and requires no
 * Python or PlatformIO installation.
 *
 * Partition layout (matches firmware/partitions.csv):
 *   otadata  0x00e000  0x2000
 *   app0     0x010000  0x640000
 *   app1     0x650000  0x640000
 */

import { ESPLoader, Transport } from 'esptool-js';

// ── CRC32 (IEEE 802.3) ────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Byte helpers ──────────────────────────────────────────────────────────────

function u32Le(value) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value >>> 0, /* little-endian */ true);
  return b;
}

function readU32Le(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

/** Convert a binary string (char = one byte) to Uint8Array. */
function binStrToU8(s) {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xFF;
  return a;
}

/** Convert Uint8Array to binary string for esptool-js write_flash. */
function u8ToBinStr(a) {
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return s;
}

// ── OTA layout constants ──────────────────────────────────────────────────────

const OTADATA_ADDR        = 0x00e000;
const OTADATA_SIZE        = 0x2000;
const APP0_ADDR           = 0x010000;
const APP1_ADDR           = 0x650000;
const APP0_RECORD_OFFSET  = 0x0000;   // first  1 KB of otadata
const APP1_RECORD_OFFSET  = 0x1000;   // second 1 KB of otadata

// OTA record layout (32 bytes used per 1 KB slot):
//   [0..3]   sequence (u32 LE)
//   [4..23]  padding (0xFF)
//   [24..27] state    (u32 LE)
//   [28..31] crc32 of sequence bytes (u32 LE)

const OTA_STATE_NEW = 0x00000000;

// ── OTA record helpers ────────────────────────────────────────────────────────

function parseRecord(otaData, offset) {
  const sequence = readU32Le(otaData, offset);
  const state    = readU32Le(otaData, offset + 24);
  const crc      = readU32Le(otaData, offset + 28);
  const expectedCrc = crc32(u32Le(sequence));
  const valid = (crc === expectedCrc) && (state !== 0xFFFFFFFF);
  return { sequence, state, valid };
}

function buildRecord(sequence) {
  // 1 KB slot filled with 0xFF, first 32 bytes are the record
  const slot = new Uint8Array(0x1000).fill(0xFF);
  const seq  = u32Le(sequence);
  slot.set(seq, 0);
  slot.set(u32Le(OTA_STATE_NEW), 24);
  slot.set(u32Le(crc32(seq)), 28);
  return slot;
}

/**
 * Given the current otadata buffer (0x2000 bytes), determine which app
 * partition to target (the one NOT currently booting) and build new otadata.
 */
function planOta(otaData) {
  const r0 = parseRecord(otaData, APP0_RECORD_OFFSET);
  const r1 = parseRecord(otaData, APP1_RECORD_OFFSET);

  let targetPartition, targetAddr, targetOffset, newSequence;

  if (!r0.valid && !r1.valid) {
    // Device has never done OTA — write to app0 (default first boot slot)
    targetPartition = 'app0';
    targetAddr      = APP0_ADDR;
    targetOffset    = APP0_RECORD_OFFSET;
    newSequence     = 1;
  } else if (r0.valid && (!r1.valid || r0.sequence >= r1.sequence)) {
    // app0 is active → write to app1
    targetPartition = 'app1';
    targetAddr      = APP1_ADDR;
    targetOffset    = APP1_RECORD_OFFSET;
    newSequence     = r0.sequence + 1;
  } else {
    // app1 is active → write to app0
    targetPartition = 'app0';
    targetAddr      = APP0_ADDR;
    targetOffset    = APP0_RECORD_OFFSET;
    newSequence     = r1.sequence + 1;
  }

  // Clone otadata and write the new record into the target slot
  const newOtaData = new Uint8Array(otaData);
  newOtaData.set(buildRecord(newSequence), targetOffset);

  return { targetPartition, targetAddr, newOtaData };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function isWebSerialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Flash the X4 via Web Serial (OTA only — writes firmware.bin to backup slot).
 *
 * @param {string}   firmwareUrl  URL to fetch firmware.bin from
 * @param {Function} onEvent      (event: { type, message, percent }) => void
 *
 * The browser will show its own "select a port" dialog (Web Serial requirement).
 * Throws on hard failure; progress/errors also delivered via onEvent.
 */
export async function flashOta(firmwareUrl, onEvent) {
  const emit = (type, message, percent = undefined) => onEvent({ type, message, percent });

  // Step 1 — request port (browser dialog; no filter so all COM ports appear)
  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (err) {
    throw new Error(`Port selection cancelled or unavailable: ${err.message}`);
  }

  const transport = new Transport(port, true);
  const loader    = new ESPLoader({
    transport,
    baudrate:    921600,
    romBaudrate: 115200,
    enableTracing: false,
  });

  try {
    // Step 2 — connect to ROM bootloader
    emit('info', 'Connecting to device…', 2);
    const chipDesc = await loader.main();
    emit('info', `Connected: ${chipDesc}`, 5);

    // Step 3 — fetch firmware.bin from shelf server
    emit('info', 'Downloading firmware from shelf…', 8);
    const fwResp = await fetch(firmwareUrl);
    if (!fwResp.ok) throw new Error(`Failed to fetch firmware: HTTP ${fwResp.status}`);
    const fwBytes = new Uint8Array(await fwResp.arrayBuffer());
    emit('info', `Firmware: ${(fwBytes.length / 1024).toFixed(0)} KB`, 12);

    // Step 4 — read current otadata to determine backup slot
    emit('info', 'Reading OTA metadata…', 15);
    const rawOta  = await loader.readFlash(OTADATA_ADDR, OTADATA_SIZE);
    // read_flash may return a string or Uint8Array depending on esptool-js version
    const otaData = (typeof rawOta === 'string') ? binStrToU8(rawOta) : new Uint8Array(rawOta);

    const { targetPartition, targetAddr, newOtaData } = planOta(otaData);
    emit('info', `Writing to ${targetPartition} @ 0x${targetAddr.toString(16)}…`, 18);

    // Step 5 — write firmware.bin to backup partition
    await loader.writeFlash({
      fileArray: [{ data: u8ToBinStr(fwBytes), address: targetAddr }],
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll:  false,
      compress:  true,
      reportProgress(_idx, written, total) {
        const pct = 18 + Math.round((written / total) * 62);
        emit('progress', `Writing firmware… ${Math.round((written / total) * 100)}%`, pct);
      },
    });

    // Step 6 — update otadata to boot into the new partition
    emit('info', 'Updating OTA boot record…', 82);
    await loader.writeFlash({
      fileArray: [{ data: u8ToBinStr(newOtaData), address: OTADATA_ADDR }],
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll:  false,
      compress:  true,
      reportProgress() {},
    });

    // Step 7 — reset device into new firmware
    emit('info', 'Resetting device…', 95);
    await loader.after('hard_reset');

    emit('success', 'Firmware installed. Device is rebooting.', 100);

  } finally {
    try { await transport.disconnect(); } catch { /* ignore */ }
    // Don't close port here — browser manages its lifetime
  }
}
