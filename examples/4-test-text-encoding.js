/**
 * Test script to verify UTF-8 text encoding/decoding
 * Run with: node examples/4-test-text-encoding.js
 */

const ndef = require('ndef');

function encodeTextPayload(text, language) {
  const lang = language || 'en';
  const langBytes = Buffer.from(lang, 'utf8');
  const textBytes = Buffer.from(text, 'utf8');

  const statusByte = langBytes.length & 0x3f;

  const payload = Buffer.alloc(1 + langBytes.length + textBytes.length);
  payload[0] = statusByte;
  langBytes.copy(payload, 1);
  textBytes.copy(payload, 1 + langBytes.length);

  return Array.from(payload);
}

function decodeTextPayload(payload) {
  const buffer = Buffer.from(payload);
  const statusByte = buffer[0];
  const languageCodeLength = statusByte & 0x3f;
  const textBytes = buffer.slice(1 + languageCodeLength);
  return textBytes.toString('utf8');
}

console.log('Testing UTF-8 NDEF Text Encoding/Decoding');
console.log('===========================================\n');

const testCases = [
  { text: 'Hello World', lang: 'en' },
  { text: '¡Hola! Esta es una tarjeta NFC configurada con NFC Lab 🧪', lang: 'es' },
  { text: 'Bonjour le monde', lang: 'fr' },
  { text: 'こんにちは世界', lang: 'ja' },
  { text: '👋🌍🚀', lang: 'en' },
];

testCases.forEach(({ text, lang }, index) => {
  console.log(`Test ${index + 1}:`);
  console.log(`  Original: "${text}" (${lang})`);

  // Encode
  const encoded = encodeTextPayload(text, lang);
  const record = ndef.record(ndef.TNF_WELL_KNOWN, ndef.RTD_TEXT, [], encoded);

  // Encode as NDEF message
  const ndefMessage = Buffer.from(ndef.encodeMessage([record]));
  console.log(`  NDEF bytes: ${ndefMessage.length}`);
  console.log(`  Hex: ${ndefMessage.toString('hex')}`);

  // Decode
  const decodedRecords = ndef.decodeMessage(Array.from(ndefMessage));
  const decoded = decodeTextPayload(decodedRecords[0].payload);

  console.log(`  Decoded: "${decoded}"`);
  console.log(`  Match: ${text === decoded ? '✓ PASS' : '✗ FAIL'}`);
  console.log('');
});

console.log('Comparison with old ndef.textRecord (may have UTF-8 issues):');
console.log('============================================================\n');

const problematicText = '¡Hola! 🧪';
console.log(`Testing: "${problematicText}"`);

// Old way (ndef library)
try {
  const oldRecord = ndef.textRecord(problematicText, 'es');
  const oldMessage = Buffer.from(ndef.encodeMessage([oldRecord]));
  console.log(`Old encoder hex: ${oldMessage.toString('hex')}`);
  const oldDecoded = ndef.text.decodePayload(oldRecord.payload);
  console.log(`Old decoder result: "${oldDecoded}"`);
  console.log(`Old match: ${problematicText === oldDecoded ? '✓' : '✗'}`);
} catch (err) {
  console.log(`Old encoder error: ${err.message}`);
}

console.log('');

// New way (our custom encoder)
const newEncoded = encodeTextPayload(problematicText, 'es');
const newRecord = ndef.record(ndef.TNF_WELL_KNOWN, ndef.RTD_TEXT, [], newEncoded);
const newMessage = Buffer.from(ndef.encodeMessage([newRecord]));
console.log(`New encoder hex: ${newMessage.toString('hex')}`);
const newDecoded = decodeTextPayload(newRecord.payload);
console.log(`New decoder result: "${newDecoded}"`);
console.log(`New match: ${problematicText === newDecoded ? '✓' : '✗'}`);
