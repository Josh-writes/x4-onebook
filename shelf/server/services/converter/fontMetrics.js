/**
 * Font metrics for the X4 e-ink display.
 *
 * Display geometry sourced from crosspoint-reader:
 *   GfxRenderer.h  → VIEWABLE_MARGIN_{TOP,RIGHT,BOTTOM,LEFT}
 *   CrossPointSettings.h → screenMargin default = 5
 *
 * advanceY (line height, px) sourced from the EpdFontData struct
 * initializers in each builtinFonts/*_regular.h header.
 *
 * Character widths are measured at runtime from the actual TTF/OTF
 * source files via opentype.js, keeping the converter in sync with
 * whatever the firmware actually renders.
 */

const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');

// ── Display geometry ──────────────────────────────────────────────────────────

const DISPLAY_WIDTH  = 480;
const DISPLAY_HEIGHT = 800;

// Hardware viewable margins (from GfxRenderer.h)
const HW_MARGIN_TOP    = 9;
const HW_MARGIN_RIGHT  = 3;
const HW_MARGIN_BOTTOM = 3;
const HW_MARGIN_LEFT   = 3;

// Default user screen margin (from CrossPointSettings.h)
const SCREEN_MARGIN = 5;

// Status-bar allowance at bottom (approximate)
const STATUS_BAR_HEIGHT = 20;

const MARGIN_LEFT   = HW_MARGIN_LEFT   + SCREEN_MARGIN;          // 8
const MARGIN_RIGHT  = HW_MARGIN_RIGHT  + SCREEN_MARGIN;          // 8
const MARGIN_TOP    = HW_MARGIN_TOP    + SCREEN_MARGIN;          // 14
const MARGIN_BOTTOM = HW_MARGIN_BOTTOM + SCREEN_MARGIN + STATUS_BAR_HEIGHT; // 28

const TEXT_AREA_WIDTH  = DISPLAY_WIDTH  - MARGIN_LEFT - MARGIN_RIGHT;  // 464
const TEXT_AREA_HEIGHT = DISPLAY_HEIGHT - MARGIN_TOP  - MARGIN_BOTTOM; // 758

// ── Font line heights (advanceY from *_regular.h headers) ────────────────────

const ADVANCE_Y = {
  bookerly: { 12: 33, 14: 38, 16: 44, 18: 49 },
  notosans: { 12: 34, 14: 40, 16: 45, 18: 51 },
  dyslexic: { 10: 38, 12: 46, 14: 53, 16: 60 },
};

// ── Variant definitions ───────────────────────────────────────────────────────

function resolveFontSourceDir() {
  const candidates = [
    // Current repo layout.
    path.resolve(__dirname, '../../../../firmware/lib/EpdFont/builtinFonts/source'),
    // Legacy multi-repo layout (shelf next to crosspoint-reader).
    path.resolve(__dirname, '../../../../crosspoint-reader/lib/EpdFont/builtinFonts/source'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Unable to locate builtin font sources. Tried:\n${candidates.join('\n')}`
  );
}

const FONT_SOURCE_DIR = resolveFontSourceDir();

const FONT_FILES = {
  bookerly: path.join(FONT_SOURCE_DIR, 'Bookerly', 'Bookerly-Regular.ttf'),
  notosans: path.join(FONT_SOURCE_DIR, 'NotoSans',  'NotoSans-Regular.ttf'),
  dyslexic: path.join(FONT_SOURCE_DIR, 'OpenDyslexic', 'OpenDyslexic-Regular.otf'),
};

const VARIANTS = [
  { font: 'bookerly', sizes: [12, 14, 16, 18] },
  { font: 'notosans', sizes: [12, 14, 16, 18] },
  { font: 'dyslexic', sizes: [10, 12, 14, 16] },
];

// ── opentype.js font cache ────────────────────────────────────────────────────

const _fontCache = {};

function loadFont(fontName) {
  if (!_fontCache[fontName]) {
    _fontCache[fontName] = opentype.loadSync(FONT_FILES[fontName]);
  }
  return _fontCache[fontName];
}

/**
 * Measure the advance width of a single character in pixels.
 * Uses the same fixed-point snap approach as the firmware (round-to-nearest).
 */
function charWidth(fontName, fontSize, char) {
  const font = loadFont(fontName);
  const glyph = font.charToGlyph(char);
  // Convert font units → pixels
  return Math.round((glyph.advanceWidth / font.unitsPerEm) * fontSize);
}

/**
 * Return the number of lines that fit per page for a given variant.
 */
function linesPerPage(fontName, fontSize) {
  const lineH = ADVANCE_Y[fontName]?.[fontSize];
  if (!lineH) throw new Error(`Unknown variant ${fontName} ${fontSize}`);
  return Math.floor(TEXT_AREA_HEIGHT / lineH);
}

module.exports = {
  VARIANTS,
  TEXT_AREA_WIDTH,
  TEXT_AREA_HEIGHT,
  ADVANCE_Y,
  charWidth,
  linesPerPage,
  loadFont,
};
