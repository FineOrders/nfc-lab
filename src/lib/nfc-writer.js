const { EventEmitter } = require('events');
const { NFC } = require('nfc-pcsc');
const ndef = require('ndef');
const { detectCardType } = require('./card-types');
const { wrapNdefTlv, unwrapNdefTlv } = require('./ndef-tlv');
const { readPage, writePage } = require('./ntag-commands');

class NfcWriter extends EventEmitter {
  constructor() {
    super();
    this.nfc = new NFC();
    this.pendingUrl = null;
    this.isWriting = false;
    this.readPending = false;
    this.readerConnected = false;
    this.readerName = null;
    this._init();
  }

  _init() {
    this.nfc.on('reader', (reader) => {
      this.readerConnected = true;
      this.readerName = reader.name;
      this.emit('reader:connect', { name: reader.name });

      reader.on('card', async (card) => {
        this.emit('card:detect', { uid: card.uid });

        if (this.readPending) {
          await this._readTag(reader, card);
          return;
        }

        if (!this.pendingUrl) {
          this.emit('card:idle', { uid: card.uid, message: 'No hay URL pendiente' });
          return;
        }

        if (this.isWriting) {
          this.emit('card:busy', { message: 'Escritura en progreso' });
          return;
        }

        await this._writeUrl(reader, card);
      });

      reader.on('card.off', (card) => {
        this.emit('card:remove', { uid: card.uid });
      });

      reader.on('error', (err) => {
        this.emit('reader:error', { error: err.message });
      });

      reader.on('end', () => {
        this.readerConnected = false;
        this.readerName = null;
        this.emit('reader:disconnect', { name: reader.name });
      });
    });

    this.nfc.on('error', (err) => {
      this.emit('nfc:error', { error: err.message });
    });
  }

  async _writeUrl(reader, card) {
    this.isWriting = true;
    const url = this.pendingUrl;

    try {
      // Step 1: Detect card type
      this.emit('write:start', { uid: card.uid, url });
      const cardInfo = await detectCardType(reader);
      this.emit('write:progress', {
        step: 'Tipo de tarjeta detectado',
        detail: `${cardInfo.type}, CC init: ${cardInfo.ccInitialized}`,
      });

      // Step 2: Initialize CC if needed (only on truly virgin cards)
      if (!cardInfo.ccInitialized) {
        this.emit('write:progress', { step: 'Inicializando Capability Container' });
        await writePage(reader, 3, cardInfo.ccBytes);
        this.emit('write:progress', {
          step: 'CC inicializado',
          detail: cardInfo.ccBytes.toString('hex'),
        });
      }

      // Step 3: Create NDEF URI record
      const uriRecord = ndef.uriRecord(url);
      const ndefMessage = Buffer.from(ndef.encodeMessage([uriRecord]));
      this.emit('write:progress', {
        step: 'NDEF URI creado',
        detail: `${ndefMessage.length} bytes`,
      });

      // Step 4: Wrap in TLV
      const tlvData = wrapNdefTlv(ndefMessage);
      this.emit('write:progress', { step: 'TLV envuelto', detail: `${tlvData.length} bytes` });

      // Step 5: Validate size
      if (tlvData.length > cardInfo.userBytes) {
        throw new Error(
          `URL demasiado larga: ${tlvData.length} bytes > ${cardInfo.userBytes} bytes disponibles`
        );
      }

      // Step 6: Pad to multiple of 4 bytes
      const paddedLength = Math.ceil(tlvData.length / 4) * 4;
      const buffer = Buffer.alloc(paddedLength, 0x00);
      tlvData.copy(buffer);

      const dataPages = paddedLength / 4;
      const startPage = cardInfo.userStartPage;

      // Step 7: Write data pages using raw NTAG WRITE command
      for (let i = 0; i < dataPages; i++) {
        const page = startPage + i;
        if (page > cardInfo.userEndPage) {
          throw new Error(`Datos exceden memoria: pagina ${page} > limite ${cardInfo.userEndPage}`);
        }
        const pageData = buffer.subarray(i * 4, (i + 1) * 4);
        await writePage(reader, page, pageData);
      }

      // Step 8: Zero-fill a few extra pages to erase old data (stop on first error)
      const extraPages = 8;
      let erasedPages = 0;
      for (let i = dataPages; i < dataPages + extraPages; i++) {
        const page = startPage + i;
        if (page > cardInfo.userEndPage) break;
        try {
          await writePage(reader, page, Buffer.alloc(4, 0x00));
          erasedPages++;
        } catch {
          break;
        }
      }

      this.emit('write:progress', {
        step: 'Datos escritos',
        detail: `${dataPages} paginas de datos + ${erasedPages} paginas borradas`,
      });

      // Step 9: Verify by reading back page by page
      this.emit('write:progress', { step: 'Verificando escritura...' });
      await new Promise((r) => setTimeout(r, 50));

      let verified = true;
      let verifyError = null;
      for (let i = 0; i < dataPages; i++) {
        const page = startPage + i;
        const expected = buffer.subarray(i * 4, (i + 1) * 4);
        try {
          const actual = await readPage(reader, page);
          if (expected.compare(actual) !== 0) {
            verified = false;
            verifyError = `Pagina ${page}: esperado ${expected.toString('hex')}, leido ${actual.toString('hex')}`;
            break;
          }
        } catch (readErr) {
          verified = false;
          verifyError = readErr.message;
          break;
        }
      }

      this.pendingUrl = null;
      if (verified) {
        this.emit('write:success', { uid: card.uid, url, cardType: cardInfo.type });
      } else {
        this.emit('write:success', {
          uid: card.uid,
          url,
          cardType: cardInfo.type,
          warning: `Escritura completada pero verificacion no disponible: ${verifyError}`,
        });
      }
    } catch (err) {
      this.emit('write:error', { uid: card.uid, url, error: err.message });
    } finally {
      this.isWriting = false;
    }
  }

  async _readTag(reader, card) {
    this.readPending = false;
    this.emit('read:start', { uid: card.uid });

    try {
      // Small delay to let the reader stabilize after card detection
      await new Promise((r) => setTimeout(r, 150));

      const cardInfo = await detectCardType(reader);
      this.emit('read:progress', { step: 'Tarjeta detectada', detail: cardInfo.type });

      // Read page by page using readPage (proven to work during write verification)
      const pages = [];
      for (let page = cardInfo.userStartPage; page <= cardInfo.userEndPage; page++) {
        let pageData = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            pageData = await readPage(reader, page);
            break;
          } catch {
            if (attempt === 0) await new Promise((r) => setTimeout(r, 50));
          }
        }
        if (!pageData) break;
        pages.push(pageData);

        // Stop early if we hit a terminator TLV (0xFE)
        if (pageData.indexOf(0xfe) !== -1) break;
      }

      if (pages.length === 0) {
        this.emit('read:success', {
          uid: card.uid,
          cardType: cardInfo.type,
          url: null,
          message: 'No se pudieron leer datos de la tarjeta',
        });
        return;
      }

      const rawData = Buffer.concat(pages);
      const hexPreview = rawData
        .subarray(0, 32)
        .toString('hex')
        .match(/.{1,2}/g)
        .join(' ');
      this.emit('read:progress', {
        step: 'Datos leidos',
        detail: `${rawData.length} bytes, ${pages.length} paginas`,
      });
      this.emit('read:progress', { step: 'Hex dump (primeros 32 bytes)', detail: hexPreview });

      const ndefBytes = unwrapNdefTlv(rawData);

      if (!ndefBytes || ndefBytes.length === 0) {
        this.emit('read:success', {
          uid: card.uid,
          cardType: cardInfo.type,
          url: null,
          message: 'Tarjeta sin datos NDEF. Hex: ' + hexPreview,
        });
        return;
      }

      // Decode NDEF message
      const records = ndef.decodeMessage(Array.from(ndefBytes));
      let url = null;

      for (const record of records) {
        if (record.tnf === ndef.TNF_WELL_KNOWN) {
          const typeStr = String.fromCharCode.apply(null, record.type);
          if (typeStr === 'U') {
            url = ndef.uri.decodePayload(record.payload);
          } else if (typeStr === 'T') {
            url = ndef.text.decodePayload(record.payload);
          }
          if (url) break;
        }
      }

      this.emit('read:success', {
        uid: card.uid,
        cardType: cardInfo.type,
        url: url,
        records: records.length,
        message: url ? 'URL encontrada' : 'NDEF sin URL',
      });
    } catch (err) {
      this.emit('read:error', { uid: card.uid, error: err.message });
    }
  }

  requestRead() {
    this.readPending = true;
    this.emit('read:pending', {});
  }

  cancelRead() {
    this.readPending = false;
    this.emit('read:cancel', {});
  }

  setUrl(url) {
    this.pendingUrl = url;
    this.emit('url:set', { url });
  }

  clearUrl() {
    this.pendingUrl = null;
    this.emit('url:clear', {});
  }

  getStatus() {
    return {
      readerConnected: this.readerConnected,
      readerName: this.readerName,
      pendingUrl: this.pendingUrl,
      isWriting: this.isWriting,
      readPending: this.readPending,
    };
  }
}

module.exports = { NfcWriter };
