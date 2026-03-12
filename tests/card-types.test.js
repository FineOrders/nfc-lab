const { describe, it, expect } = require('vitest');
const { detectCardType, CARD_TYPES } = require('../src/lib/card-types');

describe('card-types', () => {
  it('should export CARD_TYPES configuration', () => {
    expect(CARD_TYPES).toBeDefined();
    expect(CARD_TYPES.NTAG213).toBeDefined();
  });

  describe('detectCardType', () => {
    it('should detect NTAG213 based on CC', async () => {
      const mockReader = {
        transmit: async () => Buffer.from([0xd5, 0x43, 0x00, 0xe1, 0x10, 0x12, 0x00, 0x90, 0x00]),
        read: async () => Buffer.from([0xe1, 0x10, 0x12, 0x00]),
      };

      const result = await detectCardType(mockReader);
      expect(result.type).toBe('NTAG213');
      expect(result.ccInitialized).toBe(true);
    });

    it('should detect virgin card and return default CC', async () => {
      const mockReader = {
        transmit: async () => Buffer.from([0xd5, 0x43, 0x00, 0x00, 0x00, 0x00, 0x00, 0x90, 0x00]),
        read: async () => Buffer.from([0x00, 0x00, 0x00, 0x00]),
      };

      const result = await detectCardType(mockReader);
      expect(result.ccInitialized).toBe(false);
      expect(result.type).toBe('NTAG213'); // Default fallback
    });
  });
});
