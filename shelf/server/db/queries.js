const { getDb } = require('./schema');

// ── Books ────────────────────────────────────────────────────────────────────

function listBooks() {
  return getDb().prepare(`
    SELECT b.*, rp.char_offset, rp.last_synced_at, rp.on_device, rp.pending_send, rp.pending_return
    FROM books b
    LEFT JOIN reading_progress rp ON rp.book_id = b.id
    ORDER BY b.added_at DESC
  `).all();
}

function getBook(id) {
  return getDb().prepare(`
    SELECT b.*, rp.char_offset, rp.last_synced_at, rp.on_device, rp.pending_send, rp.pending_return
    FROM books b
    LEFT JOIN reading_progress rp ON rp.book_id = b.id
    WHERE b.id = ?
  `).get(id);
}

function insertBook({ id, title, author, epubPath, coverPath, totalChars }) {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO books (id, title, author, epub_path, cover_path, total_chars, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, author, epubPath, coverPath, totalChars, now);

  getDb().prepare(`
    INSERT INTO reading_progress (book_id, char_offset, on_device)
    VALUES (?, 0, 0)
  `).run(id);
}

function deleteBook(id) {
  getDb().prepare('DELETE FROM books WHERE id = ?').run(id);
}

// ── Progress ─────────────────────────────────────────────────────────────────

function getProgress(bookId) {
  return getDb().prepare(
    'SELECT * FROM reading_progress WHERE book_id = ?'
  ).get(bookId);
}

function setOnDevice(bookId, onDevice) {
  getDb().prepare(`
    UPDATE reading_progress SET on_device = ? WHERE book_id = ?
  `).run(onDevice ? 1 : 0, bookId);
}

function updateProgress(bookId, charOffset) {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE reading_progress
    SET char_offset = ?, last_synced_at = ?
    WHERE book_id = ?
  `).run(charOffset, now, bookId);
}

function getOnDeviceBook() {
  return getDb().prepare(`
    SELECT b.*, rp.char_offset, rp.last_synced_at, rp.on_device, rp.pending_send, rp.pending_return
    FROM books b
    JOIN reading_progress rp ON rp.book_id = b.id
    WHERE rp.on_device = 1
    LIMIT 1
  `).get();
}

// Book the user has queued to send — converted and ready, waiting for device to pull it
function getPendingSendBook() {
  return getDb().prepare(`
    SELECT b.*, rp.char_offset, rp.last_synced_at, rp.on_device, rp.pending_send, rp.pending_return
    FROM books b
    JOIN reading_progress rp ON rp.book_id = b.id
    WHERE rp.pending_send = 1
    LIMIT 1
  `).get();
}

function setPendingSend(bookId, value) {
  getDb().prepare('UPDATE reading_progress SET pending_send = ? WHERE book_id = ?')
    .run(value ? 1 : 0, bookId);
}

function setPendingReturn(bookId, value) {
  getDb().prepare('UPDATE reading_progress SET pending_return = ? WHERE book_id = ?')
    .run(value ? 1 : 0, bookId);
}

// ── Sessions ─────────────────────────────────────────────────────────────────

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

function getOpenSession(bookId) {
  return getDb().prepare(`
    SELECT * FROM reading_sessions
    WHERE book_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `).get(bookId);
}

function createSession({ id, bookId, startChar }) {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO reading_sessions (id, book_id, started_at, start_char)
    VALUES (?, ?, ?, ?)
  `).run(id, bookId, now, startChar);
}

function extendSession(sessionId, endChar) {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE reading_sessions SET ended_at = ?, end_char = ? WHERE id = ?
  `).run(now, endChar, sessionId);
}

function closeSessionWithWpm(sessionId, endChar, wpm) {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE reading_sessions
    SET ended_at = ?, end_char = ?, wpm = ?
    WHERE id = ?
  `).run(now, endChar, wpm, sessionId);
}

function getSessionsForBook(bookId) {
  return getDb().prepare(`
    SELECT * FROM reading_sessions
    WHERE book_id = ? AND ended_at IS NOT NULL
    ORDER BY started_at DESC
  `).all(bookId);
}

function getRecentSessions(limit = 20) {
  return getDb().prepare(`
    SELECT s.*, b.title, b.author
    FROM reading_sessions s
    JOIN books b ON b.id = s.book_id
    WHERE s.ended_at IS NOT NULL
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(limit);
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────

function getBookmarks(bookId) {
  return getDb().prepare(`
    SELECT * FROM bookmarks WHERE book_id = ? ORDER BY char_offset ASC
  `).all(bookId);
}

function insertBookmark({ id, bookId, charOffset, label }) {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO bookmarks (id, book_id, char_offset, label, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, bookId, charOffset, label || null, now);
}

function deleteBookmark(id) {
  getDb().prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
}

// ── Shelves ───────────────────────────────────────────────────────────────────

function listShelves() {
  return getDb().prepare('SELECT * FROM shelves ORDER BY position ASC, name ASC').all();
}

function createShelf({ id, name, position }) {
  getDb().prepare('INSERT INTO shelves (id, name, position) VALUES (?, ?, ?)').run(id, name, position ?? 0);
}

function renameShelf(id, name) {
  getDb().prepare('UPDATE shelves SET name = ? WHERE id = ?').run(name, id);
}

function deleteShelf(id) {
  getDb().prepare('DELETE FROM shelves WHERE id = ?').run(id);
}

function reorderShelves(orderedIds) {
  const stmt = getDb().prepare('UPDATE shelves SET position = ? WHERE id = ?');
  orderedIds.forEach((id, i) => stmt.run(i, id));
}

function getShelfBooks(shelfId) {
  return getDb().prepare(`
    SELECT b.*, rp.char_offset, rp.last_synced_at, rp.on_device, sb.position as shelf_position
    FROM books b
    JOIN shelf_books sb ON sb.book_id = b.id
    LEFT JOIN reading_progress rp ON rp.book_id = b.id
    WHERE sb.shelf_id = ?
    ORDER BY sb.position ASC
  `).all(shelfId);
}

function addToShelf(shelfId, bookId) {
  const maxPos = getDb().prepare('SELECT MAX(position) as m FROM shelf_books WHERE shelf_id = ?').get(shelfId)?.m ?? -1;
  getDb().prepare('INSERT OR IGNORE INTO shelf_books (shelf_id, book_id, position) VALUES (?, ?, ?)').run(shelfId, bookId, maxPos + 1);
}

function removeFromShelf(shelfId, bookId) {
  getDb().prepare('DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?').run(shelfId, bookId);
}

function getBookShelves(bookId) {
  return getDb().prepare('SELECT shelf_id FROM shelf_books WHERE book_id = ?').all(bookId).map(r => r.shelf_id);
}

function getUnshelvedBooks() {
  return getDb().prepare(`
    SELECT b.*, rp.char_offset, rp.last_synced_at, rp.on_device
    FROM books b
    LEFT JOIN reading_progress rp ON rp.book_id = b.id
    WHERE b.id NOT IN (SELECT DISTINCT book_id FROM shelf_books)
    ORDER BY b.added_at DESC
  `).all();
}

// ── Settings ──────────────────────────────────────────────────────────────────

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  getDb().prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

/** Returns the configured library paths as a string array. */
function getLibraryPaths() {
  const raw = getSetting('libraryPaths');
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

/** Replaces the full library paths array. Strips accidental surrounding quotes. */
function setLibraryPaths(paths) {
  const clean = paths.map(p => p.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
  setSetting('libraryPaths', JSON.stringify(clean));
}

/** Returns a Set of all epub_path values currently in the DB — used for dedup. */
function getKnownEpubPaths() {
  const rows = getDb().prepare('SELECT epub_path FROM books').all();
  return new Set(rows.map(r => r.epub_path));
}

/** Returns existing book if one with this title+author already exists, else null. */
function findBookByTitleAuthor(title, author) {
  return getDb().prepare(`
    SELECT b.*, rp.char_offset, rp.last_synced_at, rp.on_device
    FROM books b
    LEFT JOIN reading_progress rp ON rp.book_id = b.id
    WHERE b.title = ? AND b.author = ?
  `).get(title, author) || null;
}

// ── WiFi Networks ───────────────────────────────────────────────────────────

function listWifiNetworks() {
  return getDb().prepare(`
    SELECT id, ssid, priority, created_at, synced
    FROM wifi_networks
    ORDER BY priority ASC, created_at ASC
  `).all();
}

function getWifiNetwork(id) {
  return getDb().prepare(`
    SELECT id, ssid, password, priority, created_at, synced
    FROM wifi_networks WHERE id = ?
  `).get(id);
}

function insertWifiNetwork({ id, ssid, password, priority }) {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO wifi_networks (id, ssid, password, priority, created_at, synced)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(id, ssid, password, priority ?? 0, now);
}

function updateWifiNetwork(id, { ssid, password, priority }) {
  getDb().prepare(`
    UPDATE wifi_networks SET ssid = ?, password = ?, priority = ? WHERE id = ?
  `).run(ssid, password, priority ?? 0, id);
}

function deleteWifiNetwork(id) {
  getDb().prepare('DELETE FROM wifi_networks WHERE id = ?').run(id);
}

function getWifiNetworksToSync() {
  return getDb().prepare(`
    SELECT id, ssid, password, priority
    FROM wifi_networks
    WHERE synced = 1
    ORDER BY priority ASC
  `).all();
}

function syncWifiNetwork(id) {
  getDb().prepare('UPDATE wifi_networks SET synced = 1 WHERE id = ?').run(id);
}

function unsyncWifiNetwork(id) {
  getDb().prepare('UPDATE wifi_networks SET synced = 0 WHERE id = ?').run(id);
}

module.exports = {
  listBooks, getBook, insertBook, deleteBook,
  getProgress, setOnDevice, updateProgress, getOnDeviceBook,
  getPendingSendBook, setPendingSend, setPendingReturn,
  getOpenSession, createSession, extendSession, closeSessionWithWpm,
  getSessionsForBook, getRecentSessions, SESSION_GAP_MS,
  getBookmarks, insertBookmark, deleteBookmark,
  getSetting, setSetting, getAllSettings,
  getLibraryPaths, setLibraryPaths, getKnownEpubPaths,
  listShelves, createShelf, renameShelf, deleteShelf, reorderShelves,
  getShelfBooks, addToShelf, removeFromShelf, getBookShelves, getUnshelvedBooks,
  findBookByTitleAuthor,
  // WiFi
  listWifiNetworks, getWifiNetwork, insertWifiNetwork, updateWifiNetwork, deleteWifiNetwork,
  getWifiNetworksToSync, syncWifiNetwork, unsyncWifiNetwork,
};
