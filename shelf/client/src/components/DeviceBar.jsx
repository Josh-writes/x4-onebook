export default function DeviceBar({ status, onSync }) {
  const wifi    = status?.wifi;
  const usb     = status?.usb;
  const onDevice = status?.onDevice;

  const connected = wifi?.reachable || usb?.connected;

  return (
    <footer className="border-t border-shelf-border px-6 py-2 flex items-center gap-4 text-xs text-shelf-muted">
      {/* Connection indicator */}
      <div className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${
            wifi?.reachable ? 'bg-green-400' :
            usb?.connected  ? 'bg-blue-400'  : 'bg-shelf-border'
          }`}
        />
        <span>
          {wifi?.reachable  ? `WiFi · ${wifi.ip}`  :
           usb?.connected   ? 'USB'                 :
           'No device'}
        </span>
      </div>

      {/* On-device book */}
      {onDevice && (
        <span className="text-shelf-accent truncate max-w-xs">
          ▪ {onDevice.title}
        </span>
      )}

      <div className="flex-1" />

      {/* Manual sync */}
      <button
        onClick={onSync}
        className="hover:text-shelf-text transition-colors"
        title="Sync device status"
      >
        ↻ Refresh
      </button>
    </footer>
  );
}
