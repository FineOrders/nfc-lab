#!/usr/bin/env node

/**
 * NFC Reader Capability Diagnostic Tool
 *
 * Probes NFC reader capabilities to determine which PC/SC commands it supports.
 * Helps identify if a reader can write to NTAG/Ultralight tags.
 *
 * Usage: node scripts/diagnose-reader.js
 *
 * COMPATIBLE READERS FOR NTAG WRITE:
 * - ACS ACR122U (PN532-based, excellent compatibility)
 * - ACS ACR1252U (advanced features, USB Type-C)
 * - HID OMNIKEY 5022 / 5427 (enterprise-grade)
 * - Identiv uTrust 3700 F (compact, reliable)
 *
 * INCOMPATIBLE READERS:
 * - Generic EMV Smartcard Readers (EMV payment only, no NFC tag write support)
 * - Most readers without explicit "NFC Forum Type 2" or "Mifare Ultralight" support
 */

const { NFC } = require('nfc-pcsc');

const nfc = new NFC();

let reader = null;
let card = null;

console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║         NFC Reader Capability Diagnostic Tool                ║');
console.log('╚═══════════════════════════════════════════════════════════════╝\n');

nfc.on('reader', (detectedReader) => {
  reader = detectedReader;

  console.log('✓ Reader detected\n');
  console.log('Reader Information:');
  console.log('  Name:', reader.reader.name);
  console.log('  Standard:', reader.reader.standard || 'Unknown');
  console.log('  Protocol:', reader.reader.protocol || 'Unknown');
  console.log('');

  reader.on('card', async (detectedCard) => {
    card = detectedCard;

    console.log('✓ Card detected\n');
    console.log('Card Information:');
    console.log('  ATR:', card.atr.toString('hex'));
    console.log('  UID:', card.uid);
    console.log('  Type:', card.type);
    console.log('');

    console.log('Running capability tests...\n');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const results = {
      read: {},
      write: {},
    };

    // Test READ capabilities
    console.log('READ TESTS:\n');

    // Test 1: reader.read()
    try {
      const data = await reader.read(3, 4, 4);
      if (data && data.length >= 4) {
        results.read.builtin = { status: '✓ PASS', data: data.subarray(0, 4).toString('hex') };
      } else {
        results.read.builtin = { status: '✗ FAIL', error: 'Short read' };
      }
    } catch (err) {
      results.read.builtin = { status: '✗ FAIL', error: err.message };
    }
    console.log('  1. Built-in reader.read():', results.read.builtin.status);
    if (results.read.builtin.data) console.log('     Data:', results.read.builtin.data);

    // Test 2: READ BINARY FF B0
    try {
      const cmd = Buffer.from([0xff, 0xb0, 0x00, 0x03, 0x10]);
      const resp = await reader.transmit(cmd, 20);
      if (resp && resp.length >= 6 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
        results.read.ffb0 = { status: '✓ PASS', data: resp.subarray(0, 4).toString('hex') };
      } else {
        results.read.ffb0 = {
          status: '✗ FAIL',
          error: `SW: ${resp?.subarray(-2).toString('hex')}`,
        };
      }
    } catch (err) {
      results.read.ffb0 = { status: '✗ FAIL', error: err.message };
    }
    console.log('  2. READ BINARY (FF B0):', results.read.ffb0.status);
    if (results.read.ffb0.data) console.log('     Data:', results.read.ffb0.data);

    // Test 3: READ BINARY 00 B0
    try {
      const cmd = Buffer.from([0x00, 0xb0, 0x00, 0x03, 0x10]);
      const resp = await reader.transmit(cmd, 20);
      if (resp && resp.length >= 6 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
        results.read.std00b0 = { status: '✓ PASS', data: resp.subarray(0, 4).toString('hex') };
      } else {
        results.read.std00b0 = {
          status: '✗ FAIL',
          error: `SW: ${resp?.subarray(-2).toString('hex')}`,
        };
      }
    } catch (err) {
      results.read.std00b0 = { status: '✗ FAIL', error: err.message };
    }
    console.log('  3. READ BINARY (00 B0):', results.read.std00b0.status);

    // Test 4: PN532 InDataExchange (read)
    try {
      const cmd = Buffer.from([0xff, 0x00, 0x00, 0x00, 0x04, 0xd4, 0x42, 0x30, 0x03]);
      const resp = await reader.transmit(cmd, 32);
      if (resp.length >= 7 && resp[0] === 0xd5 && resp[1] === 0x43 && resp[2] === 0x00) {
        results.read.pn532 = {
          status: '✓ PASS (PN532 chip detected)',
          data: resp.subarray(3, 7).toString('hex'),
        };
      } else if (resp.length >= 6 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
        results.read.pn532 = {
          status: '⚠ PARTIAL (SW 9000, but no PN532 framing)',
          data: resp.subarray(0, 4).toString('hex'),
        };
      } else {
        results.read.pn532 = { status: '✗ FAIL', error: `Unexpected: ${resp.toString('hex')}` };
      }
    } catch (err) {
      results.read.pn532 = { status: '✗ FAIL', error: err.message };
    }
    console.log('  4. PN532 InDataExchange:', results.read.pn532.status);

    console.log('\n═══════════════════════════════════════════════════════════════\n');
    console.log('WRITE TESTS:\n');
    console.log(
      '⚠ WARNING: These tests will attempt to write to page 255 (out of range for most tags)'
    );
    console.log('           This should fail gracefully without corrupting the tag.\n');

    const testPage = 255; // Out of range for NTAG213/215/216
    const testData = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

    // Test 1: reader.write()
    try {
      await reader.write(testPage, testData, 4);
      results.write.builtin = { status: '✓ PASS (Command accepted)' };
    } catch (err) {
      if (err.message.includes('0x6300')) {
        results.write.builtin = {
          status: '✗ FAIL (0x6300 - Memory unchanged)',
          error: err.message,
        };
      } else {
        results.write.builtin = { status: '✗ FAIL', error: err.message };
      }
    }
    console.log('  1. Built-in reader.write():', results.write.builtin.status);

    // Test 2: UPDATE BINARY FF D6
    try {
      const cmd = Buffer.from([0xff, 0xd6, 0x00, testPage, 0x04, ...testData]);
      const resp = await reader.transmit(cmd, 10);
      if (resp && resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
        results.write.ffd6 = { status: '✓ PASS (SW 9000)' };
      } else {
        const sw = resp?.subarray(-2).toString('hex');
        if (sw === '6300') {
          results.write.ffd6 = { status: '✗ FAIL (0x6300 - Memory unchanged)' };
        } else {
          results.write.ffd6 = { status: '✗ FAIL', error: `SW: ${sw}` };
        }
      }
    } catch (err) {
      results.write.ffd6 = { status: '✗ FAIL', error: err.message };
    }
    console.log('  2. UPDATE BINARY (FF D6):', results.write.ffd6.status);

    // Test 3: UPDATE BINARY 00 D6
    try {
      const cmd = Buffer.from([0x00, 0xd6, 0x00, testPage, 0x04, ...testData]);
      const resp = await reader.transmit(cmd, 10);
      if (resp && resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
        results.write.std00d6 = { status: '✓ PASS (SW 9000)' };
      } else {
        results.write.std00d6 = {
          status: '✗ FAIL',
          error: `SW: ${resp?.subarray(-2).toString('hex')}`,
        };
      }
    } catch (err) {
      results.write.std00d6 = { status: '✗ FAIL', error: err.message };
    }
    console.log('  3. UPDATE BINARY (00 D6):', results.write.std00d6.status);

    // Test 4: Vendor WRITE FF D7
    try {
      const cmd = Buffer.from([0xff, 0xd7, 0x00, testPage, 0x04, ...testData]);
      const resp = await reader.transmit(cmd, 10);
      if (resp && resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
        results.write.ffd7 = { status: '✓ PASS (SW 9000)' };
      } else {
        results.write.ffd7 = {
          status: '✗ FAIL',
          error: `SW: ${resp?.subarray(-2).toString('hex')}`,
        };
      }
    } catch (err) {
      results.write.ffd7 = { status: '✗ FAIL', error: err.message };
    }
    console.log('  4. Vendor WRITE (FF D7):', results.write.ffd7.status);

    // Test 5: PC/SC Transparent Session
    try {
      const cmd = Buffer.from([
        0xff,
        0xc2,
        0x00,
        0x00,
        0x08,
        0x5f,
        0x47,
        0x06,
        0xa2,
        testPage,
        ...testData,
      ]);
      const resp = await reader.transmit(cmd, 64);
      if (resp && resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
        results.write.transparent = { status: '✓ PASS (SW 9000)' };
      } else {
        results.write.transparent = {
          status: '✗ FAIL',
          error: `SW: ${resp?.subarray(-2).toString('hex')}`,
        };
      }
    } catch (err) {
      results.write.transparent = { status: '✗ FAIL', error: err.message };
    }
    console.log('  5. Transparent Session (FF C2):', results.write.transparent.status);

    // Test 6: ENVELOPE FF C3
    try {
      const cmd = Buffer.from([0xff, 0xc3, 0x00, 0x00, 0x06, 0xa2, testPage, ...testData]);
      const resp = await reader.transmit(cmd, 64);
      if (resp && resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
        results.write.envelope = { status: '✓ PASS (SW 9000)' };
      } else {
        results.write.envelope = {
          status: '✗ FAIL',
          error: `SW: ${resp?.subarray(-2).toString('hex')}`,
        };
      }
    } catch (err) {
      results.write.envelope = { status: '✗ FAIL', error: err.message };
    }
    console.log('  6. ENVELOPE (FF C3):', results.write.envelope.status);

    // Test 7: PN532 InDataExchange (write)
    try {
      const cmd = Buffer.from([
        0xff,
        0x00,
        0x00,
        0x00,
        0x07,
        0xd4,
        0x42,
        0xa2,
        testPage,
        ...testData,
      ]);
      const resp = await reader.transmit(cmd, 16);
      if (resp.length >= 3 && resp[0] === 0xd5 && resp[1] === 0x43 && resp[2] === 0x00) {
        results.write.pn532 = { status: '✓ PASS (PN532 chip detected, framed response)' };
      } else if (resp.length >= 2 && resp.subarray(-2).readUInt16BE(0) === 0x9000) {
        results.write.pn532 = {
          status: '⚠ PARTIAL (SW 9000, but no PN532 framing - likely false positive)',
        };
      } else {
        results.write.pn532 = { status: '✗ FAIL', error: `Unexpected: ${resp.toString('hex')}` };
      }
    } catch (err) {
      results.write.pn532 = { status: '✗ FAIL', error: err.message };
    }
    console.log('  7. PN532 InDataExchange:', results.write.pn532.status);

    // Test 8: CCID Escape
    try {
      const cmd = Buffer.from([0xa2, testPage, ...testData]);
      const resp = await reader.control(cmd, 64);
      if (resp && resp.length > 0) {
        results.write.ccid = { status: '✓ PASS (Response received)' };
      } else {
        results.write.ccid = { status: '✗ FAIL (No response)' };
      }
    } catch (err) {
      results.write.ccid = { status: '✗ FAIL', error: err.message };
    }
    console.log('  8. CCID Escape (control):', results.write.ccid.status);

    console.log('\n═══════════════════════════════════════════════════════════════\n');
    console.log('ANALYSIS:\n');

    // Analyze results
    const readPasses = Object.values(results.read).filter((r) => r.status.includes('✓')).length;
    const writePasses = Object.values(results.write).filter((r) => r.status.includes('✓')).length;
    const writePartial = Object.values(results.write).filter((r) => r.status.includes('⚠')).length;

    console.log(`  Read Capability:  ${readPasses}/4 methods passed`);
    console.log(`  Write Capability: ${writePasses}/8 methods passed (${writePartial} partial)\n`);

    if (writePasses === 0 && writePartial > 0) {
      console.log('⚠ WARNING: This reader appears to ACCEPT write commands but may not');
      console.log('           actually write to the tag. The PN532 "PARTIAL" result suggests');
      console.log('           the reader lacks a genuine PN532 chip and cannot perform writes.\n');
      console.log('  Recommendation: This reader is NOT suitable for NTAG write operations.');
      console.log('                  Consider using an ACR122U, ACR1252U, or similar reader.\n');
    } else if (writePasses === 0) {
      console.log('✗ CONCLUSION: This reader CANNOT write to NTAG/Ultralight tags.');
      console.log('              It is likely an EMV-only contactless reader.\n');
      console.log('  Recommendation: Use a reader with explicit NFC Forum Type 2 support:');
      console.log('                  - ACS ACR122U (best compatibility, PN532-based)');
      console.log('                  - ACS ACR1252U (modern, USB Type-C)');
      console.log('                  - HID OMNIKEY 5022 / 5427 (enterprise)');
      console.log('                  - Identiv uTrust 3700 F (compact)\n');
    } else if (
      results.write.pn532?.status.includes('✓') &&
      results.write.pn532.status.includes('framed')
    ) {
      console.log('✓ CONCLUSION: This reader has a genuine PN532 chip and should support');
      console.log('              NTAG/Ultralight write operations reliably.\n');
    } else {
      console.log('⚠ CONCLUSION: This reader may support write operations, but the results');
      console.log(
        '              are inconclusive. Test with real write verification to confirm.\n'
      );
    }

    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('Diagnostic complete. Remove card to exit.');
  });

  reader.on('card.off', () => {
    console.log('\n✓ Card removed. Exiting.\n');
    process.exit(0);
  });

  reader.on('error', (err) => {
    console.error('Reader error:', err);
  });
});

nfc.on('error', (err) => {
  console.error('NFC error:', err);
  process.exit(1);
});

console.log('Waiting for NFC reader...');
console.log('(Press Ctrl+C to cancel)\n');

process.on('SIGINT', () => {
  console.log('\n\nDiagnostic cancelled by user.\n');
  process.exit(0);
});
