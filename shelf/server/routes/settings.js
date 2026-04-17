const express = require('express');
const queries = require('../db/queries');

const router = express.Router();

router.get('/', (req, res) => {
  const raw = queries.getAllSettings();
  res.json({
    ...raw,
    libraryPaths: queries.getLibraryPaths(), // parsed array, not raw JSON string
  });
});

router.patch('/', (req, res) => {
  const { libraryPaths, deviceIp, port } = req.body;

  if (Array.isArray(libraryPaths)) queries.setLibraryPaths(libraryPaths);
  if (deviceIp !== undefined)      queries.setSetting('deviceIp', deviceIp);
  if (port     !== undefined)      queries.setSetting('port', port);

  const raw = queries.getAllSettings();
  res.json({
    ...raw,
    libraryPaths: queries.getLibraryPaths(),
  });
});

module.exports = router;
