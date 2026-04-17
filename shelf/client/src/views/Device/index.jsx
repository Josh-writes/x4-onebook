import { useState } from 'react';
import FlashModal from './FlashModal.jsx';

export default function DeviceView({ status, onRefresh }) {
  const [flashOpen, setFlashOpen] = useState(false);

  const usb      = status?.usb;
  const onDevice = status?.onDevice;

  return (
    <>
      {flashOpen && <FlashModal onClose={() => setFlashOpen(false)} />}

      <div className="p-6 max-w-md flex flex-col gap-6">
        <h1 className="text-shelf-text font-semibold text-lg">Device</h1>

        {/* Sync instructions */}
        <section className="bg-shelf-card border border-shelf-border rounded-lg p-4">
          <h2 className="text-xs uppercase tracking-widest text-shelf-muted mb-3">Syncing</h2>
          <p className="text-sm text-shelf-text mb-2">
            To sync, select <strong>Swap Book</strong> or <strong>Return Book</strong> from the
            device settings menu. The device will create a WiFi hotspot named <code className="text-shelf-accent">x4book</code>.
          </p>
          <p className="text-sm text-shelf-muted">
            Connect your computer to <code className="text-shelf-accent">x4book</code> — the shelf
            will detect the device and sync automatically. Reconnect to your home network when done.
          </p>
        </section>

        {/* On device */}
        <section className="bg-shelf-card border border-shelf-border rounded-lg p-4">
          <h2 className="text-xs uppercase tracking-widest text-shelf-muted mb-3">On Device</h2>
          {onDevice
            ? <p className="text-sm text-shelf-accent">{onDevice.title}</p>
            : <p className="text-sm text-shelf-muted">No book on device.</p>}
          <button onClick={onRefresh} className="btn-ghost text-xs mt-4">↻ Refresh</button>
        </section>

        {/* Firmware */}
        <section className="bg-shelf-card border border-shelf-border rounded-lg p-4">
          <h2 className="text-xs uppercase tracking-widest text-shelf-muted mb-3">Firmware</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-shelf-text">Flash Firmware</p>
              <p className="text-xs text-shelf-muted mt-0.5">
                {usb?.available ? 'USB ready' : 'Connect via USB'}
              </p>
            </div>
            <button onClick={() => setFlashOpen(true)} className="btn-ghost text-xs px-3 py-1.5 shrink-0">
              Flash →
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
