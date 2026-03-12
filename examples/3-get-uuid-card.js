const { NFC } = require('nfc-pcsc');
const ndef = require('ndef');

const nfc = new NFC();

nfc.on('reader', (reader) => {
  console.log(`Reader conectado: ${reader.name}`);

  reader.on('card', async (card) => {
    console.log('Tarjeta detectada, UID:', card.uid);

    try {
      // 1️⃣ Crear mensaje NDEF
      const textRecord = ndef.textRecord('Hola NFC desde Node seguro!');
      const message = Buffer.from(ndef.encodeMessage([textRecord]));

      // 2️⃣ Padding al múltiplo de 4 bytes
      const blockSize = 4;
      const paddedLength = Math.ceil(message.length / blockSize) * blockSize;
      const buffer = Buffer.alloc(paddedLength, 0x00);
      message.copy(buffer);

      // 3️⃣ Escribir página por página
      const startPage = 4;
      const totalPages = paddedLength / 4;

      for (let i = 0; i < totalPages; i++) {
        const pageData = buffer.subarray(i * 4, (i + 1) * 4);
        await reader.write(startPage + i, pageData, 4);
      }

      console.log('Mensaje NDEF escrito correctamente ✅');
    } catch (err) {
      console.error('Error escribiendo:', err);
    }
  });

  reader.on('error', (err) => {
    console.error('Error lector:', err);
  });
});

nfc.on('error', (err) => {
  console.error('Error NFC:', err);
});
