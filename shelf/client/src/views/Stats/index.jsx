import { useState, useEffect } from 'react';
import { api } from '../../api.js';

export default function StatsView({ books }) {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    // Gather sessions for all books
    Promise.all(books.map(b => api.getSessions(b.id).catch(() => [])))
      .then(all => setSessions(all.flat().sort((a, b) => b.started_at.localeCompare(a.started_at))));
  }, [books]);

  const totalBooks    = books.length;
  const booksStarted  = books.filter(b => b.progress.charOffset > 0).length;
  const booksFinished = books.filter(b => b.progress.pct >= 99).length;

  const validWpms = sessions.filter(s => s.wpm > 0).map(s => s.wpm);
  const avgWpm    = validWpms.length
    ? Math.round(validWpms.reduce((s, w) => s + w, 0) / validWpms.length)
    : null;

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-shelf-text font-semibold text-lg mb-6">Reading Stats</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Books"    value={totalBooks} />
        <StatCard label="Started"  value={booksStarted} />
        <StatCard label="Finished" value={booksFinished} />
        <StatCard label="Avg WPM"  value={avgWpm ?? '—'} />
      </div>

      {/* Recent sessions */}
      <h2 className="text-shelf-muted text-xs uppercase tracking-widest mb-3">Recent Sessions</h2>
      {sessions.length === 0 ? (
        <p className="text-shelf-muted text-sm">No sessions yet. Start reading!</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.slice(0, 20).map(s => (
            <SessionRow key={s.id} session={s} books={books} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="bg-shelf-card border border-shelf-border rounded-lg p-4 text-center">
      <p className="text-2xl font-bold text-shelf-accent">{value}</p>
      <p className="text-xs text-shelf-muted mt-1">{label}</p>
    </div>
  );
}

function SessionRow({ session, books }) {
  const book = books.find(b => b.id === session.book_id);
  const dur  = session.ended_at
    ? Math.round((new Date(session.ended_at) - new Date(session.started_at)) / 60000)
    : null;

  return (
    <div className="flex items-center gap-3 text-sm py-2 border-b border-shelf-border/40">
      <div className="flex-1 min-w-0">
        <p className="text-shelf-text truncate">{book?.title ?? 'Unknown book'}</p>
        <p className="text-shelf-muted text-xs">
          {new Date(session.started_at).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      </div>
      {dur != null && <span className="text-shelf-muted text-xs">{dur}m</span>}
      {session.wpm && (
        <span className="text-shelf-accent text-xs font-medium">{session.wpm} wpm</span>
      )}
    </div>
  );
}
