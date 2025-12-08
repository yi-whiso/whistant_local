# Whistant - Windows Ollama Server Registration

Register your Windows Ollama server with the Whistant iPhone app using a link code.

## Quick Start

### Prerequisites
- Windows 10+
- Ollama running on localhost:11434
- Ollama models pulled: for good performance, suggest agent model gpt-oss:20b, reasoning model deepseek-r1:14b
- Cloudflared
- Nvidia GPU with 24 GB or larger graphic memory; driver and cuda driver ready
- Node.js with npm installed

### Installation
```powershell
cd c:\Users\xxx\whistant_local
npm install
```

### Usage

#### Step 1: Start the app
```powershell
npm start
```

#### Step 2: (Optional) Start a public tunnel in another terminal
If you need access from outside your network:
```powershell
cloudflared tunnel --url http://localhost:11434
```

#### Step 3: Register in the app
1. Get a 6-character link code from your iPhone's Whistant app
2. Paste it in the Windows app
3. Click "Register Server"
4. Done!

## How It Works

1. **iPhone app generates link code** - User taps "Link Ollama Server" on iPhone
2. **Windows app receives link code** - User enters the code in the registration UI
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
```powershell
scoop install cloudflared
```

Then in a separate terminal:
```powershell
cloudflared tunnel --url http://localhost:11434
```

Keep this running. The app will automatically detect the tunnel URL.

### ngrok (Alternative)
```powershell
scoop install ngrok
```

Then:
```powershell
ngrok http 11434
```

## Development

### Dev mode with DevTools
```powershell
npm run dev
```

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
Windows Whistant App
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
