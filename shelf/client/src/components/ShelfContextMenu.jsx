import { useState, useEffect, useLayoutEffect, useRef, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';

/**
 * Hook that wires up a right-click "Add to shelf" context menu for a book.
 * Returns { onContextMenu, contextMenuElement } — spread onContextMenu onto the
 * card element, render contextMenuElement anywhere in the tree.
 */
export function useShelfContextMenu(bookId, onMove) {
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y } | null
  const [shelves, setShelves] = useState([]);
  const ctxRef = useRef(null);

  function handleContextMenu(e) {
    e.preventDefault();
    api.getShelves().then(data => setShelves(data.shelves ?? [])).catch(() => {});
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  async function handleAddToShelf(shelfId) {
    setCtxMenu(null);
    if (onMove) {
      onMove(bookId, shelfId);
    } else {
      await api.addToShelf(shelfId, bookId).catch(() => {});
    }
  }

  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e) {
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setCtxMenu(null);
    }
    function onKey(e) { if (e.key === 'Escape') setCtxMenu(null); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [ctxMenu]);

  const contextMenuElement = ctxMenu
    ? createPortal(
        <ContextMenu
          ref={ctxRef}
          x={ctxMenu.x}
          y={ctxMenu.y}
          shelves={shelves}
          onAddToShelf={handleAddToShelf}
        />,
        document.body
      )
    : null;

  return { onContextMenu: handleContextMenu, contextMenuElement };
}

const ContextMenu = forwardRef(function ContextMenu({ x, y, shelves, onAddToShelf }, ref) {
  const innerRef = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, visible: false });

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const left = x + width  > window.innerWidth  - pad ? x - width  : x;
    const top  = y + height > window.innerHeight - pad ? y - height : y;
    setPos({ left: Math.max(pad, left), top: Math.max(pad, top), visible: true });
  }, [x, y, shelves]);

  return (
    <div
      ref={node => { innerRef.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }}
      className="fixed z-50 bg-shelf-card border border-shelf-border rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ left: pos.left, top: pos.top, visibility: pos.visible ? 'visible' : 'hidden' }}
    >
      <p className="px-3 py-1.5 text-xs text-shelf-muted font-medium uppercase tracking-wide">
        Add to shelf
      </p>
      {shelves.length === 0 ? (
        <p className="px-3 py-2 text-xs text-shelf-muted italic">No shelves yet</p>
      ) : (
        shelves.map(shelf => (
          <button
            key={shelf.id}
            onClick={() => onAddToShelf(shelf.id)}
            className="w-full text-left px-3 py-1.5 text-sm text-shelf-text hover:bg-shelf-accent/10 hover:text-shelf-accent transition-colors truncate"
          >
            {shelf.name}
          </button>
        ))
      )}
    </div>
  );
});
