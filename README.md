# Whistant - Ollama Server Registration

Register your Ollama server with the Whistant iPhone app using a link code.

## Quick Start

### Prerequisites
- **Operating System**: Windows 10+, Ubuntu 20.04+, or macOS 10.15+
- **Ollama**: Running on localhost:11434
- **Models**: For good performance, suggest agent model gpt-oss:20b, reasoning model deepseek-r1:14b
- **Cloudflared**: For remote access
- **GPU**: Nvidia GPU with 24 GB or larger graphic memory (recommended); driver and CUDA ready. For Mac, Apple Silicon with 24 GB+ unified memory recommended
- **Node.js**: v16+ with npm installed

### Platform-Specific Requirements

#### Windows
- PowerShell
- Install cloudflared: `scoop install cloudflared`

#### Ubuntu/Linux
- Bash terminal
- Install cloudflared: `sudo apt install cloudflared` or download from [cloudflare releases](https://github.com/cloudflare/cloudflared/releases)

#### macOS
- Terminal (zsh or bash)
- Install cloudflared: `brew install cloudflared`

### Installation
```bash
cd /path/to/whistant_local
npm install
```
Note: Use `c:\Users\xxx\whistant_local` on Windows, `~/whistant_local` on Linux/macOS.

### Usage

#### Step 1: Start the app
```bash
npm start
```

#### Step 2: (Optional) Start a public tunnel in another terminal
If you need access from outside your network:

```bash
cloudflared tunnel --url http://localhost:11434
```

#### Step 3: Register in the app
1. Get a 6-character link code from your iPhone's Whistant app
2. Paste it in the desktop app
3. Click "Register Server"
4. Done!

## How It Works

1. **iPhone app generates link code** - User taps "Link Ollama Server" on iPhone
2. **Desktop app receives link code** - User enters the code in the registration UI
3. **App sends registration** - Sends link code + server info to whistant server
4. **Server validates & binds** - whistant server matches link code to user and stores server info
5. **iPhone connects** - iPhone app connects to the server through the provided tunnel URL

## Status Indicators

The app header shows:
- **Ollama**: ✅ (running) | ❌ (not running)
- **Tunnel**: ✅ (public tunnel active) | ⚠️ (using localhost only)

## Tunnel Setup

For public access from anywhere (recommended):

### Cloudflared (Recommended)
**Windows:**
```powershell
scoop install cloudflared
```

**Ubuntu/Linux:**
```bash
sudo apt install cloudflared
```

**macOS:**
```bash
brew install cloudflared
```

Then in a separate terminal:
```bash
cloudflared tunnel --url http://localhost:11434
```

Keep this running. The app will automatically detect the tunnel URL.

## Development

### Dev mode with DevTools
```bash
npm run dev
```

## Windows Portable Build (from Linux)

You can generate a standalone Windows portable `.exe` on Linux using `electron-builder` with Wine.

Prerequisites:
- Wine and Mono for cross-building Squirrel/NSIS-free portable targets
- `electron-builder` already listed in `devDependencies`

Install prerequisites on Debian/Ubuntu-based distros:

```bash
sudo apt update
sudo apt install -y wine64 wine32
```

Optional: provide a Windows icon at `ui/icon.ico` for better branding. If absent, electron-builder will use a default icon.

Build commands:

```bash
# Build Windows portable x64
npm run build:win:x64

# Or generic portable (defaults to x64)
npm run build:win
```

Output:
- Files are placed under `dist/`.
- Look for `Whistant Local Portable.exe` (name may vary by version/productName).

Notes:
- The portable build produces a single `.exe` that runs without installation and without extra preparation on Windows.
- Code signing is optional and not required for local/portable usage; unsigned binaries may trigger SmartScreen.

## macOS Build

You can generate a macOS `.dmg` and `.app` bundle.

Prerequisites:
- macOS development machine or Linux with proper tooling
- `electron-builder` already listed in `devDependencies`

Build commands:

**On macOS:**
```bash
# Build macOS DMG for Apple Silicon (arm64)
npm run build:mac:arm64

# Build macOS DMG for Intel (x64)
npm run build:mac:x64

# Build universal binary (both architectures)
npm run build:mac
```

Output:
- Files are placed under `dist/`.
- Look for `Whistant_Local-1.0.0-arm64.dmg` or similar.

Notes:
- Code signing requires an Apple Developer account and certificate.
- Unsigned apps may require users to allow the app in System Preferences > Security & Privacy.

## File Structure

```
whistant_local/
├── main.js              # Electron main process  
├── preload.js           # Electron IPC bridge
├── server.js            # Local Ollama proxy
├── package.json         # Dependencies
├── ui/
│   ├── index.html       # Registration UI
│   ├── app.js           # UI logic
│   └── styles.css       # Styling
├── README.md            # This file
├── TUNNEL_SETUP.md      # Detailed tunnel guide
└── .env                 # Configuration
```

## Troubleshooting

### Ollama not detected
- Ensure Ollama is running on localhost:11434
- Test: `curl http://localhost:11434/api/tags`

### Tunnel not connecting
- Ensure cloudflared is running in another terminal
- Check: `cloudflared tunnel --url http://localhost:11434`

### App won't start
- Check Node.js: `node --version`
- Run: `npm install`
- Check port 3000 is available

## Architecture

```
iPhone (Whistant App)
        ↓ (link code)
Whistant Server (whistant.com:2087)
        ↓ (validates & stores)
Desktop Whistant App (Windows/Linux/macOS)
        ↓ (registers with link code + hardware info)
Whistant Server
        ↓ (server info stored in DB)
iPhone (connects via tunnel URL)
        ↓
Public Tunnel (cloudflared/ngrok)
        ↓
Ollama Server (localhost:11434)
```

## Notes

- Link codes are temporary and one-time use
- Tunnel URLs change each time you restart
- The app stores registration data locally
- For production, consider a permanent named tunnel setup

## See Also

- TUNNEL_SETUP.md - Detailed tunnel configuration
- CLOUDFLARED_SETUP.md - Cloudflared specific setup
