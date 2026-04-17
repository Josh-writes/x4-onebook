import { useState, useRef, useEffect } from 'react';
import { api } from '../../api.js';
import MiniBookCard from './MiniBookCard.jsx';

export default function ShelvesView({ shelves, unshelved, onRefresh, onSend, onReturn, onDelete }) {
  const [dragBookId,    setDragBookId]    = useState(null);
  const [dragOverShelf, setDragOverShelf] = useState(null);
  const [creating,      setCreating]      = useState(false);
  const [newName,       setNewName]       = useState('');
  const newInputRef = useRef(null);

  // Single state object so moves are atomic
  const [local, setLocal] = useState({ shelves, unshelved });

  // Keep local state in sync when server data changes
  useEffect(() => { setLocal({ shelves, unshelved }); }, [shelves, unshelved]);

  // ── Drag source ───────────────────────────────────────────────────────────

  function onDragStart(bookId) {
    setDragBookId(bookId);
  }

  function onDragEnd() {
    setDragBookId(null);
    setDragOverShelf(null);
  }

  // ── Optimistic move helpers ───────────────────────────────────────────────

  function moveBookToShelf(bookId, targetShelfId) {
    setLocal(prev => {
      const book =
        prev.unshelved.find(b => b.id === bookId) ||
        prev.shelves.flatMap(s => s.books).find(b => b.id === bookId);
      if (!book) return prev;
      return {
        unshelved: prev.unshelved.filter(b => b.id !== bookId),
        shelves: prev.shelves.map(s => ({
          ...s,
          books: s.id === targetShelfId
            ? [...s.books.filter(b => b.id !== bookId), book]
            : s.books.filter(b => b.id !== bookId),
        })),
      };
    });
  }

  function moveBookToUnshelved(bookId, sourceShelfId) {
    setLocal(prev => {
      const sourceShelf = prev.shelves.find(s => s.id === sourceShelfId);
      const book = sourceShelf?.books.find(b => b.id === bookId);
      if (!book) return prev;
      return {
        unshelved: [...prev.unshelved, book],
        shelves: prev.shelves.map(s =>
          s.id === sourceShelfId
            ? { ...s, books: s.books.filter(b => b.id !== bookId) }
            : s
        ),
      };
    });
  }

  // ── Move to shelf (used by drag-drop and context menu) ───────────────────

  async function handleMoveToShelf(bookId, targetShelfId) {
    // Find source shelf before the optimistic update wipes it
    const sourceShelf = local.shelves.find(s => s.books.some(b => b.id === bookId));
    moveBookToShelf(bookId, targetShelfId);
    await api.addToShelf(targetShelfId, bookId);
    if (sourceShelf && sourceShelf.id !== targetShelfId) {
      await api.removeFromShelf(sourceShelf.id, bookId);
    }
    onRefresh();
  }

  // ── Drop target ───────────────────────────────────────────────────────────

  async function onDropShelf(shelfId) {
    setDragOverShelf(null);
    if (!dragBookId) return;
    await handleMoveToShelf(dragBookId, shelfId);
  }

  async function onDropUnshelve(shelfId) {
    setDragOverShelf(null);
    if (!dragBookId) return;
    moveBookToUnshelved(dragBookId, shelfId);
    await api.removeFromShelf(shelfId, dragBookId);
    onRefresh();
  }

  // ── Create shelf ──────────────────────────────────────────────────────────

  function startCreate() {
    setCreating(true);
    setNewName('');
    setTimeout(() => newInputRef.current?.focus(), 50);
  }

  async function commitCreate() {
    const name = newName.trim();
    if (name) { await api.createShelf(name); onRefresh(); }
    setCreating(false);
  }

  // ── Delete shelf ──────────────────────────────────────────────────────────

  async function handleDelete(shelf) {
    if (!confirm(`Delete shelf "${shelf.name}"? Books won't be removed.`)) return;
    await api.deleteShelf(shelf.id);
    onRefresh();
  }

  return (
    <div className="flex flex-col">
      {/* User shelves */}
      {local.shelves.map(shelf => (
        <ShelfRow
          key={shelf.id}
          shelf={shelf}
          isDragOver={dragOverShelf === shelf.id}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={() => setDragOverShelf(shelf.id)}
          onDragLeave={() => setDragOverShelf(null)}
          onDrop={() => onDropShelf(shelf.id)}
          onDropUnshelve={() => onDropUnshelve(shelf.id)}
          onDelete={() => handleDelete(shelf)}
          onRefresh={onRefresh}
          onOptimisticRemove={bookId => moveBookToUnshelved(bookId, shelf.id)}
          onMoveToShelf={handleMoveToShelf}
          onSend={onSend}
          onReturn={onReturn}
          onDelete2={onDelete}
        />
      ))}

      {/* New shelf row */}
      {creating ? (
        <div className="px-6 py-3 border-b border-shelf-border flex items-center gap-2">
          <input
            ref={newInputRef}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitCreate(); if (e.key === 'Escape') setCreating(false); }}
            onBlur={commitCreate}
            placeholder="Shelf name…"
            className="bg-shelf-bg border border-shelf-accent rounded px-3 py-1 text-sm text-shelf-text focus:outline-none w-48"
          />
        </div>
      ) : (
        <button
          onClick={startCreate}
          className="mx-6 my-3 self-start text-shelf-muted text-sm hover:text-shelf-accent transition-colors"
        >
          + New Shelf
        </button>
      )}

      {/* Unshelved books — always at the bottom */}
      {local.unshelved.length > 0 && (
        <UnshelvedRow
          books={local.unshelved}
          isDragOver={dragOverShelf === '__unshelved__'}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={() => setDragOverShelf('__unshelved__')}
          onDragLeave={() => setDragOverShelf(null)}
          onMoveToShelf={handleMoveToShelf}
          onSend={onSend}
          onReturn={onReturn}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

// ── Individual shelf row ──────────────────────────────────────────────────────

function ShelfRow({ shelf, isDragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onDropUnshelve, onDelete, onRefresh, onOptimisticRemove, onMoveToShelf, onSend, onReturn, onDelete2 }) {
  const [editing, setEditing] = useState(false);
  const [name,    setName]    = useState(shelf.name);
  const inputRef = useRef(null);

  function startEdit() { setEditing(true); setName(shelf.name); setTimeout(() => inputRef.current?.select(), 50); }

  async function commitRename() {
    setEditing(false);
    if (name.trim() && name.trim() !== shelf.name) {
      await api.renameShelf(shelf.id, name.trim());
      onRefresh();
    }
  }

  return (
    <div className="border-b border-shelf-border">
      {/* Shelf label row */}
      <div className="flex items-center gap-3 px-6 pt-4 pb-1 group">
        {editing ? (
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false); }}
            onBlur={commitRename}
            className="bg-shelf-bg border border-shelf-accent rounded px-2 py-0.5 text-sm text-shelf-text focus:outline-none"
          />
        ) : (
          <h2
            className="text-shelf-text font-medium text-sm cursor-pointer hover:text-shelf-accent transition-colors"
            onDoubleClick={startEdit}
            title="Double-click to rename"
          >
            {shelf.name}
          </h2>
        )}
        <span className="text-shelf-muted text-xs">{shelf.books.length}</span>
        <div className="flex-1" />
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-shelf-muted hover:text-red-400 text-xs transition-all"
          title="Delete shelf"
        >
          ✕
        </button>
      </div>

      {/* The actual shelf plank — books sit on it */}
      <div
        className={`relative px-6 pb-0 overflow-x-auto transition-colors ${isDragOver ? 'bg-shelf-accent/10' : ''}`}
        onDragOver={e => { e.preventDefault(); onDragOver(); }}
        onDragLeave={onDragLeave}
        onDrop={e => { e.preventDefault(); onDrop(); }}
      >
        <div className="flex gap-3 py-3 min-h-[148px] items-end">
          {shelf.books.length === 0 ? (
            <p className="text-shelf-muted text-xs self-center italic">
              {isDragOver ? 'Drop here' : 'Drag books here'}
            </p>
          ) : (
            shelf.books.map(book => (
              <MiniBookCard
                key={book.id}
                book={book}
                shelfId={shelf.id}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onRemoveFromShelf={async () => { onOptimisticRemove(book.id); await api.removeFromShelf(shelf.id, book.id); onRefresh(); }}
                onMoveToShelf={onMoveToShelf}
                onSend={onSend}
                onReturn={onReturn}
                onDelete={onDelete2}
              />
            ))
          )}
        </div>
        {/* Shelf plank */}
        <div className="h-1.5 bg-shelf-border/60 rounded-sm mx-0 -mt-1" />
      </div>
    </div>
  );
}

// ── Unshelved row ────────────────────────────────────────────────────────────

function UnshelvedRow({ books, isDragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onMoveToShelf, onSend, onReturn, onDelete }) {
  return (
    <div className="border-b border-shelf-border">
      <div className="flex items-center gap-3 px-6 pt-4 pb-1">
        <h2 className="text-shelf-muted font-medium text-sm">Unshelved</h2>
        <span className="text-shelf-muted text-xs">{books.length}</span>
      </div>
      <div
        className={`px-6 pb-0 overflow-x-auto transition-colors ${isDragOver ? 'bg-shelf-accent/10' : ''}`}
        onDragOver={e => { e.preventDefault(); onDragOver(); }}
        onDragLeave={onDragLeave}
      >
        <div className="flex gap-3 py-3 min-h-[148px] items-end flex-wrap">
          {books.map(book => (
            <MiniBookCard
              key={book.id}
              book={book}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onMoveToShelf={onMoveToShelf}
              onSend={onSend}
              onReturn={onReturn}
              onDelete={onDelete}
            />
          ))}
        </div>
        <div className="h-1.5 bg-shelf-border/60 rounded-sm -mt-1" />
      </div>
    </div>
  );
}
