const { NFC } = require('nfc-pcsc');

const nfc = new NFC();

nfc.on('reader', (reader) => {
  console.log(`Reader conectado: ${reader.name}`);

  reader.on('card', (card) => {
    console.log('Tarjeta detectada!');
  });
});
