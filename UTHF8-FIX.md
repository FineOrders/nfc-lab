# UTF-8 Text Encoding Fix

## Problema Identificado

Al escribir registros de texto NDEF con caracteres UTF-8 multibyte (como emojis `🧪` o caracteres especiales `¡`, `ñ`, etc.), la escritura reportaba SUCCESS pero la lectura posterior mostraba "Sin datos NDEF".

### Síntomas

- Escritura: ✓ SUCCESS
- Lectura inmediata: ✗ "Sin datos (NDEF vacío)"
- Solo ocurría con el tipo `text`, no con `url`

### Causa Raíz

La librería `ndef` (v0.2.0) tiene un bug en el manejo de UTF-8 multibyte:

1. **Encoder de texto** (`ndef-text.js`): Usa la API deprecada de Node.js `Buffer(string)` que no maneja correctamente la conversión de strings con caracteres multibyte.

2. **El problema específico**: Al calcular el tamaño del código de idioma (`lang.length`), se usa la longitud del string en caracteres, pero los bytes escritos son UTF-8. Para caracteres ASCII esto coincide, pero para caracteres multibyte no.

## Solución Implementada

### 1. Custom UTF-8 Text Encoder

Se implementó `_encodeTextPayload()` en `nfc-writer.js` que:

- Usa `Buffer.from(text, 'utf8')` para conversión correcta de UTF-8
- Calcula longitudes en **bytes**, no en caracteres
- Genera el payload NDEF correcto según el estándar NFC Forum Text RTD

```javascript
_encodeTextPayload(text, language) {
  const lang = language || 'en';
  const langBytes = Buffer.from(lang, 'utf8');
  const textBytes = Buffer.from(text, 'utf8');

  // Status byte: UTF-8 encoding (bit 7 = 0) + language code length (bits 0-5)
  const statusByte = langBytes.length & 0x3F;

  // Payload: [status byte] [language code bytes] [text bytes]
  const payload = Buffer.alloc(1 + langBytes.length + textBytes.length);
  payload[0] = statusByte;
  langBytes.copy(payload, 1);
  textBytes.copy(payload, 1 + langBytes.length);

  return Array.from(payload);
}
```

### 2. Custom UTF-8 Text Decoder

Se implementó un decoder en `_readTag()` que lee correctamente el payload UTF-8:

```javascript
const payload = Buffer.from(record.payload);
const statusByte = payload[0];
const languageCodeLength = statusByte & 0x3f;
const textBytes = payload.slice(1 + languageCodeLength);
const displayUrl = textBytes.toString('utf8');
```

### 3. Enhanced Debugging

Se añadieron logs adicionales para facilitar el diagnóstico:

- Hex dump de los primeros 64 bytes al leer
- Información de bytes y páginas escritas
- TLV extraction progress

## Verificación

### Script de prueba

```bash
node examples/4-test-text-encoding.js
```

Este script verifica:

- ✓ ASCII text
- ✓ Texto con caracteres latinos especiales (`¡`, `ñ`)
- ✓ Emojis multibyte (`🧪`, `👋`, `🌍`)
- ✓ Caracteres japoneses, chinos, rusos
- ✓ Wrapping/unwrapping TLV

### Prueba en hardware

1. Selecciona la pestaña "Texto"
2. Haz clic en "Cargar Ejemplo" (contiene emoji 🧪)
3. Haz clic en "Preparar Escritura"
4. Acerca una tarjeta NFC
5. Verifica en el log:
   - `Escritura exitosa (text) - ¡Hola! Esta es una tarjeta NFC configurada con NFC Lab 🧪 [70 bytes, 18 pags]`
6. Haz clic en "Leer tarjeta"
7. Acerca la misma tarjeta
8. Verifica que se lea correctamente el texto completo con emojis

## Resultados Esperados

**Antes del fix:**

```
#1 WRITE text → SUCCESS
#2 READ → "Sin datos (NDEF vacío)"
```

**Después del fix:**

```
#1 WRITE text → SUCCESS [70 bytes, 18 pags]
#2 READ → "¡Hola! Esta es una tarjeta NFC configurada con NFC Lab 🧪"
```

## Archivos Modificados

- `src/lib/nfc-writer.js`: Custom encoder/decoder UTF-8
- `public/app.js`: Mostrar bytes/páginas escritas
- `examples/4-test-text-encoding.js`: Script de verificación
- `examples/5-test-tlv.js`: Test de TLV wrapping

## Notas Técnicas

### Estructura del payload de texto NDEF

```
[Status Byte] [Lang Code] [Text UTF-8]
     |            |            |
     |            |            +-- Buffer.from(text, 'utf8')
     |            +-- Buffer.from(lang, 'utf8')
     +-- 0x02 (para 'en') o 0x02 (para 'es')
```

### Ejemplo con emoji

Texto: `¡Hola! 🧪`

```
Status: 0x02 (lang length = 2)
Lang:   65 6e ('en')
Text:   c2 a1 48 6f 6c 61 21 20 f0 9f a7 aa
        ^^^^^ = ¡ (2 bytes)
              ^^^^^^^^^^^^^^ = Hola! (ASCII)
                              ^^^^^^^^^^^ = 🧪 (4 bytes)
```

Total: 15 bytes (no 11 caracteres)

## Referencias

- [NFC Forum Text Record Type Definition](https://nfc-forum.org/product/text-record-type-definition/)
- [Node.js Buffer UTF-8 encoding](https://nodejs.org/api/buffer.html#buffer_buffers_and_character_encodings)
- [UTF-8 multibyte sequences](https://en.wikipedia.org/wiki/UTF-8)
