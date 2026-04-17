import { useState, useEffect, useCallback } from 'react';
import { api } from './api.js';
import ShelfView    from './views/Shelf/index.jsx';
import DeviceView   from './views/Device/index.jsx';
import StatsView    from './views/Stats/index.jsx';
import SettingsView from './views/Settings/index.jsx';
import DeviceBar    from './components/DeviceBar.jsx';

const VIEWS = ['Shelf', 'Stats', 'Device', 'Settings'];

export default function App() {
  const [view,          setView]          = useState('Shelf');
  const [books,         setBooks]         = useState([]);
  const [deviceStatus,  setDeviceStatus]  = useState(null);
  const [loading,       setLoading]       = useState(true);

  const refreshBooks = useCallback(async () => {
    const data = await api.listBooks().catch(() => []);
    setBooks(data);
  }, []);

  const refreshDevice = useCallback(async () => {
    const status = await api.deviceStatus().catch(() => null);
    setDeviceStatus(status);
  }, []);

  useEffect(() => {
    Promise.all([refreshBooks(), refreshDevice()]).finally(() => setLoading(false));
    // Poll device status every 10 s
    const iv = setInterval(refreshDevice, 10_000);
    return () => clearInterval(iv);
  }, [refreshBooks, refreshDevice]);

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top nav */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-shelf-border">
        <span className="text-shelf-accent font-semibold tracking-wide text-sm uppercase">
          x4-onebook
        </span>
        <nav className="flex gap-1">
          {VIEWS.map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
                view === v
                  ? 'bg-shelf-accent text-shelf-bg font-medium'
                  : 'text-shelf-muted hover:text-shelf-text'
              }`}
            >
              {v}
            </button>
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-shelf-muted text-sm">
            Loading…
          </div>
        ) : (
          <>
            {view === 'Shelf'  && (
              <ShelfView
                books={books}
                deviceStatus={deviceStatus}
                onImport={async (file) => { if (file) await api.importEpub(file); refreshBooks(); }}
                onSend={async (id) => { const r = await api.sendBook(id); await Promise.all([refreshBooks(), refreshDevice()]); return r; }}
                onReturn={async () => { await api.returnBook(); await Promise.all([refreshBooks(), refreshDevice()]); }}
                onDelete={async (id) => { await api.deleteBook(id); refreshBooks(); }}
              />
            )}
            {view === 'Stats'    && <StatsView books={books} />}
            {view === 'Device'   && <DeviceView status={deviceStatus} onRefresh={refreshDevice} />}
            {view === 'Settings' && <SettingsView />}
          </>
        )}
      </main>

      {/* Persistent device bar */}
      <DeviceBar status={deviceStatus} onSync={refreshDevice} />
    </div>
  );
}
