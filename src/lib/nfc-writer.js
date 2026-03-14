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
    this.pendingWrite = null; // { type, payload }
    this.isWriting = false;
    this.readPending = false;
    this.readerConnected = false;
    this.readerName = null;
    this._init();
  }

  // Getter for backward compatibility
  get pendingUrl() {
    return this.pendingWrite && this.pendingWrite.type === 'url'
      ? this.pendingWrite.payload.url
      : null;
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

        if (!this.pendingWrite) {
          this.emit('card:idle', { uid: card.uid, message: 'Nada pendiente para escribir' });
          return;
        }

        if (this.isWriting) {
          this.emit('card:busy', { message: 'Escritura en progreso' });
          return;
        }

        await this._writeData(reader, card);
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

  _encodeTextPayload(text, language) {
    // Custom UTF-8 safe text encoder (fixes ndef library UTF-8 multibyte bug)
    const lang = language || 'en';
    const langBytes = Buffer.from(lang, 'utf8');
    const textBytes = Buffer.from(text, 'utf8');

    // Status byte: UTF-8 encoding (bit 7 = 0) + language code length (bits 0-5)
    const statusByte = langBytes.length & 0x3f;

    // Payload: [status byte] [language code bytes] [text bytes]
    const payload = Buffer.alloc(1 + langBytes.length + textBytes.length);
    payload[0] = statusByte;
    langBytes.copy(payload, 1);
    textBytes.copy(payload, 1 + langBytes.length);

    return Array.from(payload);
  }

  _buildNdefRecord(type, payload) {
    switch (type) {
      case 'url':
        return ndef.uriRecord(payload.url);
      case 'text':
        // Use custom encoder instead of ndef.textRecord to fix UTF-8 multibyte bug
        return ndef.record(
          ndef.TNF_WELL_KNOWN,
          ndef.RTD_TEXT,
          [],
          this._encodeTextPayload(payload.text, payload.language || 'en')
        );
      case 'phone':
        return ndef.uriRecord(`tel:${payload.phone}`);
      case 'sms':
        return ndef.uriRecord(
          `sms:${payload.phone}?body=${encodeURIComponent(payload.message || '')}`
        );
      case 'email': {
        const query = [];
        if (payload.subject) query.push(`subject=${encodeURIComponent(payload.subject)}`);
        if (payload.body) query.push(`body=${encodeURIComponent(payload.body)}`);
        const queryString = query.length > 0 ? `?${query.join('&')}` : '';
        return ndef.uriRecord(`mailto:${payload.to}${queryString}`);
      }
      case 'vcard': {
        const vcard = [
          'BEGIN:VCARD',
          'VERSION:3.0',
          `FN:${payload.name}`,
          `N:${payload.name.split(' ').reverse().join(';')};;;`,
          payload.org ? `ORG:${payload.org}` : '',
          payload.phone ? `TEL;TYPE=CELL:${payload.phone}` : '',
          payload.email ? `EMAIL;TYPE=INTERNET:${payload.email}` : '',
          'END:VCARD',
        ]
          .filter(Boolean)
          .join('\r\n');
        return ndef.mimeMediaRecord('text/vcard', Buffer.from(vcard));
      }
      default:
        throw new Error(`Tipo de registro no soportado: ${type}`);
    }
  }

  async _writeData(reader, card) {
    this.isWriting = true;
    const { type, payload } = this.pendingWrite;
    const displayValue =
      payload.url || payload.text || payload.name || payload.phone || payload.to || 'datos';

    try {
      // Step 1: Detect card type
      this.emit('write:start', { uid: card.uid, type, url: displayValue });
      const cardInfo = await detectCardType(reader);
      this.emit('write:progress', {
        step: 'Tipo de tarjeta detectado',
        detail: `${cardInfo.type}, CC init: ${cardInfo.ccInitialized}`,
      });

      // Step 2: Initialize CC if needed
      if (!cardInfo.ccInitialized) {
        this.emit('write:progress', { step: 'Inicializando Capability Container' });
        await writePage(reader, 3, cardInfo.ccBytes);
        this.emit('write:progress', {
          step: 'CC inicializado',
          detail: cardInfo.ccBytes.toString('hex'),
        });
      }

      // Step 3: Create NDEF record
      const record = this._buildNdefRecord(type, payload);
      const ndefMessage = Buffer.from(ndef.encodeMessage([record]));
      this.emit('write:progress', {
        step: `NDEF ${type.toUpperCase()} creado`,
        detail: `${ndefMessage.length} bytes`,
      });

      // Step 4: Wrap in TLV
      const tlvData = wrapNdefTlv(ndefMessage);
      this.emit('write:progress', { step: 'TLV envuelto', detail: `${tlvData.length} bytes` });

      // Step 5: Validate size
      if (tlvData.length > cardInfo.userBytes) {
        throw new Error(
          `Datos demasiado largos: ${tlvData.length} bytes > ${cardInfo.userBytes} bytes disponibles`
        );
      }

      // Step 6: Pad to multiple of 4 bytes
      const paddedLength = Math.ceil(tlvData.length / 4) * 4;
      const buffer = Buffer.alloc(paddedLength, 0x00);
      tlvData.copy(buffer);

      const dataPages = paddedLength / 4;
      const startPage = cardInfo.userStartPage;

      // Step 7: Write data pages
      for (let i = 0; i < dataPages; i++) {
        const page = startPage + i;
        if (page > cardInfo.userEndPage) {
          throw new Error(`Datos exceden memoria: pagina ${page} > limite ${cardInfo.userEndPage}`);
        }
        const pageData = buffer.subarray(i * 4, (i + 1) * 4);
        await writePage(reader, page, pageData);
      }

      // Step 8: Zero-fill a few extra pages
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

      // Step 9: Verify
      this.emit('write:progress', { step: 'Verificando escritura...' });
      // Increased settle delay to 250ms to allow NTAG internal write completion
      // NTAG EEPROM write time is ~4ms per page, but bus latency can add delay
      await new Promise((r) => setTimeout(r, 250));

      let verified = true;
      let verifyError = null;
      for (let i = 0; i < dataPages; i++) {
        const page = startPage + i;
        const expected = buffer.subarray(i * 4, (i + 1) * 4);

        // Retry verification up to 2 times for each page
        let pageVerified = false;
        let lastReadError = null;

        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const actual = await readPage(reader, page);
            if (expected.compare(actual) === 0) {
              pageVerified = true;
              break;
            } else {
              lastReadError = `Pagina ${page}: esperado ${expected.toString('hex')}, leido ${actual.toString('hex')}`;
              // Data mismatch - wait before retry
              if (attempt < 1) {
                await new Promise((r) => setTimeout(r, 50));
              }
            }
          } catch (readErr) {
            lastReadError = readErr.message;
            // Read error - wait before retry
            if (attempt < 1) {
              await new Promise((r) => setTimeout(r, 50));
            }
          }
        }

        if (!pageVerified) {
          verified = false;
          verifyError = lastReadError;
          break;
        }
      }

      this.pendingWrite = null;
      if (verified) {
        this.emit('write:success', {
          uid: card.uid,
          url: displayValue,
          type,
          cardType: cardInfo.type,
          bytesWritten: tlvData.length,
          pagesWritten: dataPages,
        });
      } else {
        this.emit('write:success', {
          uid: card.uid,
          url: displayValue,
          type,
          cardType: cardInfo.type,
          bytesWritten: tlvData.length,
          pagesWritten: dataPages,
          warning: `Escritura completada pero verificacion falló: ${verifyError}`,
        });
      }
    } catch (err) {
      this.emit('write:error', { uid: card.uid, url: displayValue, type, error: err.message });
    } finally {
      this.isWriting = false;
    }
  }

  async _readTag(reader, card) {
    this.readPending = false;
    this.emit('read:start', { uid: card.uid });

    try {
      await new Promise((r) => setTimeout(r, 150));
      const cardInfo = await detectCardType(reader);
      this.emit('read:progress', { step: 'Tarjeta detectada', detail: cardInfo.type });

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
        .subarray(0, Math.min(64, rawData.length))
        .toString('hex')
        .match(/.{1,2}/g)
        .join(' ');
      this.emit('read:progress', {
        step: 'Datos leidos',
        detail: `${rawData.length} bytes, ${pages.length} paginas`,
      });
      this.emit('read:progress', {
        step: 'Primeros bytes (hex)',
        detail: hexPreview,
      });

      const ndefBytes = unwrapNdefTlv(rawData);

      if (!ndefBytes || ndefBytes.length === 0) {
        // Enhanced debug info for empty NDEF
        const hexDump = rawData
          .subarray(0, 64)
          .toString('hex')
          .match(/.{1,2}/g)
          .join(' ');
        this.emit('read:success', {
          uid: card.uid,
          cardType: cardInfo.type,
          url: null,
          message: `Tarjeta sin datos NDEF válidos. Raw: ${hexDump}`,
        });
        return;
      }

      this.emit('read:progress', {
        step: 'NDEF TLV extraído',
        detail: `${ndefBytes.length} bytes NDEF`,
      });

      const records = ndef.decodeMessage(Array.from(ndefBytes));
      let displayUrl = null;

      for (const record of records) {
        if (record.tnf === ndef.TNF_WELL_KNOWN) {
          const typeStr = String.fromCharCode.apply(null, record.type);
          if (typeStr === 'U') {
            displayUrl = ndef.uri.decodePayload(record.payload);
          } else if (typeStr === 'T') {
            // Custom UTF-8 safe text decoder
            const payload = Buffer.from(record.payload);
            const statusByte = payload[0];
            const languageCodeLength = statusByte & 0x3f;
            const textBytes = payload.slice(1 + languageCodeLength);
            displayUrl = textBytes.toString('utf8');
          }
        } else if (record.tnf === ndef.TNF_MIME_MEDIA) {
          const typeStr = String.fromCharCode.apply(null, record.type);
          if (typeStr === 'text/vcard') {
            displayUrl = 'Tarjeta de contacto (vCard)';
          }
        }
        if (displayUrl) break;
      }

      this.emit('read:success', {
        uid: card.uid,
        cardType: cardInfo.type,
        url: displayUrl,
        records: records.length,
        message: displayUrl ? 'Datos encontrados' : 'NDEF sin datos reconocibles',
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

  setWriteData(type, payload) {
    this.pendingWrite = { type, payload };
    const displayValue =
      payload.url || payload.text || payload.name || payload.phone || payload.to || 'datos';
    this.emit('url:set', { type, url: displayValue });
  }

  clearWriteData() {
    this.pendingWrite = null;
    this.emit('url:clear', {});
  }

  // Backward compatibility
  setUrl(url) {
    this.setWriteData('url', { url });
  }

  clearUrl() {
    this.clearWriteData();
  }

  getStatus() {
    return {
      readerConnected: this.readerConnected,
      readerName: this.readerName,
      pendingUrl: this.pendingUrl, // for compatibility
      pendingWrite: this.pendingWrite,
      isWriting: this.isWriting,
      readPending: this.readPending,
    };
  }
}

module.exports = { NfcWriter };
