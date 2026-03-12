const ndef = require('ndef');
const { wrapNdefTlv, unwrapNdefTlv } = require('../src/lib/ndef-tlv');

console.log('Testing TLV Wrapping/Unwrapping');
console.log('================================\n');

// Create a simple text record
const text = '¡Hola! Esta es una tarjeta NFC configurada con NFC Lab 🧪';
const record = ndef.textRecord(text, 'es');
const ndefMessage = Buffer.from(ndef.encodeMessage([record]));

console.log('Original NDEF Message:');
console.log(`  Length: ${ndefMessage.length} bytes`);
console.log(`  Hex: ${ndefMessage.toString('hex')}`);
console.log('');

// Wrap in TLV
const tlvWrapped = wrapNdefTlv(ndefMessage);
console.log('TLV Wrapped:');
console.log(`  Length: ${tlvWrapped.length} bytes`);
console.log(`  Hex: ${tlvWrapped.toString('hex')}`);
console.log(
  `  Structure: [0x03=${tlvWrapped[0].toString(16)}] [len=${tlvWrapped[1]}] [...data...] [0xFE=${tlvWrapped[tlvWrapped.length - 1].toString(16)}]`
);
console.log('');

// Pad to 4-byte boundary (as done in write)
const paddedLength = Math.ceil(tlvWrapped.length / 4) * 4;
const paddedBuffer = Buffer.alloc(paddedLength, 0x00);
tlvWrapped.copy(paddedBuffer);

console.log('Padded to 4-byte boundary:');
console.log(`  Length: ${paddedBuffer.length} bytes`);
console.log(`  Hex: ${paddedBuffer.toString('hex')}`);
console.log('');

// Unwrap
const unwrapped = unwrapNdefTlv(paddedBuffer);
if (!unwrapped) {
  console.log('ERROR: unwrapNdefTlv returned null!');
} else {
  console.log('Unwrapped NDEF:');
  console.log(`  Length: ${unwrapped.length} bytes`);
  console.log(`  Hex: ${unwrapped.toString('hex')}`);
  console.log(`  Match: ${Buffer.compare(ndefMessage, unwrapped) === 0 ? '✓ PASS' : '✗ FAIL'}`);

  // Try to decode
  try {
    const decodedRecords = ndef.decodeMessage(Array.from(unwrapped));
    const decodedText = ndef.text.decodePayload(decodedRecords[0].payload);
    console.log(`  Decoded text: "${decodedText}"`);
    console.log(`  Text match: ${text === decodedText ? '✓ PASS' : '✗ FAIL'}`);
  } catch (err) {
    console.log(`  Decode error: ${err.message}`);
  }
}
