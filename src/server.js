const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { NfcWriter } = require('./lib/nfc-writer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const nfcWriter = new NfcWriter();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- REST API ---

app.post('/api/url', (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL requerida' });
  }

  const trimmed = url.trim();

  // Basic URL validation
  try {
    new URL(trimmed);
  } catch {
    return res.status(400).json({ error: 'URL invalida' });
  }

  nfcWriter.setUrl(trimmed);
  res.json({ ok: true, url: trimmed });
});

app.get('/api/url', (req, res) => {
  res.json({ url: nfcWriter.pendingUrl });
});

app.delete('/api/url', (req, res) => {
  nfcWriter.clearUrl();
  res.json({ ok: true });
});

app.post('/api/read', (req, res) => {
  nfcWriter.requestRead();
  res.json({ ok: true });
});

app.delete('/api/read', (req, res) => {
  nfcWriter.cancelRead();
  res.json({ ok: true });
});

app.get('/api/status', (req, res) => {
  res.json(nfcWriter.getStatus());
});

// --- WebSocket broadcast ---

function broadcast(event, data) {
  const message = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

// Forward all NFC events to WebSocket clients
const events = [
  'reader:connect',
  'reader:disconnect',
  'reader:error',
  'card:detect',
  'card:remove',
  'card:idle',
  'card:busy',
  'write:start',
  'write:progress',
  'write:success',
  'write:error',
  'url:set',
  'url:clear',
  'nfc:error',
  'read:pending',
  'read:cancel',
  'read:start',
  'read:progress',
  'read:success',
  'read:error',
];

for (const event of events) {
  nfcWriter.on(event, (data) => broadcast(event, data));
}

// Send current status on new connection
wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      event: 'status',
      data: nfcWriter.getStatus(),
      timestamp: Date.now(),
    })
  );
});

// --- Start ---

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor NFC en http://localhost:${PORT}`);
});

// --- Graceful Shutdown ---

function shutdown() {
  console.log('Cerrando servidor...');
  wss.close();
  server.close(() => {
    console.log('Servidor HTTP cerrado.');
    process.exit(0);
  });

  // Force exit after 5s
  setTimeout(() => {
    console.error('Forzando salida...');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
