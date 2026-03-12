const { NFC } = require('nfc-pcsc');

const nfc = new NFC();

nfc.on('reader', (reader) => {
  console.log('Lector detectado:', reader.name);
});

nfc.on('error', (err) => {
  console.error('Error NFC:', err);
});
