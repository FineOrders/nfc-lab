/**
 * Low-level NTAG/Ultralight commands via multiple tiers for maximum compatibility.
 * Supports standard PC/SC, ISO 7816, PC/SC Transparent Session, and PN532.
 */

// Debug logging helper (set NFC_DEBUG=1 to enable)
const DEBUG = process.env.NFC_DEBUG === '1';
function debugLog(...args) {
  if (DEBUG) console.log('[ntag-commands]', ...args);
}

// Helper to delay for retry logic
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write 4 bytes to a page with automatic verification.
 * Tries multiple approaches in order:
 * 1. nfc-pcsc built-in reader.write() (Standard PC/SC)
 * 2. Standard UPDATE BINARY APDU (FF D6)
 * 3. Standard UPDATE BINARY APDU (00 D6)
 * 4. Vendor-specific WRITE APDU (FF D7)
 * 5. PC/SC Transparent Session (Direct Tag Access)
 * 6. ENVELOPE APDU (Pass-through)
 * 7. PN532 InDataExchange (ACR122U specific)
 * 8. CCID Escape (Vendor-specific IOCTL)
 *
 * Includes automatic retry logic (up to 2 retries with 50ms backoff).
 */
async function writePage(reader, page, data, retries = 2) {
  if (data.length !== 4) {
    throw new Error(`writePage requires exactly 4 bytes, got ${data.length}`);
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      debugLog(
        `Write retry ${attempt}/${retries} for page ${page} after error:`,
        lastError?.message
      );
      await delay(50 * attempt); // Progressive backoff: 50ms, 100ms
    }

    try {
      await _writePageAttempt(reader, page, data);

      // Immediate verification: read back and compare
      // Small delay to allow EEPROM to settle (NTAG write time ~3.5ms)
      await delay(10);

      try {
        const actual = await readPage(reader, page, 0); // No retries on read during write verification
        if (data.compare(actual) === 0) {
          debugLog(`Page ${page} write verified successfully`);
          return true;
        } else {
          lastError = new Error(
            `Page ${page} verification failed: wrote ${data.toString('hex')}, read ${actual.toString('hex')}`
          );
          debugLog(lastError.message);
          // Fall through to retry
        }
      } catch (readErr) {
        // Verification read failed - treat as verification failure
        lastError = new Error(`Page ${page} verification read failed: ${readErr.message}`);
        debugLog(lastError.message);
        // Fall through to retry
      }
    } catch (err) {
      lastError = err;
      // If it's the last attempt, throw
      if (attempt === retries) {
        throw err;
      }
    }
  }

  throw lastError;
}

/**
 * Single attempt to write a page (internal helper).
 */
async function _writePageAttempt(reader, page, data) {
  // --- TIER 1: Standard nfc-pcsc write ---
  try {
    await reader.write(page, data, 4);
    debugLog(`Page ${page} written via [Tier 1: reader.write()]`);
    return true;
  } catch (err) {
    debugLog(`Page ${page} [Tier 1: reader.write()] failed:`, err.message);
  }

  // --- TIER 2: Standard UPDATE BINARY (FF D6) ---
  try {
    const cmd = Buffer.from([0xff, 0xd6, 0x00, page, 0x04, ...data]);
    const resp = await reader.transmit(cmd, 10);
    if (resp && resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
      debugLog(`Page ${page} written via [Tier 2: UPDATE BINARY FF D6]`);
      return true;
    }
    debugLog(`Page ${page} [Tier 2: UPDATE BINARY FF D6] failed:`, resp?.toString('hex'));
  } catch (err) {
    debugLog(`Page ${page} [Tier 2: UPDATE BINARY FF D6] failed:`, err.message);
  }

  // --- TIER 3: Standard UPDATE BINARY (00 D6) ---
  try {
    const cmd = Buffer.from([0x00, 0xd6, 0x00, page, 0x04, ...data]);
    const resp = await reader.transmit(cmd, 10);
    if (resp && resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
      debugLog(`Page ${page} written via [Tier 3: UPDATE BINARY 00 D6]`);
      return true;
    }
    debugLog(`Page ${page} [Tier 3: UPDATE BINARY 00 D6] failed:`, resp?.toString('hex'));
  } catch (err) {
    debugLog(`Page ${page} [Tier 3: UPDATE BINARY 00 D6] failed:`, err.message);
  }

  // --- TIER 4: Vendor WRITE (FF D7) ---
  try {
    const cmd = Buffer.from([0xff, 0xd7, 0x00, page, 0x04, ...data]);
    const resp = await reader.transmit(cmd, 10);
    if (resp && resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
      debugLog(`Page ${page} written via [Tier 4: VENDOR WRITE FF D7]`);
      return true;
    }
    debugLog(`Page ${page} [Tier 4: VENDOR WRITE FF D7] failed:`, resp?.toString('hex'));
  } catch (err) {
    debugLog(`Page ${page} [Tier 4: VENDOR WRITE FF D7] failed:`, err.message);
  }

  // --- TIER 5: PC/SC Transparent Session ---
  try {
    // 5a. Inline transparent exchange (PC/SC Part 3)
    const cmd = Buffer.from([0xff, 0xc2, 0x00, 0x00, 0x08, 0x5f, 0x47, 0x06, 0xa2, page, ...data]);
    const resp = await reader.transmit(cmd, 64);
    if (resp && resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
      debugLog(`Page ${page} written via [Tier 5a: Transparent Inline]`);
      return true;
    }
    debugLog(`Page ${page} [Tier 5a: Transparent Inline] failed:`, resp?.toString('hex'));

    // 5b. Explicit transparent session
    try {
      await reader.transmit(Buffer.from([0xff, 0xc2, 0x00, 0x00, 0x02, 0x01, 0x00]), 64);
      const exchange = Buffer.from([
        0xff,
        0xc2,
        0x00,
        0x02,
        0x08,
        0x5f,
        0x47,
        0x06,
        0xa2,
        page,
        ...data,
      ]);
      const exResp = await reader.transmit(exchange, 64);
      await reader.transmit(Buffer.from([0xff, 0xc2, 0x00, 0x01, 0x02, 0x01, 0x00]), 64);
      if (exResp && exResp.length >= 2 && exResp.subarray(-2).readUInt16BE(0) === 0x9000) {
        debugLog(`Page ${page} written via [Tier 5b: Transparent Session]`);
        return true;
      }
      debugLog(`Page ${page} [Tier 5b: Transparent Session] failed:`, exResp?.toString('hex'));
    } catch (inner) {
      debugLog(`Page ${page} [Tier 5b: Transparent Session] failed:`, inner.message);
    }
  } catch (err) {
    debugLog(`Page ${page} [Tier 5: Transparent] failed:`, err.message);
  }

  // --- TIER 6: ENVELOPE (FF C3) ---
  try {
    const cmd = Buffer.from([0xff, 0xc3, 0x00, 0x00, 0x06, 0xa2, page, ...data]);
    const resp = await reader.transmit(cmd, 64);
    if (resp && resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
      debugLog(`Page ${page} written via [Tier 6: ENVELOPE]`);
      return true;
    }
    debugLog(`Page ${page} [Tier 6: ENVELOPE] failed:`, resp?.toString('hex'));
  } catch (err) {
    debugLog(`Page ${page} [Tier 6: ENVELOPE] failed:`, err.message);
  }

  // --- TIER 7: PN532 InDataExchange ---
  try {
    const cmd = Buffer.from([0xff, 0x00, 0x00, 0x00, 0x07, 0xd4, 0x42, 0xa2, page, ...data]);
    const resp = await reader.transmit(cmd, 16);
    // Framed response: D5 43 00 ... (valid PN532 response)
    if (resp.length >= 3 && resp[0] === 0xd5 && resp[1] === 0x43 && resp[2] === 0x00) {
      debugLog(`Page ${page} written via [Tier 7: PN532 Framed]`);
      return true;
    }
    // Standard response: 9000 (WARNING: may be false positive on non-PN532 readers)
    if (resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
      debugLog(
        `Page ${page} written via [Tier 7: PN532 SW 9000] (UNVERIFIED - may be false positive on non-PN532 readers)`
      );
      return true;
    }
    debugLog(`Page ${page} [Tier 7: PN532] failed: unexpected response ${resp.toString('hex')}`);
  } catch (err) {
    debugLog(`Page ${page} [Tier 7: PN532] failed:`, err.message);
  }

  // --- TIER 8: CCID Escape (control) ---
  try {
    const cmd = Buffer.from([0xa2, page, ...data]);
    const resp = await reader.control(cmd, 64);
    if (resp && resp.length > 0) {
      debugLog(`Page ${page} written via [Tier 8: CCID Escape]`);
      return true;
    }
    debugLog(`Page ${page} [Tier 8: CCID Escape] failed: empty or no response`);
  } catch (err) {
    debugLog(`Page ${page} [Tier 8: CCID Escape] failed:`, err.message);
  }

  throw new Error(`All write methods failed for page ${page}`);
}

/**
 * Read a single page (4 bytes).
 * Tries multiple approaches in order:
 * 1. nfc-pcsc built-in reader.read()
 * 2. Standard READ BINARY APDU (FF B0)
 * 3. Standard READ BINARY APDU (00 B0)
 * 4. PC/SC Transparent Session
 * 5. PN532 InDataExchange (0x30)
 *
 * Includes automatic retry logic (up to 2 retries with 50ms backoff).
 */
async function readPage(reader, page, retries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      debugLog(`Retry ${attempt}/${retries} for page ${page} after error:`, lastError?.message);
      await delay(50 * attempt); // Progressive backoff: 50ms, 100ms
    }

    try {
      return await _readPageAttempt(reader, page);
    } catch (err) {
      lastError = err;
      // If it's the last attempt, throw
      if (attempt === retries) {
        throw err;
      }
    }
  }

  throw lastError;
}

/**
 * Single attempt to read a page (internal helper).
 */
async function _readPageAttempt(reader, page) {
  // --- TIER 1: Standard nfc-pcsc read ---
  try {
    const data = await reader.read(page, 4, 4);
    if (data && data.length >= 4) {
      debugLog(
        `Page ${page} read via [Tier 1: reader.read()]:`,
        data.subarray(0, 4).toString('hex')
      );
      return data.subarray(0, 4);
    }
  } catch (err) {
    debugLog(`Page ${page} [Tier 1: reader.read()] failed:`, err.message);
  }

  // --- TIER 2: Standard READ BINARY (FF B0) ---
  try {
    const cmd = Buffer.from([0xff, 0xb0, 0x00, page, 0x10]); // Le=0x10 (16 bytes)
    const resp = await reader.transmit(cmd, 20);
    if (resp && resp.length >= 6 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
      debugLog(
        `Page ${page} read via [Tier 2: READ BINARY FF B0]:`,
        resp.subarray(0, 4).toString('hex')
      );
      return resp.subarray(0, 4);
    }
  } catch (err) {
    debugLog(`Page ${page} [Tier 2: READ BINARY FF B0] failed:`, err.message);
  }

  // --- TIER 3: Standard READ BINARY (00 B0) ---
  try {
    const cmd = Buffer.from([0x00, 0xb0, 0x00, page, 0x10]);
    const resp = await reader.transmit(cmd, 20);
    if (resp && resp.length >= 6 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
      debugLog(
        `Page ${page} read via [Tier 3: READ BINARY 00 B0]:`,
        resp.subarray(0, 4).toString('hex')
      );
      return resp.subarray(0, 4);
    }
  } catch (err) {
    debugLog(`Page ${page} [Tier 3: READ BINARY 00 B0] failed:`, err.message);
  }

  // --- TIER 4: PC/SC Transparent Session ---
  try {
    const cmd = Buffer.from([0xff, 0xc2, 0x00, 0x00, 0x04, 0x5f, 0x47, 0x02, 0x30, page]);
    const resp = await reader.transmit(cmd, 64);
    // Find Tag 5F48 (Transparent Response)
    if (resp && resp.length >= 8) {
      const dataOffset = resp.indexOf(Buffer.from([0x5f, 0x48]));
      if (dataOffset !== -1) {
        const len = resp[dataOffset + 2];
        const data = resp.subarray(dataOffset + 3, dataOffset + 3 + len);
        if (data.length >= 4) {
          debugLog(
            `Page ${page} read via [Tier 4: Transparent]:`,
            data.subarray(0, 4).toString('hex')
          );
          return data.subarray(0, 4);
        }
      }
    }
  } catch (err) {
    debugLog(`Page ${page} [Tier 4: Transparent] failed:`, err.message);
  }

  // --- TIER 5: PN532 InDataExchange ---
  try {
    const cmd = Buffer.from([0xff, 0x00, 0x00, 0x00, 0x04, 0xd4, 0x42, 0x30, page]);
    const resp = await reader.transmit(cmd, 32);
    // Framed: D5 43 00 [data] 90 00
    if (resp.length >= 7 && resp[0] === 0xd5 && resp[1] === 0x43 && resp[2] === 0x00) {
      const data = resp.subarray(3, resp.length - 2);
      debugLog(
        `Page ${page} read via [Tier 5: PN532 Framed]:`,
        data.subarray(0, 4).toString('hex')
      );
      return data.subarray(0, 4);
    }
    // Generic SW 9000
    if (resp.length >= 6 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
      const data = resp.subarray(0, resp.length - 2);
      debugLog(
        `Page ${page} read via [Tier 5: PN532 SW 9000]:`,
        data.subarray(0, 4).toString('hex')
      );
      return data.subarray(0, 4);
    }
  } catch (err) {
    debugLog(`Page ${page} [Tier 5: PN532] failed:`, err.message);
  }

  throw new Error(`All read methods failed for page ${page}`);
}

module.exports = { readPage, writePage };
