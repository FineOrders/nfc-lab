/**
 * Wrap raw NDEF message bytes in TLV format for NFC tags.
 * Format: [0x03] [length] [NDEF bytes] [0xFE]
 */
function wrapNdefTlv(ndefBytes) {
  const len = ndefBytes.length;

  if (len < 0xff) {
    // Short format: 1-byte length
    const tlv = Buffer.alloc(1 + 1 + len + 1);
    tlv[0] = 0x03; // NDEF Message TLV
    tlv[1] = len;
    Buffer.from(ndefBytes).copy(tlv, 2);
    tlv[2 + len] = 0xfe; // Terminator TLV
    return tlv;
  } else {
    // Long format: 3-byte length (0xFF + 2-byte big-endian)
    const tlv = Buffer.alloc(1 + 3 + len + 1);
    tlv[0] = 0x03;
    tlv[1] = 0xff;
    tlv[2] = (len >> 8) & 0xff;
    tlv[3] = len & 0xff;
    Buffer.from(ndefBytes).copy(tlv, 4);
    tlv[4 + len] = 0xfe;
    return tlv;
  }
}

/**
 * Unwrap TLV to extract NDEF message bytes.
 * Returns the raw NDEF bytes or null if not found.
 */
function unwrapNdefTlv(buffer) {
  let offset = 0;

  while (offset < buffer.length) {
    const type = buffer[offset];

    if (type === 0x00) {
      // NULL TLV - skip
      offset++;
      continue;
    }

    if (type === 0xfe) {
      // Terminator
      return null;
    }

    // Read length
    let len;
    offset++;
    if (buffer[offset] === 0xff) {
      len = (buffer[offset + 1] << 8) | buffer[offset + 2];
      offset += 3;
    } else {
      len = buffer[offset];
      offset++;
    }

    if (type === 0x03) {
      // NDEF Message TLV
      return buffer.subarray(offset, offset + len);
    }

    // Skip unknown TLV
    offset += len;
  }

  return null;
}

module.exports = { wrapNdefTlv, unwrapNdefTlv };
