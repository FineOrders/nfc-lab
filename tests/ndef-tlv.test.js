const { describe, it, expect } = require('vitest');
const { wrapNdefTlv, unwrapNdefTlv } = require('../src/lib/ndef-tlv');

describe('ndef-tlv', () => {
  describe('wrapNdefTlv', () => {
    it('should wrap short NDEF message (length < 255)', () => {
      const ndef = Buffer.from([0xd1, 0x01, 0x05, 0x55, 0x04, 0x61, 0x62, 0x63]); // URI: https://abc
      const tlv = wrapNdefTlv(ndef);

      expect(tlv[0]).toBe(0x03); // Type
      expect(tlv[1]).toBe(ndef.length); // Length
      expect(tlv.subarray(2, 2 + ndef.length).toString('hex')).toBe(ndef.toString('hex'));
      expect(tlv[tlv.length - 1]).toBe(0xfe); // Terminator
    });

    it('should wrap long NDEF message (length >= 255)', () => {
      const ndef = Buffer.alloc(300, 0xaa);
      const tlv = wrapNdefTlv(ndef);

      expect(tlv[0]).toBe(0x03); // Type
      expect(tlv[1]).toBe(0xff); // Long length indicator
      expect(tlv.readUInt16BE(2)).toBe(300); // Length
      expect(tlv.subarray(4, 4 + 300).toString('hex')).toBe(ndef.toString('hex'));
      expect(tlv[tlv.length - 1]).toBe(0xfe); // Terminator
    });
  });

  describe('unwrapNdefTlv', () => {
    it('should unwrap short TLV', () => {
      const raw = Buffer.from([0x03, 0x04, 0xde, 0xad, 0xbe, 0xef, 0xfe]);
      const extracted = unwrapNdefTlv(raw);
      expect(extracted.toString('hex')).toBe('deadbeef');
    });

    it('should unwrap long TLV', () => {
      const ndef = Buffer.alloc(300, 0xbb);
      const raw = Buffer.alloc(300 + 5);
      raw[0] = 0x03;
      raw[1] = 0xff;
      raw.writeUInt16BE(300, 2);
      ndef.copy(raw, 4);
      raw[raw.length - 1] = 0xfe;

      const extracted = unwrapNdefTlv(raw);
      expect(extracted.length).toBe(300);
      expect(extracted.toString('hex')).toBe(ndef.toString('hex'));
    });

    it('should skip NULL TLVs', () => {
      const raw = Buffer.from([0x00, 0x00, 0x03, 0x02, 0x11, 0x22, 0xfe]);
      const extracted = unwrapNdefTlv(raw);
      expect(extracted.toString('hex')).toBe('1122');
    });

    it('should return null if NDEF TLV not found', () => {
      const raw = Buffer.from([0x01, 0x02, 0xaa, 0xbb, 0xfe]);
      const extracted = unwrapNdefTlv(raw);
      expect(extracted).toBeNull();
    });
  });
});
