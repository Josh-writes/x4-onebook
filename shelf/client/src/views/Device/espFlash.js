/**
 * Browser-side OTA flash for the X4.
 *
 * Mirrors the MicroSlate flasher logic exactly (which is proven to work with
 * CrossPoint and the standard ESP-IDF OTA bootloader).
 *
 * Key detail: ESP-IDF's esp_rom_crc32_le(UINT32_MAX, buf, len) un-XORs the
 * init value before processing, so the effective starting CRC is 0, then the
 * result is XOR'd with 0xFFFFFFFF at the end. The old code started at
 * 0xFFFFFFFF and XOR'd again — double-XOR — producing wrong CRCs that the
 * bootloader rejected, causing it to fall back to CrossPoint.
 *
 * Partition layout (matches firmware/partitions.csv and CrossPoint):
 *   otadata  0x00e000  0x2000
 *   app0     0x010000  0x640000
 *   app1     0x650000  0x640000
 */

import { ESPLoader, Transport } from 'esptool-js';

// ── CRC32 (matches esp_rom_crc32_le(UINT32_MAX, buf, len)) ───────────────────
// Start at 0 (not 0xFFFFFFFF) because the ROM function un-XORs its init arg.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32OfU32Le(value) {
  const b = u32Le(value);
  let crc = 0; // start at 0, not 0xFFFFFFFF
  for (let i = 0; i < 4; i++) {
    crc = CRC_TABLE[(crc ^ b[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Byte helpers ──────────────────────────────────────────────────────────────

function u32Le(value) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value >>> 0, true);
  return b;
}

function readU32Le(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function u8ToBinStr(a) {
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return s;
}

function binStrToU8(s) {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xFF;
  return a;
}

// ── OTA layout constants ──────────────────────────────────────────────────────

const OTADATA_ADDR = 0x00e000;
const OTADATA_SIZE = 0x2000;
const APP0_ADDR    = 0x010000;
const APP1_ADDR    = 0x650000;

// OTA state values (from ESP-IDF esp_ota_img_states_t)
const OTA_STATE_NEW       = 0x00000000;
const OTA_STATE_UNDEFINED = 0xFFFFFFFF;

// Expected partition table — must match firmware/partitions.csv and CrossPoint
const EXPECTED_PARTITIONS = [
  { type: 0x01, subtype: 0x02, offset: 0x009000, size: 0x005000 }, // nvs
  { type: 0x01, subtype: 0x00, offset: 0x00e000, size: 0x002000 }, // otadata
  { type: 0x00, subtype: 0x10, offset: 0x010000, size: 0x640000 }, // app0 (ota_0)
  { type: 0x00, subtype: 0x11, offset: 0x650000, size: 0x640000 }, // app1 (ota_1)
  { type: 0x01, subtype: 0x82, offset: 0xc90000, size: 0x360000 }, // spiffs
  { type: 0x01, subtype: 0x03, offset: 0xff0000, size: 0x010000 }, // coredump
];

// ── Partition table validation ────────────────────────────────────────────────

function parsePartitionTable(data) {
  const partitions = [];
  for (let offset = 0; offset < data.length; offset += 32) {
    const chunk = data.slice(offset, offset + 32);
    if (chunk.length < 32) break;
    // All-0xFF = end of table
    if (chunk.every(b => b === 0xFF)) break;
    // 0xEB 0xEB = MD5 checksum entry, skip
    if (chunk[0] === 0xEB && chunk[1] === 0xEB) continue;

    partitions.push({
      type:    chunk[2],
      subtype: chunk[3],
      offset:  readU32Le(chunk, 4),
      size:    readU32Le(chunk, 8),
    });
  }
  return partitions;
}

function validatePartitionTable(partitions) {
  if (partitions.length !== EXPECTED_PARTITIONS.length) return false;
  return EXPECTED_PARTITIONS.every((exp, i) => {
    const got = partitions[i];
    return got &&
      got.type    === exp.type    &&
      got.subtype === exp.subtype &&
      got.offset  === exp.offset  &&
      got.size    === exp.size;
  });
}

// ── OTA record helpers ────────────────────────────────────────────────────────

function parseOtaRecord(otaData, slotOffset) {
  const sequence = readU32Le(otaData, slotOffset);
  const state    = readU32Le(otaData, slotOffset + 24);
  const storedCrc = readU32Le(otaData, slotOffset + 28);
  const expectedCrc = crc32OfU32Le(sequence);
  const crcValid = storedCrc === expectedCrc;
  const stateValid = state !== OTA_STATE_UNDEFINED && state !== 0x3 && state !== 0x4; // not INVALID/ABORTED
  return { sequence, state, crcValid, valid: crcValid && stateValid && sequence !== 0xFFFFFFFF };
}

function buildOtaRecord(sequence) {
  const slot = new Uint8Array(0x1000).fill(0xFF);
  slot.set(u32Le(sequence), 0);
  slot.set(u32Le(OTA_STATE_NEW), 24);
  slot.set(u32Le(crc32OfU32Le(sequence)), 28);
  return slot;
}

/**
 * Determine which partition to flash to (the inactive one) and what sequence
 * number to assign. Mirrors MicroSlate's OtaPartition logic exactly.
 *
 * When neither slot is valid (factory device), write to app1 to leave any
 * existing firmware in app0 intact as a fallback.
 */
function planOta(otaData) {
  const r0 = parseOtaRecord(otaData, 0x0000); // app0 slot
  const r1 = parseOtaRecord(otaData, 0x1000); // app1 slot

  let currentPartition, backupPartition, backupAddr, backupSlotOffset, newSequence;

  if (!r0.valid && !r1.valid) {
    // Neither slot valid — treat app0 as "current" so we write to app1 (backup).
    // This preserves any factory firmware in app0 as a fallback.
    currentPartition = 'app0';
    backupPartition  = 'app1';
    backupAddr       = APP1_ADDR;
    backupSlotOffset = 0x1000;
    newSequence      = 1;
  } else {
    // Current boot = slot with highest valid sequence
    const current = (r0.valid && (!r1.valid || r0.sequence >= r1.sequence)) ? 'app0' : 'app1';
    const currentSeq = current === 'app0' ? r0.sequence : r1.sequence;
    backupPartition  = current === 'app0' ? 'app1' : 'app0';
    backupAddr       = backupPartition === 'app0' ? APP0_ADDR : APP1_ADDR;
    backupSlotOffset = backupPartition === 'app0' ? 0x0000 : 0x1000;
    currentPartition = current;
    newSequence      = currentSeq + 1;
  }

  const newOtaData = new Uint8Array(otaData);
  newOtaData.set(buildOtaRecord(newSequence), backupSlotOffset);

  return { currentPartition, backupPartition, backupAddr, newOtaData };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function isWebSerialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Flash the X4 via Web Serial (OTA — writes firmware.bin to backup slot,
 * updates otadata to boot into it on next reset).
 *
 * @param {string}   firmwareUrl  URL to fetch firmware.bin from
 * @param {Function} onEvent      ({ type, message, percent }) => void
 */
export async function flashOta(firmwareUrl, onEvent) {
  const emit = (type, message, percent = undefined) => onEvent({ type, message, percent });

  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (err) {
    throw new Error(`Port selection cancelled or unavailable: ${err.message}`);
  }

  const transport = new Transport(port, true);
  const loader = new ESPLoader({
    transport,
    baudrate:    921600,
    romBaudrate: 115200,
    enableTracing: false,
  });

  try {
    emit('info', 'Connecting to device…', 2);
    const chipDesc = await loader.main();
    emit('info', `Connected: ${chipDesc}`, 5);

    // Validate partition table — ensures this device has the right layout
    emit('info', 'Validating partition table…', 8);
    const rawPt = await loader.readFlash(0x8000, 0x2000);
    const ptBytes = typeof rawPt === 'string' ? binStrToU8(rawPt) : new Uint8Array(rawPt);
    const partitions = parsePartitionTable(ptBytes);
    if (!validatePartitionTable(partitions)) {
      throw new Error(
        `Partition table does not match expected layout.\n` +
        `Found ${partitions.length} partition(s): ${JSON.stringify(partitions)}\n\n` +
        `This device may need a full flash first. Use PlatformIO: cd firmware && pio run -t upload`
      );
    }
    emit('info', 'Partition table OK', 12);

    // Fetch firmware binary from shelf server
    emit('info', 'Downloading firmware…', 14);
    const fwResp = await fetch(firmwareUrl);
    if (!fwResp.ok) throw new Error(`Failed to fetch firmware: HTTP ${fwResp.status}`);
    const fwBytes = new Uint8Array(await fwResp.arrayBuffer());
    emit('info', `Firmware: ${(fwBytes.length / 1024).toFixed(0)} KB`, 18);

    // Read otadata to find the inactive (backup) partition
    emit('info', 'Reading OTA metadata…', 20);
    const rawOta = await loader.readFlash(OTADATA_ADDR, OTADATA_SIZE);
    const otaData = typeof rawOta === 'string' ? binStrToU8(rawOta) : new Uint8Array(rawOta);

    const { currentPartition, backupPartition, backupAddr, newOtaData } = planOta(otaData);
    emit('info', `Boot: ${currentPartition} → writing to ${backupPartition} @ 0x${backupAddr.toString(16)}`, 22);

    // Write firmware to the backup partition
    await loader.writeFlash({
      fileArray: [{ data: u8ToBinStr(fwBytes), address: backupAddr }],
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll:  false,
      compress:  true,
      reportProgress(_idx, written, total) {
        const pct = 22 + Math.round((written / total) * 58);
        emit('progress', `Writing firmware… ${Math.round((written / total) * 100)}%`, pct);
      },
    });

    // Update otadata to boot into the newly written partition
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

    emit('info', 'Resetting device…', 96);
    await loader.after('hard_reset');

    emit('success', 'Firmware installed. Device is rebooting.', 100);

  } finally {
    try { await transport.disconnect(); } catch { /* ignore */ }
  }
}
