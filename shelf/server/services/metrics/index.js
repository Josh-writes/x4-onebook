const { v4: uuidv4 } = require('uuid');
const queries = require('../../db/queries');

const AVG_WORD_LENGTH = 5; // characters per word (English average)

/**
 * Called on every WiFi sync. Updates progress and manages reading sessions.
 *
 * @param {string} bookId
 * @param {number} charOffset   Canonical char offset (converted from page via .idx)
 */
function recordSync(bookId, charOffset) {
  const now = Date.now();
  const openSession = queries.getOpenSession(bookId);

  if (openSession) {
    const lastActivity = new Date(openSession.ended_at || openSession.started_at).getTime();
    const gapMs = now - lastActivity;

    if (gapMs > queries.SESSION_GAP_MS) {
      // Gap too large — close old session, start a new one
      const wpm = calcWpm(openSession.start_char, openSession.end_char ?? charOffset, openSession.started_at);
      queries.closeSessionWithWpm(openSession.id, openSession.end_char ?? charOffset, wpm);
      queries.createSession({ id: uuidv4(), bookId, startChar: charOffset });
    } else {
      // Extend current session
      queries.extendSession(openSession.id, charOffset);
    }
  } else {
    // No open session — start one
    queries.createSession({ id: uuidv4(), bookId, startChar: charOffset });
  }

  queries.updateProgress(bookId, charOffset);
}

/**
 * Compute WPM for a session segment.
 */
function calcWpm(startChar, endChar, startedAt) {
  if (!endChar || endChar <= startChar) return null;
  const chars = endChar - startChar;
  const words = chars / AVG_WORD_LENGTH;
  const minutes = (Date.now() - new Date(startedAt).getTime()) / 60000;
  if (minutes < 0.1) return null;
  return Math.round(words / minutes);
}

/**
 * Estimate time remaining in minutes given current progress.
 */
function estimateTimeRemaining(totalChars, currentChar, avgWpm) {
  if (!avgWpm || avgWpm <= 0) return null;
  const charsLeft = totalChars - currentChar;
  const wordsLeft = charsLeft / AVG_WORD_LENGTH;
  return Math.round(wordsLeft / avgWpm);
}

/**
 * Compute average WPM across all completed sessions for a book.
 */
function avgWpmForBook(bookId) {
  const sessions = queries.getSessionsForBook(bookId);
  const valid = sessions.filter(s => s.wpm && s.wpm > 0);
  if (!valid.length) return null;
  return Math.round(valid.reduce((sum, s) => sum + s.wpm, 0) / valid.length);
}

/**
 * Compute current reading streak (consecutive days with at least one sync).
 */
function readingStreak() {
  const sessions = queries.getRecentSessions(365);
  if (!sessions.length) return 0;

  const days = new Set(
    sessions.map(s => s.started_at.slice(0, 10))
  );

  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

/**
 * Convert a page number + font/size to a canonical char offset by reading
 * the .idx file for that variant.
 *
 * @param {string} convertedDir  Path to the book's converted/ directory
 * @param {string} font
 * @param {number} size
 * @param {number} page          0-based page index
 * @returns {number} charOffset
 */
function pageToCharOffset(convertedDir, font, size, page) {
  const fs = require('fs');
  const path = require('path');
  const idxPath = path.join(convertedDir, `${font}_${size}.idx`);
  const buf = fs.readFileSync(idxPath);
  const pageCount = buf.length / 4;
  const clampedPage = Math.max(0, Math.min(page, pageCount - 1));
  return buf.readUInt32LE(clampedPage * 4);
}

module.exports = {
  recordSync,
  calcWpm,
  estimateTimeRemaining,
  avgWpmForBook,
  readingStreak,
  pageToCharOffset,
};
