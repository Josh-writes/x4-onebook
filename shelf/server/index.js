const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { EventEmitter } = require('events');

const { initDb } = require('./db/schema');

const eventEmitter = new EventEmitter();
const syncSvc = require('./services/device/sync');
syncSvc.setEventEmitter(eventEmitter);

const app     = express();
const PORT    = Number(process.env.PORT ?? 3001);
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directories exist on first run
for (const dir of ['epubs', 'covers', 'converted']) {
  fs.mkdirSync(path.join(DATA_DIR, dir), { recursive: true });
}

initDb(path.join(DATA_DIR, 'books.db'));

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  req.eventEmitter = eventEmitter;
  next();
});

// Serve cover images
app.use('/covers', express.static(path.join(DATA_DIR, 'covers')));

// API routes
app.use('/api/books',    require('./routes/books'));
app.use('/api/shelves',  require('./routes/shelves'));
app.use('/api/device',   require('./routes/device'));
app.use('/api/settings', require('./routes/settings'));

// SSE endpoint for sync events
app.get('/api/sync/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventEmitter.on('sync:device-detected', data => onEvent({ event: 'device-detected', ...data }));
  eventEmitter.on('sync:progress', data => onEvent({ event: 'progress', ...data }));
  eventEmitter.on('sync:sending', data => onEvent({ event: 'sending', ...data }));
  eventEmitter.on('sync:send-progress', data => onEvent({ event: 'send-progress', ...data }));
  eventEmitter.on('sync:returning', data => onEvent({ event: 'returning', ...data }));
  eventEmitter.on('sync:complete', data => onEvent({ event: 'complete', ...data }));
  eventEmitter.on('sync:error', data => onEvent({ event: 'error', ...data }));

  req.on('close', () => {
    eventEmitter.removeListener('sync:device-detected', onEvent);
    eventEmitter.removeListener('sync:progress', onEvent);
    eventEmitter.removeListener('sync:sending', onEvent);
    eventEmitter.removeListener('sync:send-progress', onEvent);
    eventEmitter.removeListener('sync:returning', onEvent);
    eventEmitter.removeListener('sync:complete', onEvent);
    eventEmitter.removeListener('sync:error', onEvent);
  });
});

// Start sync polling
syncSvc.start();

// In production, serve the built Vite client
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`x4-onebook shelf → http://localhost:${PORT}`);
});
