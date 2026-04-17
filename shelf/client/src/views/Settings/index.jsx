import { useState, useEffect } from 'react';
import { api } from '../../api.js';

export default function SettingsView() {
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [error,        setError]        = useState(null);
  const [libraryPaths, setLibraryPaths] = useState([]);
  const [newPath,      setNewPath]      = useState('');

  useEffect(() => {
    api.getSettings().then(s => {
      setLibraryPaths(Array.isArray(s.libraryPaths) ? s.libraryPaths : []);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await api.saveSettings({ libraryPaths });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function addPath() {
    const p = newPath.trim();
    if (p && !libraryPaths.includes(p)) setLibraryPaths([...libraryPaths, p]);
    setNewPath('');
  }

  function removePath(i) {
    setLibraryPaths(libraryPaths.filter((_, idx) => idx !== i));
  }

  return (
    <div className="p-6 max-w-lg flex flex-col gap-6">
      <h1 className="text-shelf-text font-semibold text-lg">Settings</h1>

      <section className="bg-shelf-card border border-shelf-border rounded-lg p-4">
        <h2 className="text-xs uppercase tracking-widest text-shelf-muted mb-1">Library Folders</h2>
        <p className="text-xs text-shelf-muted mb-3">
          EPUBs in these folders are imported to your shelf. The first folder is the
          primary — books added via "+ Add Book" are copied there. Duplicates across
          folders are skipped automatically.
        </p>

        {libraryPaths.length === 0 ? (
          <p className="text-xs text-shelf-muted italic mb-3">
            No folders configured — using the default{' '}
            <code className="text-shelf-accent">library/</code> folder at the project root.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 mb-3">
            {libraryPaths.map((p, i) => (
              <li key={i} className="flex items-center gap-2">
                {i === 0 && (
                  <span className="text-xs text-shelf-accent flex-shrink-0 w-12">primary</span>
                )}
                {i > 0 && <span className="w-12 flex-shrink-0" />}
                <span className="flex-1 truncate font-mono text-xs text-shelf-text">{p}</span>
                <button
                  onClick={() => removePath(i)}
                  className="text-shelf-muted hover:text-red-400 text-xs flex-shrink-0"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newPath}
            onChange={e => setNewPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addPath()}
            placeholder="C:\Users\you\Books"
            className="flex-1 bg-shelf-bg border border-shelf-border rounded px-3 py-2 text-sm text-shelf-text focus:outline-none focus:border-shelf-accent"
          />
          <button onClick={addPath} className="btn-ghost text-sm">Add</button>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary self-start disabled:opacity-50"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
        {error && <span className="text-red-400 text-sm">{error}</span>}
      </div>
    </div>
  );
}
