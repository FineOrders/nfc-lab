/**
 * Low-level NTAG/Ultralight commands via ACR122U pseudo-APDU (direct transmit).
 * These bypass nfc-pcsc's reader.read()/write() which use standard APDU commands
 * (READ BINARY 0xB0 / UPDATE BINARY 0xD6) that fail on many reader+NTAG combos.
 */

/**
 * Write 4 bytes to a page using NTAG WRITE command (0xA2).
 */
async function writePage(reader, page, data) {
  const cmd = Buffer.from([
    0xff,
    0x00,
    0x00,
    0x00,
    0x07,
    0xd4,
    0x42,
    0xa2,
    page,
    data[0],
    data[1],
    data[2],
    data[3],
  ]);

  const response = await reader.transmit(cmd, 16);

  if (response.length >= 3 && response[0] === 0xd5 && response[1] === 0x43) {
    if (response[2] !== 0x00) {
      throw new Error(`WRITE failed on page ${page}: PN532 error 0x${response[2].toString(16)}`);
    }
    return true;
  }

  if (response.length >= 2) {
    const sw = response.subarray(-2).readUInt16BE(0);
    if (sw === 0x9000) return true;
    throw new Error(`WRITE failed on page ${page}: SW 0x${sw.toString(16)}`);
  }

  throw new Error(`WRITE failed on page ${page}: unexpected response ${response.toString('hex')}`);
}

/**
 * Read a single page (4 bytes).
 * Tries three approaches in order:
 * 1. nfc-pcsc built-in reader.read() (standard READ BINARY, most compatible for reads)
 * 2. Standard READ BINARY APDU with relaxed response parsing
 * 3. NTAG READ (0x30) via PN532 InDataExchange
 */
async function readPage(reader, page) {
  // 1. Try nfc-pcsc built-in read (handles response parsing internally)
  try {
    const data = await reader.read(page, 4, 4);
    if (data && data.length >= 4) {
      return data.subarray(0, 4);
    }
  } catch {
    // Built-in read failed, try manual approaches
  }

  // 2. Try standard READ BINARY APDU with relaxed parsing
  try {
    const stdCmd = Buffer.from([0xff, 0xb0, 0x00, page, 0x04]);
    const stdResp = await reader.transmit(stdCmd, 10);
    if (stdResp.length >= 6) {
      const sw = stdResp.subarray(-2).readUInt16BE(0);
      if (sw === 0x9000) {
        return stdResp.subarray(0, 4);
      }
    }
  } catch {
    // Standard APDU failed, try PN532 InDataExchange
  }

  // 3. Fallback: NTAG READ (0x30) via PN532
  const cmd = Buffer.from([0xff, 0x00, 0x00, 0x00, 0x04, 0xd4, 0x42, 0x30, page]);

  const response = await reader.transmit(cmd, 32);

  // PN532 framed response: D5 43 00 [16 bytes] 90 00
  if (response.length >= 5 && response[0] === 0xd5 && response[1] === 0x43) {
    if (response[2] !== 0x00) {
      throw new Error(`READ failed on page ${page}: PN532 error 0x${response[2].toString(16)}`);
    }
    const data = response.subarray(3, response.length - 2);
    if (data.length >= 4) {
      return data.subarray(0, 4);
    }
  }

  // Non-PN532 response with SW 9000 (some readers strip PN532 framing)
  if (response.length >= 6) {
    const sw = response.subarray(-2).readUInt16BE(0);
    if (sw === 0x9000) {
      const data = response.subarray(0, -2);
      if (data.length >= 4) {
        return data.subarray(0, 4);
      }
    }
  }

  throw new Error(`READ failed on page ${page}: unexpected response ${response.toString('hex')}`);
}

module.exports = { readPage, writePage };
