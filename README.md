# NFC Lab 🧪

A comprehensive Node.js application for reading and writing NFC tags (NTAG213, NTAG215, NTAG216) using the **ACR122U** reader. It features a web-based UI, a REST API, and real-time updates via WebSockets.

## 🚀 Features

- **NFC Tag Writing**: Write URL NDEF records to NTAG21x and MIFARE Ultralight tags.
- **NFC Tag Reading**: Extract NDEF records (URL and Text) from tags.
- **Real-time Monitoring**: WebSocket connection streams NFC events (card detection, progress, errors) to the frontend.
- **Hardware Abstraction**: Custom low-level APDU commands for reliable interaction with ACR122U readers.
- **Capability Container (CC) Management**: Automatically initializes virgin tags with the correct CC bytes.
- **Responsive UI**: Modern dark-themed web interface for easy operation.

## 🛠️ Requirements

- **Node.js**: v18 or higher.
- **Hardware**: ACR122U NFC Reader (or compatible PC/SC reader).
- **Driver**: PC/SC Lite (Linux/macOS) or Smart Card Service (Windows).
  - **Linux**: `sudo apt-get install libpcsclite-dev pcscd`
  - **macOS**: Built-in, but ensure `pcscd` is running if you use third-party drivers.

## 📦 Installation

```bash
git clone https://github.com/your-username/nfc-lab.git
cd nfc-lab
npm install
```

## 🚦 Usage

### Development Mode

Runs the server with `nodemon` for automatic restarts:

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

Access the UI at `http://localhost:3000`.

## 📡 API Endpoints

| Method   | Endpoint      | Description                                      |
| -------- | ------------- | ------------------------------------------------ |
| `POST`   | `/api/url`    | Set a URL to be written to the next tapped tag.  |
| `GET`    | `/api/url`    | Get the currently pending URL.                   |
| `DELETE` | `/api/url`    | Clear the pending URL.                           |
| `POST`   | `/api/read`   | Request a read operation on the next tapped tag. |
| `DELETE` | `/api/read`   | Cancel the pending read operation.               |
| `GET`    | `/api/status` | Get current reader and operation status.         |

## 🧪 Testing

The project uses [Vitest](https://vitest.dev/) for unit testing.

```bash
npm test
```

## 🏗️ Project Structure

- `src/server.js`: Main entry point (Express + WebSocket).
- `src/lib/`: Core logic modules.
  - `nfc-writer.js`: Orchestrates read/write operations.
  - `ntag-commands.js`: Low-level APDU/PN532 commands.
  - `card-types.js`: Card type definitions and detection.
  - `ndef-tlv.js`: NDEF/TLV encoding and decoding.
- `public/`: Frontend assets (HTML, JS, CSS).
- `examples/`: Standalone scripts for learning and hardware testing.
- `tests/`: Unit tests.

## ⚖️ License

[ISC](LICENSE)
