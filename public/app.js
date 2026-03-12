const logEl = document.getElementById('log');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
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
const btnClearLog = document.getElementById('btn-clear-log');
const historyList = document.getElementById('history-list');

// New elements for tabs
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const writeForms = document.querySelectorAll('.write-form');
const exampleBtns = document.querySelectorAll('.btn-example');

let readerConnected = false;
let executionCount = 0;

// Examples data
const EXAMPLES = {
  url: { url: 'https://github.com/osamamoussatil' },
  text: { text: '¡Hola! Esta es una tarjeta NFC configurada con NFC Lab 🧪', language: 'es' },
  vcard: {
    name: 'Osama Moussatil',
    phone: '+34 600 000 000',
    email: 'osama@ejemplo.com',
    org: 'NFC Lab OpenCode',
  },
  sms: { phone: '+34 600 000 000', message: 'Enviado desde mi etiqueta NFC' },
  phone: { phone: '+34 600 000 000' },
  email: {
    to: 'hola@ejemplo.com',
    subject: 'Contacto NFC',
    body: 'Hola, te escribo desde mi tarjeta NFC.',
  },
};

function addLog(text, type) {
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + (type || 'info');
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = '<span class="time">' + time + '</span>' + text;
  logEl.prepend(entry);
}

function addHistoryEntry(type, status, data) {
  executionCount++;
  if (executionCount === 1) {
    historyList.innerHTML = '';
  }

  const card = document.createElement('div');
  card.className = `history-card ${status}`;

  const time = new Date().toLocaleTimeString();
  let content = `
    <div class="type">
      <span>#${executionCount} ${type}</span>
      <span class="time">${time}</span>
    </div>
  `;

  if (status === 'success') {
    if (data.url) {
      content += `<div class="url">${data.url}</div>`;
    } else if (type === 'READ') {
      content += `<div class="err-msg">Sin datos (NDEF vacío)</div>`;
    }

    content += `
      <div class="uid">UID: ${data.uid || 'Desconocido'}</div>
      <div class="meta">${data.cardType || 'NFC'} | ${status.toUpperCase()}</div>
    `;
  } else {
    content += `
      <div class="err-msg">Error: ${data.error || 'Operación fallida'}</div>
      <div class="uid">UID: ${data.uid || 'Desconocido'}</div>
    `;
  }

  card.innerHTML = content;
  historyList.prepend(card);
}

function updateStatus(connected, text, dotClass) {
  statusDot.className = 'dot ' + (dotClass || (connected ? 'connected' : ''));
  statusText.textContent = text;
}

function showPending(data) {
  if (data) {
    // data can be just a URL string (old API) or an object (new API)
    const display = typeof data === 'string' ? data : data.url;
    pendingUrlEl.textContent = display;
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
      showPending(data.pendingWrite || data.pendingUrl);
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
      addLog(
        'Escribiendo ' + (data.type || 'datos') + ': ' + data.url + ' en UID: ' + data.uid,
        'warn'
      );
      break;

    case 'write:progress':
      addLog(data.step + (data.detail ? ' (' + data.detail + ')' : ''), 'info');
      break;

    case 'write:success': {
      updateStatus(true, 'Lector: ' + (data.cardType || 'conectado'));
      const writeDetails = data.bytesWritten
        ? ` [${data.bytesWritten} bytes, ${data.pagesWritten} pags]`
        : '';
      addLog(
        'Escritura exitosa (' + (data.type || 'NDEF') + ') - ' + data.url + writeDetails,
        'success'
      );
      if (data.warning) {
        addLog('ADVERTENCIA: ' + data.warning, 'warn');
      }
      addHistoryEntry('WRITE', 'success', data);
      showPending(null);
      break;
    }

    case 'write:error':
      updateStatus(true, 'Error de escritura', 'error');
      addLog('Error: ' + data.error, 'error');
      addHistoryEntry('WRITE', 'error', data);
      break;

    case 'url:set':
      showPending(data);
      addLog('Escritura preparada (' + (data.type || 'url') + '): ' + (data.url || data), 'info');
      break;

    case 'url:clear':
      showPending(null);
      addLog('Escritura pendiente cancelada', 'info');
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
        readUrlEl.textContent = data.url;
        readMetaEl.textContent =
          data.cardType + ' | UID: ' + data.uid + ' | ' + data.records + ' registro(s)';
        addLog('Lectura exitosa: ' + data.url, 'success');
      } else {
        readResultEl.classList.add('hidden');
        readEmptyEl.classList.remove('hidden');
        readEmptyMsgEl.textContent = data.message || 'Sin datos';
        addLog('Lectura: ' + (data.message || 'Sin datos'), 'warn');
      }
      addHistoryEntry('READ', 'success', data);
      break;

    case 'read:error':
      updateStatus(readerConnected, readerConnected ? 'Lector conectado' : 'Sin lector');
      readPendingEl.classList.add('hidden');
      btnReadCancel.disabled = true;
      addLog('Error de lectura: ' + data.error, 'error');
      addHistoryEntry('READ', 'error', data);
      break;

    case 'reader:error':
    case 'nfc:error':
      addLog('Error NFC: ' + data.error, 'error');
      break;
  }
}

// Tab Switching
tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;

    // Update buttons
    tabBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    // Update panels
    tabPanels.forEach((p) => {
      p.classList.remove('active');
      if (p.id === `panel-${tab}`) p.classList.add('active');
    });
  });
});

// Example Loading
exampleBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const form = btn.closest('form');
    const type = form.dataset.type;
    const example = EXAMPLES[type];

    if (type === 'url') {
      document.getElementById('url-input').value = example.url;
    } else if (type === 'text') {
      document.getElementById('text-input').value = example.text;
      document.getElementById('text-lang').value = example.language;
    } else if (type === 'vcard') {
      document.getElementById('vcard-name').value = example.name;
      document.getElementById('vcard-phone').value = example.phone;
      document.getElementById('vcard-email').value = example.email;
      document.getElementById('vcard-org').value = example.org;
    } else if (type === 'sms') {
      document.getElementById('sms-phone').value = example.phone;
      document.getElementById('sms-message').value = example.message;
    } else if (type === 'phone') {
      document.getElementById('phone-input').value = example.phone;
    } else if (type === 'email') {
      document.getElementById('email-to').value = example.to;
      document.getElementById('email-subject').value = example.subject;
      document.getElementById('email-body').value = example.body;
    }
  });
});

// Form Submissions
writeForms.forEach((form) => {
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const type = form.dataset.type;
    let payload = {};

    if (type === 'url') {
      payload.url = document.getElementById('url-input').value.trim();
    } else if (type === 'text') {
      payload.text = document.getElementById('text-input').value.trim();
      payload.language = document.getElementById('text-lang').value;
    } else if (type === 'vcard') {
      payload.name = document.getElementById('vcard-name').value.trim();
      payload.phone = document.getElementById('vcard-phone').value.trim();
      payload.email = document.getElementById('vcard-email').value.trim();
      payload.org = document.getElementById('vcard-org').value.trim();
    } else if (type === 'sms') {
      payload.phone = document.getElementById('sms-phone').value.trim();
      payload.message = document.getElementById('sms-message').value.trim();
    } else if (type === 'phone') {
      payload.phone = document.getElementById('phone-input').value.trim();
    } else if (type === 'email') {
      payload.to = document.getElementById('email-to').value.trim();
      payload.subject = document.getElementById('email-subject').value.trim();
      payload.body = document.getElementById('email-body').value.trim();
    }

    fetch('/api/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          addLog('Error: ' + data.error, 'error');
        } else {
          // Success handled via WS
        }
      })
      .catch((err) => {
        addLog('Error de red: ' + err.message, 'error');
      });
  });
});

btnCancel.addEventListener('click', function () {
  fetch('/api/write', { method: 'DELETE' })
    .then((r) => r.json())
    .catch((err) => {
      addLog('Error: ' + err.message, 'error');
    });
});

btnRead.addEventListener('click', function () {
  readResultEl.classList.add('hidden');
  readEmptyEl.classList.add('hidden');
  fetch('/api/read', { method: 'POST' })
    .then((r) => r.json())
    .catch((err) => {
      addLog('Error: ' + err.message, 'error');
    });
});

btnReadCancel.addEventListener('click', function () {
  fetch('/api/read', { method: 'DELETE' })
    .then((r) => r.json())
    .catch((err) => {
      addLog('Error: ' + err.message, 'error');
    });
});

btnClearLog.addEventListener('click', function () {
  logEl.innerHTML = '';
  addLog('Log limpiado', 'info');
});

// Fetch initial status
fetch('/api/status')
  .then((r) => r.json())
  .then((data) => {
    handleEvent('status', data);
  });
