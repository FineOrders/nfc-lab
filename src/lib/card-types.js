const { readPage } = require('./ntag-commands');

const CARD_TYPES = {
  ULTRALIGHT: {
    type: 'MIFARE Ultralight',
    userStartPage: 4,
    userEndPage: 15,
    userBytes: 48,
    ccBytes: Buffer.from([0xe1, 0x10, 0x06, 0x00]),
  },
  NTAG213: {
    type: 'NTAG213',
    userStartPage: 4,
    userEndPage: 39,
    userBytes: 144,
    ccBytes: Buffer.from([0xe1, 0x10, 0x12, 0x00]),
  },
  NTAG215: {
    type: 'NTAG215',
    userStartPage: 4,
    userEndPage: 129,
    userBytes: 504,
    ccBytes: Buffer.from([0xe1, 0x10, 0x3e, 0x00]),
  },
  NTAG216: {
    type: 'NTAG216',
    userStartPage: 4,
    userEndPage: 225,
    userBytes: 888,
    ccBytes: Buffer.from([0xe1, 0x10, 0x6d, 0x00]),
  },
};

// Map CC byte 2 (size byte) to card type
const SIZE_BYTE_MAP = {
  0x06: CARD_TYPES.ULTRALIGHT,
  0x12: CARD_TYPES.NTAG213,
  0x3e: CARD_TYPES.NTAG215,
  0x6d: CARD_TYPES.NTAG216,
};

async function detectCardType(reader) {
  try {
    // Read page 3 (Capability Container)
    const cc = await readPage(reader, 3);
    const isAllZeros = cc[0] === 0 && cc[1] === 0 && cc[2] === 0 && cc[3] === 0;

    // If CC starts with 0xE1, detect type from size byte
    if (cc[0] === 0xe1) {
      const sizeByte = cc[2];
      const cardType = SIZE_BYTE_MAP[sizeByte];
      if (cardType) {
        return { ...cardType, ccInitialized: true };
      }
      // Known magic byte but unknown size — still initialized, default NTAG213
      return { ...CARD_TYPES.NTAG213, ccInitialized: true };
    }

    // Page 3 is OTP — if it has any non-zero data, it was already written.
    // Do NOT try to rewrite it (OTP bits can only go 0→1, never back).
    if (!isAllZeros) {
      return { ...CARD_TYPES.NTAG213, ccInitialized: true };
    }

    // Truly virgin card (all zeros) — safe to initialize CC
    return { ...CARD_TYPES.NTAG213, ccInitialized: false };
  } catch (err) {
    // If we can't read page 3, assume CC is already set (safer than writing)
    return { ...CARD_TYPES.NTAG213, ccInitialized: true };
  }
}

module.exports = { CARD_TYPES, detectCardType };
