import { useRef, useState, useEffect, useCallback } from 'react';
import { api } from '../../api.js';
import BookCard    from '../../components/BookCard.jsx';
import ShelvesView from './ShelvesView.jsx';

export default function ShelfView({ books, onImport, onSend, onReturn, onDelete }) {
  const fileRef = useRef(null);
  const [importing,  setImporting]  = useState(false);
  const [libStatus,  setLibStatus]  = useState(null);
  const [error,      setError]      = useState(null);
  const [mode,       setMode]       = useState('grid'); // 'grid' | 'shelves'
  const [shelves,    setShelves]    = useState([]);
  const [unshelved,  setUnshelved]  = useState([]);

  const refreshShelves = useCallback(async () => {
    const data = await api.getShelves().catch(() => ({ shelves: [], unshelved: [] }));
    setShelves(data.shelves ?? []);
    setUnshelved(data.unshelved ?? []);
  }, []);

  // Load shelves when switching to shelves mode
  useEffect(() => {
    if (mode === 'shelves') refreshShelves();
  }, [mode, refreshShelves]);

  // Keep shelves in sync when books change (e.g. after import / delete)
  useEffect(() => {
    if (mode === 'shelves') refreshShelves();
  }, [books, mode, refreshShelves]);

  async function handleFile(file) {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(file);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  function handleFilePick(e) {
    handleFile(e.target.files[0]);
    e.target.value = '';
  }

  async function handleDrop(e) {
    e.preventDefault();
    const file = [...e.dataTransfer.files].find(f => f.name.endsWith('.epub'));
    handleFile(file);
  }

  async function handleImportLibrary() {
    setImporting(true);
    setError(null);
    setLibStatus(null);
    try {
      const { toImport, skipped } = await api.libraryScan();

      if (toImport.length === 0) {
        setLibStatus({ imported: 0, failed: 0, total: 0, skipped, done: true });
        return;
      }

      setLibStatus({ imported: 0, failed: 0, total: toImport.length, skipped, done: false });

      let imported = 0, failed = 0;
      for (const epubPath of toImport) {
        try {
          await api.importOne(epubPath);
          imported++;
        } catch {
          failed++;
        }
        setLibStatus({ imported, failed, total: toImport.length, skipped, done: false });
        if ((imported + failed) % 5 === 0) onImport(null);
      }

      setLibStatus({ imported, failed, total: toImport.length, skipped, done: true });
      onImport(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="flex flex-col min-h-full"
      onDragOver={e => { if (mode === 'grid') e.preventDefault(); }}
      onDrop={e => { if (mode === 'grid') handleDrop(e); }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-shelf-border">
        <div className="flex items-center gap-3">
          <h1 className="text-shelf-text font-semibold text-lg">My Shelf</h1>
          {/* Grid / Shelves toggle */}
          <div className="flex rounded-md border border-shelf-border overflow-hidden text-xs">
            <button
              onClick={() => setMode('grid')}
              className={`px-3 py-1 transition-colors ${mode === 'grid' ? 'bg-shelf-accent text-shelf-bg font-medium' : 'text-shelf-muted hover:text-shelf-text'}`}
            >
              Grid
            </button>
            <button
              onClick={() => setMode('shelves')}
              className={`px-3 py-1 transition-colors ${mode === 'shelves' ? 'bg-shelf-accent text-shelf-bg font-medium' : 'text-shelf-muted hover:text-shelf-text'}`}
            >
              Shelves
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {libStatus && !libStatus.done && (
            <span className="text-shelf-muted text-sm">
              Importing {libStatus.imported}/{libStatus.total}…
            </span>
          )}
          {libStatus?.done && (
            <span className="text-shelf-muted text-sm">
              Imported {libStatus.imported}
              {libStatus.skipped ? `, skipped ${libStatus.skipped}` : ''}
              {libStatus.failed  ? `, failed ${libStatus.failed}` : ''}
            </span>
          )}
          {error && <span className="text-red-400 text-sm">{error}</span>}

          <button
            onClick={handleImportLibrary}
            disabled={importing}
            className="btn-ghost text-sm disabled:opacity-50"
          >
            Import Library
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {importing && !libStatus ? 'Adding…' : '+ Add Book'}
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".epub"
          className="hidden"
          onChange={handleFilePick}
        />
      </div>

      {/* Content */}
      {mode === 'grid' ? (
        <div className="p-6">
          {books.length === 0 ? (
            <EmptyState onAdd={() => fileRef.current?.click()} />
          ) : (
            <div className="flex flex-wrap gap-5">
              {books.map(book => (
                <BookCard
                  key={book.id}
                  book={book}
                  onSend={onSend}
                  onReturn={onReturn}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <ShelvesView
          shelves={shelves}
          unshelved={unshelved}
          onRefresh={refreshShelves}
          onSend={onSend}
          onReturn={onReturn}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center h-72 gap-4 text-shelf-muted">
      <p className="text-4xl">📚</p>
      <p className="text-sm">Your shelf is empty.</p>
      <p className="text-xs">Drop an EPUB here or click below to add your first book.</p>
      <button onClick={onAdd} className="btn-primary text-sm">
        Add Book
      </button>
    </div>
  );
}
