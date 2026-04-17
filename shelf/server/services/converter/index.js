/**
 * Conversion pipeline: plain text → 12 paginated .txt variants + .idx files.
 *
 * Each variant wraps text to the X4 display width for its font/size,
 * then paginates by line count. Output:
 *   {outDir}/{font}_{size}.txt   — page-delimited text (PAGE marker on own line)
 *   {outDir}/{font}_{size}.idx   — flat uint32 array of char offsets per page
 *   {outDir}/meta.json           — title, author, total_chars
 */

const fs = require('fs');
const path = require('path');
const { VARIANTS, TEXT_AREA_WIDTH, charWidth, linesPerPage } = require('./fontMetrics');

/**
 * @param {string} text        Extracted plain text from EPUB
 * @param {string} outDir      Directory to write output files into
 * @param {{ title, author }}  Book metadata
 * @returns {number} totalChars — character count of the source text
 */
function convertBook(text, outDir, { title, author }) {
  fs.mkdirSync(outDir, { recursive: true });

  const totalChars = text.length;

  for (const { font, sizes } of VARIANTS) {
    for (const size of sizes) {
      const { txtLines, pageOffsets } = paginate(text, font, size);
      writeTxt(path.join(outDir, `${font}_${size}.txt`), txtLines);
      writeIdx(path.join(outDir, `${font}_${size}.idx`), pageOffsets);
    }
  }

  fs.writeFileSync(
    path.join(outDir, 'meta.json'),
    JSON.stringify({ title, author, total_chars: totalChars }, null, 2)
  );

  return totalChars;
}

/**
 * Wrap and paginate text for a single font/size variant.
 *
 * Returns:
 *   txtLines    — array of strings (line text or 'PAGE')
 *   pageOffsets — uint32 array of source char offsets, one per page
 */
function paginate(text, font, size) {
  const maxWidth  = TEXT_AREA_WIDTH;
  const maxLines  = linesPerPage(font, size);

  const txtLines   = [];
  const pageOffsets = [];

  // Wrap text into display-width lines, tracking source char offset
  const wrappedLines = wrapText(text, font, size, maxWidth);

  let lineBuffer = [];

  function flushPage(pageStartOffset) {
    pageOffsets.push(pageStartOffset);
    txtLines.push('PAGE');
    for (const l of lineBuffer) txtLines.push(l.text);
    lineBuffer = [];
  }

  let pendingPageOffset = 0; // char offset of the first char on the next page

  for (const line of wrappedLines) {
    if (lineBuffer.length === 0) {
      // Starting a new page — record the source offset
      pendingPageOffset = line.offset;
    }
    lineBuffer.push(line);

    if (lineBuffer.length >= maxLines) {
      flushPage(pendingPageOffset);
    }
  }

  // Flush any remaining lines as the last page
  if (lineBuffer.length > 0) {
    flushPage(pendingPageOffset);
  }

  return { txtLines, pageOffsets };
}

/**
 * Wrap plain text into display-width lines.
 * Each returned line carries { text, offset } where offset is the
 * index into the original text string of the first character on that line.
 */
function wrapText(text, font, size, maxWidth) {
  const lines = [];

  // Walk paragraph by paragraph (split on blank lines)
  const paragraphs = text.split(/\n{2,}/);
  let globalOffset = 0;

  for (const para of paragraphs) {
    if (!para.trim()) {
      globalOffset += para.length + 2; // account for the \n\n separator
      continue;
    }

    // Flatten the paragraph into a single line of words
    const words = para.replace(/\s+/g, ' ').trim().split(' ');
    let lineText = '';
    let lineWidth = 0;
    let lineOffset = globalOffset;

    for (const word of words) {
      const wordWidth = measureWord(font, size, word);
      const spaceWidth = lineText ? charWidth(font, size, ' ') : 0;

      if (lineText && lineWidth + spaceWidth + wordWidth > maxWidth) {
        // Emit current line, start new one
        lines.push({ text: lineText, offset: lineOffset });
        lineOffset = globalOffset + para.indexOf(word, lineText.length);
        lineText   = word;
        lineWidth  = wordWidth;
      } else {
        lineText  = lineText ? `${lineText} ${word}` : word;
        lineWidth += spaceWidth + wordWidth;
      }
    }

    if (lineText) lines.push({ text: lineText, offset: lineOffset });

    // Blank line between paragraphs (visual breathing room)
    lines.push({ text: '', offset: globalOffset + para.length });

    globalOffset += para.length + 2;
  }

  return lines;
}

function measureWord(font, size, word) {
  let w = 0;
  for (const ch of word) w += charWidth(font, size, ch);
  return w;
}

// ── File writers ──────────────────────────────────────────────────────────────

function writeTxt(filePath, lines) {
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function writeIdx(filePath, offsets) {
  const buf = Buffer.alloc(offsets.length * 4);
  for (let i = 0; i < offsets.length; i++) {
    buf.writeUInt32LE(offsets[i], i * 4);
  }
  fs.writeFileSync(filePath, buf);
}

module.exports = { convertBook };
