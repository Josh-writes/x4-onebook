const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');

const queries  = require('../db/queries');
const { parseEpub } = require('../services/epub');
const { avgWpmForBook, estimateTimeRemaining } = require('../services/metrics');

const router = express.Router();

const DATA_DIR   = path.join(__dirname, '..', '..', 'data');
const COVERS_DIR = path.join(DATA_DIR, 'covers');
const CONV_DIR   = path.join(DATA_DIR, 'converted');
const STAGING_DIR = path.join(DATA_DIR, 'epubs');
fs.mkdirSync(STAGING_DIR, { recursive: true });

const DEFAULT_LIBRARY_DIR = path.join(__dirname, '..', '..', '..', 'library');

const upload = multer({
  dest: STAGING_DIR,
  fileFilter: (req, file, cb) => {
    cb(null, path.extname(file.originalname).toLowerCase() === '.epub');
  },
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ── GET /api/books ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json(queries.listBooks().map(enrichBook));
});

// ── GET /api/books/library-scan ───────────────────────────────────────────────
// Returns the list of EPUB paths in library folders that aren't yet imported.
// Fast — just a directory listing, no conversion.
router.get('/library-scan', (req, res) => {
  let libraryPaths = queries.getLibraryPaths();
  if (libraryPaths.length === 0) libraryPaths = [DEFAULT_LIBRARY_DIR];

  const seen = new Set();
  const found = [];
  for (const dir of libraryPaths) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.epub')) continue;
      const abs = path.resolve(dir, f);
      if (!seen.has(abs)) { seen.add(abs); found.push(abs); }
    }
  }

  const known     = queries.getKnownEpubPaths();
  const toImport  = found.filter(f => !known.has(f));
  const skipped   = found.length - toImport.length;

  console.log(`Library scan: ${found.length} EPUBs found, ${toImport.length} to import, ${skipped} already indexed`);

  res.json({ toImport, skipped, total: found.length });
});

// ── POST /api/books/import-one ────────────────────────────────────────────────
// Imports a single EPUB by its absolute server-side path.
// Called repeatedly by the client during a library import, one book at a time.
router.post('/import-one', async (req, res) => {
  const { epubPath } = req.body;
  if (!epubPath) return res.status(400).json({ error: 'epubPath required' });
  if (!fs.existsSync(epubPath)) return res.status(404).json({ error: 'File not found', epubPath });

  // Skip if already imported
  const known = queries.getKnownEpubPaths();
  if (known.has(epubPath)) return res.json({ skipped: true, epubPath });

  try {
    console.log(`Importing: ${path.basename(epubPath)}`);
    const { book, isNew } = await importEpubFromPath(epubPath);
    if (!isNew) {
      console.log(`  ~ skipped duplicate: ${book.title}`);
      return res.json({ skipped: true, epubPath });
    }
    console.log(`  ✓ ${book.title}`);
    res.json(enrichBook(book));
  } catch (err) {
    console.error(`  ✗ ${path.basename(epubPath)}:`, err.message);
    res.status(500).json({ error: err.message, epubPath });
  }
});

// ── POST /api/books  (multipart EPUB upload) ──────────────────────────────────
router.post('/', upload.single('epub'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No EPUB file provided' });
  const tmpPath  = req.file.path;
  const origName = req.file.originalname;
  try {
    const libraryPaths = queries.getLibraryPaths();
    const primaryLib   = libraryPaths[0] || null;

    let destPath;
    if (primaryLib) {
      fs.mkdirSync(primaryLib, { recursive: true });
      destPath = uniquePath(path.join(primaryLib, origName));
      fs.copyFileSync(tmpPath, destPath);
      fs.unlinkSync(tmpPath);
    } else {
      destPath = path.join(STAGING_DIR, `${uuidv4()}.epub`);
      fs.renameSync(tmpPath, destPath);
    }

    const { book, isNew } = await importEpubFromPath(destPath);
    if (!isNew) {
      // Duplicate — discard the file we just copied, return the existing record
      try { fs.unlinkSync(destPath); } catch {}
    }
    res.status(isNew ? 201 : 200).json(enrichBook(book));
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/books/:id ────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const book = queries.getBook(req.params.id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(enrichBook(book));
});

// ── DELETE /api/books/:id ─────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const book = queries.getBook(id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  if (book.on_device) return res.status(409).json({ error: 'Return book from device first' });

  [book.epub_path, book.cover_path]
    .filter(Boolean)
    .forEach(p => { try { fs.unlinkSync(p); } catch {} });

  const convDir = path.join(CONV_DIR, id);
  if (fs.existsSync(convDir)) fs.rmSync(convDir, { recursive: true });

  queries.deleteBook(id);
  res.json({ ok: true });
});

// ── GET /api/books/:id/sessions ───────────────────────────────────────────────
router.get('/:id/sessions', (req, res) => {
  res.json(queries.getSessionsForBook(req.params.id));
});

// ── GET /api/books/:id/bookmarks ──────────────────────────────────────────────
router.get('/:id/bookmarks', (req, res) => {
  res.json(queries.getBookmarks(req.params.id));
});

// ── POST /api/books/:id/bookmarks ────────────────────────────────────────────
router.post('/:id/bookmarks', (req, res) => {
  const { charOffset, label } = req.body;
  if (charOffset == null) return res.status(400).json({ error: 'charOffset required' });
  const bm = { id: uuidv4(), bookId: req.params.id, charOffset, label };
  queries.insertBookmark(bm);
  res.status(201).json(bm);
});

// ── DELETE /api/books/:id/bookmarks/:bmId ────────────────────────────────────
router.delete('/:id/bookmarks/:bmId', (req, res) => {
  queries.deleteBookmark(req.params.bmId);
  res.json({ ok: true });
});

// ── Shared import logic ───────────────────────────────────────────────────────

async function importEpubFromPath(epubPath) {
  const { title, author, text, coverData, coverExt } = parseEpub(epubPath);

  const existing = queries.findBookByTitleAuthor(title, author);
  if (existing) return { book: existing, isNew: false };

  const id = uuidv4();
  let coverPath = null;
  if (coverData) {
    coverPath = path.join(COVERS_DIR, `${id}.${coverExt}`);
    fs.writeFileSync(coverPath, coverData);
  }

  // No conversion yet — that happens lazily when the book is sent to the device.
  const totalChars = text.length;

  queries.insertBook({ id, title, author, epubPath, coverPath, totalChars });
  return { book: queries.getBook(id), isNew: true };
}

function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const ext  = path.extname(filePath);
  const stem = filePath.slice(0, -ext.length);
  let n = 2;
  while (fs.existsSync(`${stem} (${n})${ext}`)) n++;
  return `${stem} (${n})${ext}`;
}

// ── Enrichment ────────────────────────────────────────────────────────────────

function enrichBook(book) {
  const wpm = avgWpmForBook(book.id);
  const timeRemaining = estimateTimeRemaining(book.total_chars, book.char_offset ?? 0, wpm);
  const pct = book.total_chars > 0
    ? Math.round((book.char_offset ?? 0) / book.total_chars * 1000) / 10
    : 0;

  let coverUrl = null;
  if (book.cover_path) {
    coverUrl = `/covers/${book.id}${path.extname(book.cover_path)}`;
  }

  return {
    id:         book.id,
    title:      book.title,
    author:     book.author,
    totalChars: book.total_chars,
    addedAt:    book.added_at,
    coverUrl,
    pendingSend: !!book.pending_send,
    progress: {
      charOffset:   book.char_offset ?? 0,
      pct,
      lastSyncedAt: book.last_synced_at,
      onDevice:     !!book.on_device,
      wpm,
      timeRemaining,
    },
  };
}

module.exports = router;
