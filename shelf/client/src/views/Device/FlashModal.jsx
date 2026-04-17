import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api.js';
import { flashOta, isWebSerialSupported } from './espFlash.js';

export default function FlashModal({ onClose }) {
  const [status,  setStatus]  = useState(null);
  const [log,     setLog]     = useState([]);
  const [percent, setPercent] = useState(0);
  const [phase,   setPhase]   = useState('idle'); // idle | flashing | done | failed

  const check = useCallback(async () => {
    const s = await api.firmwareStatus().catch(() => null);
    setStatus(s);
  }, []);

  useEffect(() => { check(); }, [check]);

  const startFlash = async () => {
    setLog([]);
    setPercent(0);
    setPhase('flashing');

    const onEvent = ({ type, message, percent: pct }) => {
      if (pct !== undefined) setPercent(pct);
      setLog(l => [...l, { type, message }]);
    };

    try {
      await flashOta('/api/device/firmware', onEvent);
      setPhase('done');
    } catch (err) {
      setLog(l => [...l, { type: 'error', message: err.message }]);
      setPhase('failed');
    }
  };

  const ready = status?.compiled && isWebSerialSupported();

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-shelf-card border border-shelf-border rounded-xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-shelf-border">
          <h2 className="text-shelf-text font-semibold text-sm">Flash Firmware</h2>
          <button onClick={onClose} className="text-shelf-muted hover:text-shelf-text text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          {/* Pre-flight checks */}
          {status === null && <p className="text-shelf-muted text-sm">Checking…</p>}

          {status !== null && (
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center gap-2">
                <span className={status.compiled ? 'text-green-400' : 'text-red-400'}>
                  {status.compiled ? '✓' : '✗'}
                </span>
                <span className={status.compiled ? 'text-shelf-text' : 'text-shelf-muted'}>firmware.bin</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={isWebSerialSupported() ? 'text-green-400' : 'text-red-400'}>
                  {isWebSerialSupported() ? '✓' : '✗'}
                </span>
                <span className="text-shelf-muted">
                  {isWebSerialSupported() ? 'Web Serial (Chrome/Edge)' : 'Web Serial not supported — use Chrome or Edge'}
                </span>
              </div>

              {!status.compiled && (
                <div className="mt-2 rounded border border-shelf-border bg-shelf-bg p-2 text-xs text-shelf-muted">
                  Build firmware first: <span className="font-mono">cd firmware && pio run</span>
                </div>
              )}
            </div>
          )}

          {/* Progress */}
          {phase !== 'idle' && (
            <>
              <div>
                <div className="flex justify-between text-xs text-shelf-muted mb-1">
                  <span>{phase === 'done' ? 'Complete' : phase === 'failed' ? 'Failed' : 'Flashing…'}</span>
                  <span>{percent}%</span>
                </div>
                <div className="w-full bg-shelf-border rounded-full h-2">
                  <div className={`h-2 rounded-full transition-all duration-200 ${phase === 'failed' ? 'bg-red-400' : 'bg-shelf-accent'}`}
                    style={{ width: `${percent}%` }} />
                </div>
              </div>
              <div className="bg-shelf-bg border border-shelf-border rounded p-3 h-36 overflow-y-auto font-mono text-xs flex flex-col gap-0.5">
                {log.map((e, i) => (
                  <span key={i} className={
                    e.type === 'error' ? 'text-red-400' :
                    e.type === 'success' ? 'text-green-400' :
                    e.type === 'progress' ? 'text-shelf-text' : 'text-shelf-muted'
                  }>{e.message}</span>
                ))}
                {phase === 'flashing' && <span className="text-shelf-muted animate-pulse">▌</span>}
              </div>
            </>
          )}

          {phase === 'failed' && (
            <p className="text-xs text-shelf-muted">
              Hold BOOT while pressing RESET to enter bootloader mode, then retry.
            </p>
          )}

          <div className="flex gap-2 flex-wrap">
            {phase === 'done' ? (
              <button onClick={onClose} className="btn-primary text-sm">Done</button>
            ) : (
              <>
                {ready && (
                  <button onClick={startFlash} disabled={phase === 'flashing'} className="btn-primary text-sm disabled:opacity-40">
                    {phase === 'failed' ? 'Retry' : 'Flash Device'}
                  </button>
                )}
                <button onClick={onClose} className="btn-ghost text-sm">
                  {phase === 'idle' ? 'Cancel' : 'Close'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
