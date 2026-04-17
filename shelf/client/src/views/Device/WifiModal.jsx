import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../api.js';

export default function WifiModal({ onClose }) {
  const [ports,     setPorts]    = useState([]);
  const [port,      setPort]     = useState('');
  const [manual,    setManual]   = useState(false);
  const [networks,  setNetworks] = useState([]);
  const [selected,  setSelected] = useState(new Set());
  const [allIps,    setAllIps]   = useState([]);
  const [shelfIp,   setShelfIp]  = useState('');
  const [showAdd,   setShowAdd]  = useState(false);
  const [addForm,   setAddForm]  = useState({ ssid: '', password: '' });
  const [phase,     setPhase]    = useState('idle'); // idle | sending | ok | err
  const [errMsg,    setErrMsg]   = useState('');
  const intervalRef              = useRef(null);

  const refreshPorts = useCallback(async () => {
    const list = await api.listPorts().catch(() => []);
    setPorts(list);
    setPort(prev => {
      if (prev) return prev;
      const x4 = list.find(p => p.isX4);
      return x4 ? x4.path : (list[0]?.path ?? '');
    });
  }, []);

  const loadNetworks = useCallback(async () => {
    const list = await api.listWifi().catch(() => []);
    setNetworks(list);
    setSelected(new Set(list.map(n => n.id)));
  }, []);

  useEffect(() => {
    api.localIps().then(ips => {
      setAllIps(ips);
      if (ips.length > 0) setShelfIp(ips[0].address);
    }).catch(() => api.localIp().then(r => setShelfIp(r.ip)).catch(() => {}));
    loadNetworks();
    refreshPorts();
    intervalRef.current = setInterval(refreshPorts, 2000);
    return () => clearInterval(intervalRef.current);
  }, [refreshPorts, loadNetworks]);

  const toggleNetwork = id => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const addNetwork = async () => {
    if (!addForm.ssid) return;
    await api.addWifi(addForm.ssid, addForm.password, 0).catch(() => {});
    setAddForm({ ssid: '', password: '' });
    setShowAdd(false);
    loadNetworks();
  };

  const submit = async () => {
    const ids = networks.filter(n => selected.has(n.id)).map(n => n.id);
    if (!ids.length || !port) return;
    setPhase('sending');
    setErrMsg('');
    try {
      const r = await api.configureWifi({ port, networkIds: ids, shelfIp });
      if (r.ok) { setPhase('ok'); }
      else { setPhase('err'); setErrMsg(r.error || 'Device rejected configuration'); }
    } catch (err) {
      setPhase('err');
      setErrMsg(err.message);
    }
  };

  const selectedNetworks = networks.filter(n => selected.has(n.id));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-shelf-card border border-shelf-border rounded-xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-shelf-border">
          <h2 className="text-shelf-text font-semibold text-sm">Configure WiFi</h2>
          <button onClick={onClose} className="text-shelf-muted hover:text-shelf-text text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          {phase === 'ok' ? (
            <>
              <div className="flex items-center gap-2 text-green-400">
                <span className="text-2xl">✓</span>
                <span className="text-sm font-medium">Device configured!</span>
              </div>
              <p className="text-shelf-muted text-sm">
                Unplug USB and wake the device. It will connect to WiFi and sync with this shelf at{' '}
                <span className="font-mono text-shelf-text">{shelfIp}:3001</span>.
              </p>
              <button onClick={onClose} className="btn-primary text-sm self-start">Done</button>
            </>
          ) : (
            <>
              <p className="text-shelf-muted text-sm">
                Plug in the X4 via USB, then push your WiFi credentials to it.
              </p>

              {/* Port */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-shelf-muted uppercase tracking-wide">Port</span>
                  <button onClick={() => setManual(m => !m)} className="text-xs text-shelf-muted hover:text-shelf-text">
                    {manual ? '↩ Auto-detect' : 'Enter manually'}
                  </button>
                </div>
                {manual ? (
                  <input type="text" value={port} onChange={e => setPort(e.target.value)}
                    placeholder="COM8" className="input font-mono" autoComplete="off" />
                ) : ports.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {ports.map(p => (
                      <label key={p.path} className={`flex items-center gap-3 rounded p-2 cursor-pointer border text-sm transition-colors ${
                        port === p.path ? 'border-shelf-accent bg-shelf-accent/10 text-shelf-text' : 'border-transparent text-shelf-muted hover:border-shelf-border'
                      }`}>
                        <input type="radio" name="wifiPort" value={p.path} checked={port === p.path}
                          onChange={() => setPort(p.path)} className="accent-shelf-accent" />
                        <span className="font-mono">{p.path}</span>
                        {p.isX4 && <span className="text-xs bg-shelf-accent/20 text-shelf-accent px-1.5 py-0.5 rounded">X4</span>}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-shelf-muted py-1">No ports detected — plug in the device or enter manually.</p>
                )}
              </div>

              {/* Networks */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-shelf-muted uppercase tracking-wide">WiFi Networks</span>
                  <button onClick={() => setShowAdd(s => !s)} className="text-xs text-shelf-muted hover:text-shelf-text">
                    {showAdd ? 'Cancel' : '+ Add'}
                  </button>
                </div>

                {networks.length === 0 && !showAdd && (
                  <p className="text-xs text-shelf-muted py-1">No networks saved — add one below.</p>
                )}

                {networks.map(n => (
                  <div key={n.id} className={`flex items-center gap-2 rounded p-2 border text-sm transition-colors ${
                    selected.has(n.id) ? 'border-shelf-accent bg-shelf-accent/10' : 'border-transparent'
                  }`}>
                    <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggleNetwork(n.id)}
                      className="w-4 h-4 accent-shelf-accent shrink-0" />
                    <span className="flex-1 text-shelf-text cursor-pointer" onClick={() => toggleNetwork(n.id)}>{n.ssid}</span>
                    <button onClick={async () => { await api.deleteWifi(n.id); loadNetworks(); }}
                      className="text-shelf-muted hover:text-red-400 text-xs shrink-0 px-1">✕</button>
                  </div>
                ))}

                {showAdd && (
                  <div className="flex flex-col gap-2 mt-1 p-3 bg-shelf-bg border border-shelf-border rounded">
                    <input type="text" value={addForm.ssid} onChange={e => setAddForm(f => ({ ...f, ssid: e.target.value }))}
                      placeholder="Network name (SSID)" className="input" autoComplete="off" />
                    <input type="password" value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Password" className="input" autoComplete="new-password" />
                    <button onClick={addNetwork} disabled={!addForm.ssid}
                      className="btn-primary text-sm self-start disabled:opacity-40">
                      Save
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs text-shelf-muted uppercase tracking-wide">Shelf IP</span>
                {allIps.length > 1 ? (
                  <select value={shelfIp} onChange={e => setShelfIp(e.target.value)}
                    className="input font-mono text-sm">
                    {allIps.map(ip => (
                      <option key={ip.address} value={ip.address}>
                        {ip.address} ({ip.name})
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-mono text-shelf-text text-sm">{shelfIp || '…'}</span>
                )}
                <span className="text-xs text-shelf-muted">Pick the IP on the same network as the device.</span>
              </div>

              {phase === 'err' && <p className="text-red-400 text-sm">{errMsg}</p>}

              <div className="flex gap-2">
                <button onClick={submit}
                  disabled={selectedNetworks.length === 0 || !port || phase === 'sending'}
                  className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  {phase === 'sending' ? 'Configuring…' : `Configure Device (${selectedNetworks.length} network${selectedNetworks.length !== 1 ? 's' : ''})`}
                </button>
                <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
