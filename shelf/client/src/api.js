const BASE = '/api';

async function request(method, url, body) {
  const opts = {
    method,
    headers: {},
  };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${url}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

const get    = (url)        => request('GET',    url);
const post   = (url, body)  => request('POST',   url, body);
const patch  = (url, body)  => request('PATCH',  url, body);
const del    = (url)        => request('DELETE', url);

export const api = {
  // Books
  listBooks:      ()       => get('/books'),
  getBook:        (id)     => get(`/books/${id}`),
  importEpub:     (file)   => { const fd = new FormData(); fd.append('epub', file); return post('/books', fd); },
  deleteBook:     (id)     => del(`/books/${id}`),
  getSessions:    (id)     => get(`/books/${id}/sessions`),
  getBookmarks:   (id)     => get(`/books/${id}/bookmarks`),

  libraryScan:  () => get('/books/library-scan'),
  importOne:    (epubPath) => post('/books/import-one', { epubPath }),

  // Shelves
  getShelves:        ()              => get('/shelves'),
  createShelf:       (name)          => post('/shelves', { name }),
  renameShelf:       (id, name)      => patch(`/shelves/${id}`, { name }),
  deleteShelf:       (id)            => del(`/shelves/${id}`),
  reorderShelves:    (ids)           => request('PUT', '/shelves/order', { ids }),
  addToShelf:        (id, bookId)    => post(`/shelves/${id}/books/${bookId}`),
  removeFromShelf:   (id, bookId)    => del(`/shelves/${id}/books/${bookId}`),

  // Device
  deviceStatus:    ()            => get('/device/status'),
  sendBook:        (id)          => post(`/device/send/${id}`),
  returnBook:      ()            => post('/device/return'),
  listPorts:       ()            => get('/device/ports'),
  firmwareStatus:  ()            => get('/device/firmware-status'),
  localIp:         ()            => get('/device/local-ip'),
  localIps:        ()            => get('/device/local-ips'),
  wifiScan:        ()            => get('/device/wifi-scan'),
  configureWifi:   (data)        => post('/device/configure-wifi', data),

  // Settings
  getSettings:    ()       => get('/settings'),
  saveSettings:   (data)   => patch('/settings', data),

  // WiFi Networks
  listWifi:       ()       => get('/wifi'),
  addWifi:        (ssid, password, priority) => post('/wifi', { ssid, password, priority }),
  updateWifi:    (id, ssid, password, priority) => request('PUT', `/wifi/${id}`, { ssid, password, priority }),
  deleteWifi:     (id)     => del(`/wifi/${id}`),
  syncWifi:      (networkIds) => post('/wifi/sync', { networkIds }),
};
