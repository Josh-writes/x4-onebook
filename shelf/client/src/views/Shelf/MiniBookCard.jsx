import { useState } from 'react';
import { useShelfContextMenu } from '../../components/ShelfContextMenu.jsx';

/**
 * Small draggable book card for shelf rows.
 * Width ~72px, aspect ratio 2:3 — books standing upright on a shelf.
 */
export default function MiniBookCard({ book, shelfId, onDragStart, onDragEnd, onRemoveFromShelf, onSend, onReturn, onDelete, onMoveToShelf }) {
  const [hovered, setHovered] = useState(false);
  const [working, setWorking] = useState(false);
  const { onContextMenu, contextMenuElement } = useShelfContextMenu(book.id, onMoveToShelf);

  const isOnDevice = !!book.on_device;
  // cover_path is a full OS path; derive the URL from the filename
  const coverFilename = book.cover_path?.split(/[\\/]/).pop();
  const coverUrl = coverFilename ? `/covers/${coverFilename}` : null;

  async function handleSend(e) {
    e.stopPropagation();
    setWorking(true);
    try { await onSend(book.id); } finally { setWorking(false); }
  }

  async function handleReturn(e) {
    e.stopPropagation();
    setWorking(true);
    try { await onReturn(); } finally { setWorking(false); }
  }

  async function handleRemove(e) {
    e.stopPropagation();
    if (!onRemoveFromShelf) return;
    setWorking(true);
    try { await onRemoveFromShelf(); } finally { setWorking(false); }
  }

  async function handleDelete(e) {
    e.stopPropagation();
    if (!confirm(`Remove "${book.title}" from your library?`)) return;
    setWorking(true);
    try { await onDelete(book.id); } finally { setWorking(false); }
  }

  return (
    <div
      className="relative flex-shrink-0 cursor-grab active:cursor-grabbing rounded overflow-hidden"
      style={{ width: 72, aspectRatio: '2/3' }}
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(book.id); }}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={onContextMenu}
      title={`${book.title}${book.author ? ` — ${book.author}` : ''}`}
    >
      {/* Cover */}
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={book.title}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <MiniPlaceholder title={book.title} />
      )}

      {/* On-device indicator */}
      {isOnDevice && (
        <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-shelf-accent" title="On device" />
      )}

      {/* Hover overlay */}
      {hovered && !working && (
        <div className="absolute inset-0 bg-shelf-bg/90 flex flex-col items-center justify-center gap-1 p-1">
          <p className="text-shelf-text text-[9px] text-center leading-tight line-clamp-3 w-full">
            {book.title}
          </p>
          <div className="flex flex-col gap-1 w-full mt-1">
            {isOnDevice ? (
              <button
                onClick={handleReturn}
                className="w-full text-[9px] py-0.5 bg-shelf-accent text-shelf-bg rounded font-medium"
              >
                Return
              </button>
            ) : (
              <button
                onClick={handleSend}
                className="w-full text-[9px] py-0.5 bg-shelf-accent text-shelf-bg rounded font-medium"
              >
                Send
              </button>
            )}
            {onRemoveFromShelf && (
              <button
                onClick={handleRemove}
                className="w-full text-[9px] py-0.5 text-shelf-muted hover:text-shelf-text rounded border border-shelf-border"
              >
                Unshelve
              </button>
            )}
            {!isOnDevice && (
              <button
                onClick={handleDelete}
                className="w-full text-[9px] py-0.5 text-red-400 hover:text-red-300 rounded border border-red-400/30"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {working && (
        <div className="absolute inset-0 bg-shelf-bg/80 flex items-center justify-center">
          <MiniSpinner />
        </div>
      )}

      {contextMenuElement}
    </div>
  );
}

function MiniPlaceholder({ title }) {
  return (
    <div className="w-full h-full bg-shelf-card border border-shelf-border flex items-center justify-center p-1">
      <p className="text-shelf-text text-[8px] text-center leading-tight line-clamp-4">{title}</p>
    </div>
  );
}

function MiniSpinner() {
  return (
    <svg className="animate-spin w-4 h-4 text-shelf-accent" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
