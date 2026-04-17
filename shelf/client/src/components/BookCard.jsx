import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useShelfContextMenu } from './ShelfContextMenu.jsx';

export default function BookCard({ book, onSend, onReturn, onDelete }) {
  const [hovered,   setHovered]   = useState(false);
  const [working,   setWorking]   = useState(false);
  const [workLabel, setWorkLabel] = useState('');
  const { progress } = book;

  const { onContextMenu, contextMenuElement } = useShelfContextMenu(book.id);

  useEffect(() => {
    if (!book.pendingSend) return;
    const iv = setInterval(async () => {
      const books = await api.listBooks().catch(() => []);
      const updated = books.find(b => b.id === book.id);
      if (updated?.progress?.onDevice) {
        setWorking(false);
        setWorkLabel('');
      } else if (updated?.pendingSend) {
        setWorkLabel('Waiting for device…');
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [book.pendingSend, book.id]);

  async function handleSend() {
    setWorking(true);
    setWorkLabel('Preparing…');
    try {
      const result = await onSend(book.id);
      if (result?.converted) setWorkLabel('Converting…');
      setWorkLabel('Queued…');
    } finally {
      // Keep working=true to show polling state
    }
  }

  async function handleReturn() {
    setWorking(true);
    try { await onReturn(); } finally { setWorking(false); }
  }

  async function handleDelete() {
    if (!confirm(`Remove "${book.title}" from your shelf?`)) return;
    setWorking(true);
    try { await onDelete(book.id); } finally { setWorking(false); }
  }

  const isOnDevice = progress.onDevice;

  return (
    <div
      className="relative w-40 rounded-lg overflow-hidden cursor-pointer group"
      style={{ aspectRatio: '2/3' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={onContextMenu}
    >
      {/* Cover */}
      {book.coverUrl ? (
        <img
          src={book.coverUrl}
          alt={book.title}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <PlaceholderCover title={book.title} author={book.author} />
      )}

      {/* On-device overlay */}
      {isOnDevice && (
        <div className="absolute inset-0 bg-black/60 flex flex-col justify-end p-2">
          <p className="text-white text-xs font-medium truncate">{book.title}</p>
          <p className="text-shelf-accent text-xs">{progress.pct}%</p>
          {progress.wpm && (
            <p className="text-white/60 text-xs">{progress.wpm} wpm</p>
          )}
        </div>
      )}

      {/* Hover stats popup */}
      {hovered && !working && (
        <div className="absolute inset-0 bg-shelf-bg/95 flex flex-col p-3 text-xs gap-1">
          <p className="font-semibold text-shelf-text leading-tight line-clamp-2">
            {book.title}
          </p>
          {book.author && (
            <p className="text-shelf-muted truncate">{book.author}</p>
          )}
          <div className="flex-1" />
          <Stat label="Progress"   value={`${progress.pct}%`} />
          {progress.lastSyncedAt && (
            <Stat label="Last read"  value={fmtDate(progress.lastSyncedAt)} />
          )}
          {progress.wpm && (
            <Stat label="Avg WPM"   value={progress.wpm} />
          )}
          {progress.timeRemaining && (
            <Stat label="Remaining" value={fmtMinutes(progress.timeRemaining)} />
          )}

          <div className="flex gap-1 mt-2">
            {isOnDevice ? (
              <button onClick={handleReturn} className="btn-primary flex-1 text-xs py-1">
                Return
              </button>
            ) : (
              <button onClick={handleSend} className="btn-primary flex-1 text-xs py-1">
                Send
              </button>
            )}
            {!isOnDevice && (
              <button onClick={handleDelete} className="btn-ghost px-2 py-1 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10">
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {working && (
        <div className="absolute inset-0 bg-shelf-bg/80 flex flex-col items-center justify-center gap-2">
          <Spinner />
          {workLabel && <p className="text-xs text-shelf-muted">{workLabel}</p>}
        </div>
      )}

      {contextMenuElement}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-shelf-muted">{label}</span>
      <span className="text-shelf-text font-medium">{value}</span>
    </div>
  );
}

function PlaceholderCover({ title, author }) {
  return (
    <div className="w-full h-full bg-shelf-card border border-shelf-border flex flex-col items-center justify-center p-3 gap-2">
      <div className="w-8 h-8 rounded bg-shelf-accent/20 flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="1" width="10" height="14" rx="1" fill="currentColor" className="text-shelf-accent/60" />
          <rect x="4" y="4" width="6" height="1" rx="0.5" fill="currentColor" className="text-shelf-bg/60" />
          <rect x="4" y="6" width="6" height="1" rx="0.5" fill="currentColor" className="text-shelf-bg/60" />
          <rect x="4" y="8" width="4" height="1" rx="0.5" fill="currentColor" className="text-shelf-bg/60" />
        </svg>
      </div>
      <p className="text-shelf-text text-xs text-center leading-tight line-clamp-3">{title}</p>
      {author && <p className="text-shelf-muted text-xs text-center truncate w-full">{author}</p>}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-5 h-5 text-shelf-accent" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 86_400_000) return 'Today';
  if (diff < 172_800_000) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtMinutes(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
