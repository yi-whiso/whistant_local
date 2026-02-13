# Whistant - Ollama Server Registration

Register your Ollama server with the Whistant iPhone app using a link code.

## Quick Start

### Prerequisites
- **Operating System**: Windows 10+, Ubuntu 20.04+, or macOS 10.15+
- **Ollama**: Running on localhost:11434
- **Models**: For good performance, suggest agent model gpt-oss:20b, reasoning model deepseek-r1:14b
- **GPU**: Nvidia GPU with 24 GB or larger graphic memory (recommended); driver and CUDA ready. AMD GPU with 24 GB+ graphic memory. For Mac, Apple Silicon with 24 GB+ unified memory recommended.
- **Node.js**: v16+ with npm installed

**Note:** cloudflared is bundled with the app - no separate installation needed for end users.

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

#### Step 2: Register in the app
1. Get a 6-character link code from your iPhone's Whistant app (Settings -> Server)
2. Paste it in the desktop app
3. Click "Register Server"
4. Done!

## How It Works

1. **iPhone app generates link code** - User taps "Generate/ Refresh Code" on iPhone
2. **Desktop app receives link code** - User enters the code in the registration UI
3. **App sends registration** - Sends link code + server info to whistant server
4. **Server validates & binds** - whistant server matches link code to user and stores server info
5. **iPhone connects** - iPhone app connects to the server through the provided tunnel URL

## Status Indicators

The app header shows:
- **Ollama**: ✅ (running) | ❌ (not running)
- **Tunnel**: ✅ (public tunnel active) | ⚠️ (using localhost only)

Keep this running. The app will automatically detect the tunnel URL.

## Development

### Dev mode with DevTools
```bash
npm run dev
```

## Windows Build

### Building on Windows

Prerequisites:
- Windows 10+ with PowerShell
- `electron-builder` already listed in `devDependencies`
- Node.js and npm installed

Build commands:

```powershell
# Build Windows portable x64
npm run build:win:x64

# Or generic portable (defaults to x64)
npm run build:win
```

### Building from Linux (Cross-platform)

You can also generate a Windows portable `.exe` on Linux using `electron-builder` with Wine.

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

## macOS Build

You can generate a macOS `.dmg` and `.app` bundle.

Prerequisites:
- macOS development machine or Linux with proper tooling
- `electron-builder` already listed in `devDependencies`

Build commands:

**On macOS:**
```bash
# Build macOS DMG for current architecture
npm run build:mac

# Build universal binary (both Intel and Apple Silicon)
npm run build:mac:universal
```

Notes:
- Code signing requires an Apple Developer account and certificate.
- Unsigned apps may require users to allow the app in System Preferences > Security & Privacy.

Output:
- Files are placed under `dist/`.
- Look for `Whistant_Local.exe`, `Whistant_Local.AppImage`, or `Whistant_Local.dmg`.

## Pre-Build Setup: Download Cloudflared Binaries

Before creating distributable packages for platforms other than your current one, download the cloudflared binaries:

```bash
# Run this once before building
./scripts/download-cloudflared.sh
```

This downloads cloudflared binaries for:
- Windows x64
- Linux x64
- macOS ARM64 (Apple Silicon)
- macOS x64 (Intel)

The app automatically bundles the appropriate binary for each platform. See `bin/README.md` for more details.

## File Structure

```
whistant_local/
├── main.js              # Electron main process  
├── preload.js           # Electron IPC bridge
├── package.json         # Dependencies
├── bin/                 # Bundled cloudflared binaries
│   ├── darwin-arm64/    # macOS Apple Silicon
│   ├── darwin-x64/      # macOS Intel
│   ├── linux-x64/       # Linux x64
│   └── win32-x64/       # Windows x64
├── config/
│   └── defaults.json    # Default configuration
├── scripts/
│   ├── convert-icon.js  # Icon conversion utility
│   ├── pad-icon.js      # Icon adjustment utility
│   └── download-cloudflared.sh  # Binary download script
├── ui/
│   ├── index.html       # Registration UI
│   ├── app.js           # UI logic
│   └── styles.css       # Styling
├── README.md            # This file
├── .env                 # Configuration (optional)
└── .env.example         # Example configuration
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
