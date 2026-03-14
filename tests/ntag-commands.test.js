import { describe, it, expect, vi } from 'vitest';
import { readPage, writePage } from '../src/lib/ntag-commands.js';

describe('ntag-commands', () => {
  describe('readPage', () => {
    it('works with reader.read', async () => {
      const mockReader = {
        read: vi.fn().mockResolvedValue(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x00, 0x00])),
      };
      const res = await readPage(mockReader, 4);
      expect(res).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04]));
    });

    it('works with READ BINARY', async () => {
      const mockReader = {
        read: vi.fn().mockRejectedValue(new Error('fail')),
        transmit: vi.fn().mockResolvedValue(Buffer.from([0x11, 0x22, 0x33, 0x44, 0x90, 0x00])),
      };
      const res = await readPage(mockReader, 5);
      expect(res).toEqual(Buffer.from([0x11, 0x22, 0x33, 0x44]));
    });

    it('works with Transparent', async () => {
      const mockReader = {
        read: vi.fn().mockRejectedValue(new Error('fail')),
        transmit: vi.fn().mockImplementation((cmd) => {
          if (cmd[1] === 0xc2) {
            return Promise.resolve(
              Buffer.from([0x5f, 0x48, 0x04, 0xaa, 0xbb, 0xcc, 0xdd, 0x90, 0x00])
            );
          }
          return Promise.resolve(Buffer.from([0x6e, 0x00]));
        }),
      };
      const res = await readPage(mockReader, 6);
      expect(res).toEqual(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]));
    });

    it('works with PN532', async () => {
      const mockReader = {
        read: vi.fn().mockRejectedValue(new Error('fail')),
        transmit: vi.fn().mockImplementation((cmd) => {
          if (cmd[1] === 0x00 && cmd[5] === 0xd4) {
            return Promise.resolve(
              Buffer.from([0xd5, 0x43, 0x00, 0x11, 0x22, 0x33, 0x44, 0x90, 0x00])
            );
          }
          return Promise.resolve(Buffer.from([0x6e, 0x00]));
        }),
      };
      const res = await readPage(mockReader, 7);
      expect(res).toEqual(Buffer.from([0x11, 0x22, 0x33, 0x44]));
    });
  });

  describe('writePage', () => {
    it('works with reader.write', async () => {
      const mockReader = {
        write: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue(Buffer.from([0x01, 0x02, 0x03, 0x04])),
      };
      const data = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const res = await writePage(mockReader, 5, data);
      expect(res).toBe(true);
    });

    it('works with UPDATE BINARY FF D6', async () => {
      const mockReader = {
        write: vi.fn().mockRejectedValue(new Error('fail')),
        read: vi.fn().mockResolvedValue(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd])),
        transmit: vi.fn().mockResolvedValue(Buffer.from([0x90, 0x00])),
      };
      const data = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
      const res = await writePage(mockReader, 10, data);
      expect(res).toBe(true);
    });

    it('works with CCID Escape', async () => {
      const mockReader = {
        write: vi.fn().mockRejectedValue(new Error('fail')),
        read: vi.fn().mockResolvedValue(Buffer.from([0x11, 0x22, 0x33, 0x44])),
        transmit: vi.fn().mockResolvedValue(Buffer.from([0x6e, 0x00])),
        control: vi.fn().mockResolvedValue(Buffer.from([0x00])),
      };
      const data = Buffer.from([0x11, 0x22, 0x33, 0x44]);
      const res = await writePage(mockReader, 12, data);
      expect(res).toBe(true);
    });

    it('retries on verify fail', async () => {
      const mockReader = {
        write: vi.fn().mockResolvedValue(undefined),
        read: vi
          .fn()
          .mockResolvedValueOnce(Buffer.from([0x00, 0x00, 0x00, 0x00]))
          .mockResolvedValueOnce(Buffer.from([0x01, 0x02, 0x03, 0x04])),
      };
      const data = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const res = await writePage(mockReader, 8, data);
      expect(res).toBe(true);
      expect(mockReader.write).toHaveBeenCalledTimes(2);
    });
  });
});
