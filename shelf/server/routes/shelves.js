const express = require('express');
const { v4: uuidv4 } = require('uuid');
const queries = require('../db/queries');

const router = express.Router();

// GET /api/shelves — all shelves with their books
router.get('/', (req, res) => {
  const shelves = queries.listShelves().map(s => ({
    ...s,
    books: queries.getShelfBooks(s.id),
  }));
  const unshelved = queries.getUnshelvedBooks();
  res.json({ shelves, unshelved });
});

// POST /api/shelves — create shelf
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const existing = queries.listShelves();
  const id = uuidv4();
  queries.createShelf({ id, name: name.trim(), position: existing.length });
  res.status(201).json({ id, name: name.trim(), position: existing.length });
});

// PATCH /api/shelves/:id — rename
router.patch('/:id', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  queries.renameShelf(req.params.id, name.trim());
  res.json({ ok: true });
});

// DELETE /api/shelves/:id — delete (books stay, just removed from shelf)
router.delete('/:id', (req, res) => {
  queries.deleteShelf(req.params.id);
  res.json({ ok: true });
});

// PUT /api/shelves/order — reorder shelves
router.put('/order', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  queries.reorderShelves(ids);
  res.json({ ok: true });
});

// POST /api/shelves/:id/books/:bookId — add book to shelf
router.post('/:id/books/:bookId', (req, res) => {
  queries.addToShelf(req.params.id, req.params.bookId);
  res.json({ ok: true });
});

// DELETE /api/shelves/:id/books/:bookId — remove book from shelf
router.delete('/:id/books/:bookId', (req, res) => {
  queries.removeFromShelf(req.params.id, req.params.bookId);
  res.json({ ok: true });
});

module.exports = router;
