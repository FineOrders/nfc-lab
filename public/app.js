const logEl = document.getElementById('log');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const btnWrite = document.getElementById('btn-write');
const btnCancel = document.getElementById('btn-cancel');
const pendingEl = document.getElementById('pending');
const pendingUrlEl = document.getElementById('pending-url');
const btnRead = document.getElementById('btn-read');
const btnReadCancel = document.getElementById('btn-read-cancel');
const readPendingEl = document.getElementById('read-pending');
const readResultEl = document.getElementById('read-result');
const readUrlEl = document.getElementById('read-url');
const readMetaEl = document.getElementById('read-meta');
const readEmptyEl = document.getElementById('read-empty');
const readEmptyMsgEl = document.getElementById('read-empty-msg');

let readerConnected = false;

function addLog(text, type) {
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + (type || 'info');
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = '<span class="time">' + time + '</span>' + text;
  logEl.prepend(entry);
}

function updateStatus(connected, text, dotClass) {
  statusDot.className = 'dot ' + (dotClass || (connected ? 'connected' : ''));
  statusText.textContent = text;
}

function showPending(url) {
  if (url) {
    pendingUrlEl.textContent = url;
    pendingEl.classList.remove('hidden');
    btnCancel.disabled = false;
  } else {
    pendingEl.classList.add('hidden');
    btnCancel.disabled = true;
  }
}

// WebSocket
const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(wsProto + '//' + location.host);

ws.onopen = function () {
  addLog('WebSocket conectado', 'info');
};

ws.onclose = function () {
  updateStatus(false, 'WebSocket desconectado');
  addLog('WebSocket desconectado', 'error');
};

ws.onmessage = function (evt) {
  var msg = JSON.parse(evt.data);
  handleEvent(msg.event, msg.data);
};

function handleEvent(event, data) {
  switch (event) {
    case 'status':
      readerConnected = data.readerConnected;
      updateStatus(readerConnected, readerConnected ? 'Lector: ' + data.readerName : 'Sin lector');
      showPending(data.pendingUrl);
      break;

    case 'reader:connect':
      readerConnected = true;
      updateStatus(true, 'Lector: ' + data.name);
      addLog('Lector conectado: ' + data.name, 'success');
      break;

    case 'reader:disconnect':
      readerConnected = false;
      updateStatus(false, 'Lector desconectado');
      addLog('Lector desconectado: ' + data.name, 'warn');
      break;

    case 'card:detect':
      addLog('Tarjeta detectada - UID: ' + data.uid, 'info');
      break;

    case 'card:remove':
      addLog('Tarjeta retirada - UID: ' + data.uid, 'info');
      break;

    case 'card:idle':
      addLog('Tarjeta sin accion: ' + data.message, 'info');
      break;

    case 'card:busy':
      addLog(data.message, 'warn');
      break;

    case 'write:start':
      updateStatus(true, 'Escribiendo...', 'writing');
      addLog('Escribiendo URL: ' + data.url + ' en UID: ' + data.uid, 'warn');
      break;

    case 'write:progress':
      addLog(data.step + (data.detail ? ' (' + data.detail + ')' : ''), 'info');
      break;

    case 'write:success':
      updateStatus(true, 'Lector: ' + (data.cardType || 'conectado'));
      addLog('Escritura exitosa en ' + data.cardType + ' - ' + data.url, 'success');
      showPending(null);
      break;

    case 'write:error':
      updateStatus(true, 'Error de escritura', 'error');
      addLog('Error: ' + data.error, 'error');
      break;

    case 'url:set':
      showPending(data.url);
      addLog('URL establecida: ' + data.url, 'info');
      break;

    case 'url:clear':
      showPending(null);
      addLog('URL pendiente cancelada', 'info');
      break;

    case 'read:pending':
      readPendingEl.classList.remove('hidden');
      readResultEl.classList.add('hidden');
      readEmptyEl.classList.add('hidden');
      btnReadCancel.disabled = false;
      addLog('Lectura pendiente - acerca una tarjeta', 'info');
      break;

    case 'read:cancel':
      readPendingEl.classList.add('hidden');
      btnReadCancel.disabled = true;
      addLog('Lectura cancelada', 'info');
      break;

    case 'read:start':
      readPendingEl.classList.add('hidden');
      btnReadCancel.disabled = true;
      updateStatus(true, 'Leyendo...', 'writing');
      addLog('Leyendo tarjeta UID: ' + data.uid, 'warn');
      break;

    case 'read:progress':
      addLog(data.step + (data.detail ? ' (' + data.detail + ')' : ''), 'info');
      break;

    case 'read:success':
      updateStatus(readerConnected, readerConnected ? 'Lector conectado' : 'Sin lector');
      if (data.url) {
        readResultEl.classList.remove('hidden');
        readEmptyEl.classList.add('hidden');
        readUrlEl.href = data.url;
        readUrlEl.textContent = data.url;
        readMetaEl.textContent =
          data.cardType + ' | UID: ' + data.uid + ' | ' + data.records + ' registro(s)';
        addLog('URL leida: ' + data.url + ' (' + data.cardType + ')', 'success');
      } else {
        readResultEl.classList.add('hidden');
        readEmptyEl.classList.remove('hidden');
        readEmptyMsgEl.textContent = data.message || 'Sin datos';
        addLog('Lectura: ' + (data.message || 'Sin URL'), 'warn');
      }
      break;

    case 'read:error':
      updateStatus(readerConnected, readerConnected ? 'Lector conectado' : 'Sin lector');
      readPendingEl.classList.add('hidden');
      btnReadCancel.disabled = true;
      addLog('Error de lectura: ' + data.error, 'error');
      break;

    case 'reader:error':
    case 'nfc:error':
      addLog('Error NFC: ' + data.error, 'error');
      break;
  }
}

// Form handlers
urlForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var url = urlInput.value.trim();
  if (!url) return;

  fetch('/api/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      if (data.error) {
        addLog('Error: ' + data.error, 'error');
      } else {
        urlInput.value = '';
      }
    })
    .catch(function (err) {
      addLog('Error de red: ' + err.message, 'error');
    });
});

btnCancel.addEventListener('click', function () {
  fetch('/api/url', { method: 'DELETE' })
    .then(function (r) {
      return r.json();
    })
    .catch(function (err) {
      addLog('Error: ' + err.message, 'error');
    });
});

btnRead.addEventListener('click', function () {
  readResultEl.classList.add('hidden');
  readEmptyEl.classList.add('hidden');
  fetch('/api/read', { method: 'POST' })
    .then(function (r) {
      return r.json();
    })
    .catch(function (err) {
      addLog('Error: ' + err.message, 'error');
    });
});

btnReadCancel.addEventListener('click', function () {
  fetch('/api/read', { method: 'DELETE' })
    .then(function (r) {
      return r.json();
    })
    .catch(function (err) {
      addLog('Error: ' + err.message, 'error');
    });
});

// Fetch initial status
fetch('/api/status')
  .then(function (r) {
    return r.json();
  })
  .then(function (data) {
    handleEvent('status', data);
  });
