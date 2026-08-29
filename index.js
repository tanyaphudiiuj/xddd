require('dotenv').config();
const express = require('express');
const path = require('path');
const { startSocket, requestPairingCode, getState, logout } = require('./lib/whatsapp');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Frontend polls this every 1.5s to render connection state / pairing code
app.get('/api/status', (_req, res) => {
  res.json(getState());
});

// Frontend posts { phoneNumber } here to request a pairing code
app.post('/api/pair', async (req, res) => {
  try {
    const { phoneNumber } = req.body || {};
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required.' });
    const result = await requestPairingCode(phoneNumber);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Frontend's "TERMINATE SESSION" button
app.post('/api/logout', async (_req, res) => {
  try {
    await logout();
    res.json(getState());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[web] pairing UI listening on port ${PORT}`));

startSocket().catch((e) => console.error('[wa] fatal error starting socket:', e));
