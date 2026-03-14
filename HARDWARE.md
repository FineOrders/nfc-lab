# NFC Reader Hardware Compatibility

This document provides guidance on choosing a compatible NFC reader for NTAG/Ultralight tag read/write operations.

## TL;DR — Recommended Readers

If you just want a reader that works reliably with NTAG213/215/216 tags:

1. **ACS ACR122U** — Best compatibility, PN532-based, widely available (~$40 USD)
2. **ACS ACR1252U** — Modern alternative with USB Type-C (~$60 USD)
3. **HID OMNIKEY 5022 / 5427** — Enterprise-grade, reliable (~$70-100 USD)
4. **Identiv uTrust 3700 F** — Compact, good performance (~$50 USD)

## Understanding Reader Compatibility

### What Makes a Reader Compatible?

To write to **NFC Forum Type 2 Tags** (NTAG213/215/216, Mifare Ultralight), a reader must:

1. **Support the `0xA2` WRITE command** at the tag protocol level
2. **Properly implement PC/SC APDUs** for UPDATE BINARY or Direct Transmit
3. **Have firmware that bridges PC/SC to native tag commands**

Many contactless readers are designed ONLY for EMV payment cards (read-only operations) and lack the firmware needed to issue write commands to NFC tags.

### The PN532 Advantage

Readers based on the **NXP PN532 NFC controller chip** (like the ACR122U) have excellent compatibility because:

- The PN532 natively supports NFC Forum Type 1-4 tags
- Direct access via `InDataExchange` (command `0x42`)
- Well-documented, widely supported in open-source tools

### Incompatible Readers

**Avoid these types of readers for NTAG write operations:**

- Generic "EMV Smartcard Reader" devices (EMV payment only)
- Readers without explicit "NFC Forum Type 2" or "Mifare Ultralight" support
- Readers marketed only for contactless payment (ISO 14443-4 only)
- Clone/unbranded readers with unclear specifications

**Example of incompatible reader:**

- "Generic EMV Smartcard Reader" — Accepts read commands but returns `0x6300` (memory unchanged) for all write attempts. No PN532 chip.

## Testing Your Reader

Use the diagnostic script to probe your reader's capabilities:

```bash
node scripts/diagnose-reader.js
```

Place an NTAG tag on the reader and observe the test results. The script will:

1. Probe all 5 read tiers (built-in, READ BINARY, Transparent Session, PN532)
2. Test all 8 write tiers (UPDATE BINARY, Vendor, ENVELOPE, PN532, CCID Escape)
3. Detect if the reader has a genuine PN532 chip (framed response `D5 43 00`)
4. Report which commands work and which fail

### Interpreting Results

**Good Sign (Compatible Reader):**

```
Write Capability: 4/8 methods passed (0 partial)
✓ CONCLUSION: This reader has a genuine PN532 chip and should support
              NTAG/Ultralight write operations reliably.
```

**Bad Sign (Incompatible Reader):**

```
Write Capability: 0/8 methods passed (1 partial)
⚠ WARNING: This reader appears to ACCEPT write commands but may not
           actually write to the tag. The PN532 "PARTIAL" result suggests
           the reader lacks a genuine PN532 chip and cannot perform writes.
```

If you see `0/8 passed` or `PARTIAL` results with `SW 9000` but no framed PN532 responses, **the reader is not suitable for write operations**.

## Where to Buy

### United States

- **ACS ACR122U**: Amazon, Newegg, ACS Direct (~$40)
- **ACS ACR1252U**: Amazon, official ACS store (~$60)
- **HID OMNIKEY**: CDW, Amazon (~$70-100)

### Europe

- **ACS ACR122U**: Amazon.de, Amazon.co.uk, ACS Europe (~€35-45)
- **ACR1252U**: Same vendors (~€55-65)

### Worldwide

- **ACS Official Store**: https://www.acs.com.hk/en/where-to-buy/
- **NFC Tools Suppliers**: Search for "ACR122U" or "PN532 USB reader"

## Technical Deep Dive

### PC/SC Command Tiers

This project implements **8 write tiers** to maximize compatibility:

1. **Tier 1**: `reader.write()` — nfc-pcsc built-in (uses UPDATE BINARY internally)
2. **Tier 2**: UPDATE BINARY `FF D6` — PC/SC standard
3. **Tier 3**: UPDATE BINARY `00 D6` — ISO 7816-4 standard
4. **Tier 4**: Vendor WRITE `FF D7` — Vendor-specific extension
5. **Tier 5**: PC/SC Transparent Session `FF C2` — Direct tag access (inline + explicit session)
6. **Tier 6**: ENVELOPE `FF C3` — Pass-through to tag
7. **Tier 7**: PN532 InDataExchange `FF 00 00 00 07 D4 42 A2...` — ACR122U specific
8. **Tier 8**: CCID Escape — Low-level control transfer

**Why so many tiers?**

Different readers implement different subsets of PC/SC. Some support only standard APDUs, others support vendor extensions, and PN532-based readers support direct chip access. By trying all methods, we maximize the chance of success.

**False Positives:**

Tier 7 (PN532) can produce false positives on non-PN532 readers. The reader may return `SW 9000` (success) but never actually write to the tag. This is why **write verification** (read-back after write) is CRITICAL — it's the only way to know if the write truly succeeded.

### Why Verification Matters

In `src/lib/ntag-commands.js`, every write is followed by an immediate read-back:

```javascript
await _writePageAttempt(reader, page, data);
await delay(10); // EEPROM settle time
const actual = await readPage(reader, page, 0);
if (data.compare(actual) !== 0) {
  throw new Error('Verification failed');
}
```

This is essential because:

- Some readers ACK commands but don't execute them
- RF communication can fail silently
- Tag write protection can block writes without returning an error
- Verification ensures data integrity

## Troubleshooting

### "All write methods failed for page X"

**Cause:** Your reader doesn't support any of the 8 write tiers.

**Solution:** Get a compatible reader (see recommendations above).

### "Page X verification failed: wrote XXXXX, read YYYYY"

**Cause:** The reader accepted the command (returned `SW 9000`) but didn't actually write to the tag. This is a **false positive**.

**Solution:**

1. Check if you have a genuine PN532-based reader
2. Run `node scripts/diagnose-reader.js` to see which tier is falsely succeeding
3. If no tier shows genuine PN532 framing (`D5 43 00`), the reader is incompatible

### Tag is write-protected

**Symptom:** Reads work, writes return `0x6300` or verification fails, but reader is known-compatible.

**Cause:** NTAG tags can be write-protected via lock bits (pages 2, 40-42).

**Solution:**

1. Use a different (blank) tag to test
2. Check lock bits with a read command
3. Write protection is PERMANENT and cannot be undone

## Contributing

Found a reader that works (or doesn't work)? Please open an issue or PR to add it to this document.

Include:

- Reader brand and model
- Vendor ID / Product ID (from `lsusb` or Device Manager)
- Which tiers passed in `diagnose-reader.js`
- Whether PN532 framed responses were detected

## References

- PC/SC Specification Part 3: https://pcscworkgroup.com/specifications/
- ISO 7816-4: Smart card APDU reference
- NFC Forum Type 2 Tag Operation: https://nfc-forum.org/
- PN532 User Manual: https://www.nxp.com/docs/en/user-guide/141520.pdf
- ACS ACR122U Datasheet: https://www.acs.com.hk/en/products/3/acr122u-usb-nfc-reader/
