const express = require('express');
const { v4: uuidv4 } = require('uuid');
const wifiQueries = require('../db/queries');

const router = express.Router();

router.get('/', (req, res) => {
  const networks = wifiQueries.listWifiNetworks();
  res.json(networks);
});

router.post('/', (req, res) => {
  const { ssid, password, priority } = req.body;
  if (!ssid || !password) {
    return res.status(400).json({ error: 'ssid and password required' });
  }
  const id = uuidv4();
  wifiQueries.insertWifiNetwork({ id, ssid, password, priority });
  res.json({ id, ssid, priority: priority ?? 0 });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { ssid, password, priority } = req.body;
  if (!ssid || !password) {
    return res.status(400).json({ error: 'ssid and password required' });
  }
  wifiQueries.updateWifiNetwork(id, { ssid, password, priority });
  res.json({ id, ssid, priority });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  wifiQueries.deleteWifiNetwork(id);
  res.json({ success: true });
});

router.post('/sync', (req, res) => {
  const { networkIds } = req.body;
  if (!networkIds || !Array.isArray(networkIds)) {
    return res.status(400).json({ error: 'networkIds array required' });
  }

  const networks = networkIds
    .map(id => wifiQueries.getWifiNetwork(id))
    .filter(Boolean);

  for (const id of networkIds) {
    wifiQueries.syncWifiNetwork(id);
  }

  res.json({ networks });
});

module.exports = router;