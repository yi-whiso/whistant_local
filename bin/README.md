# Cloudflared Binaries

This directory contains bundled cloudflared binaries for all supported platforms.

## Downloaded Binaries

| Platform | Architecture | File | Size |
|----------|-------------|------|------|
| Windows | x64 | `win32-x64/cloudflared.exe` | ~65 MB |
| Linux | x64 | `linux-x64/cloudflared` | ~39 MB |
| macOS | ARM64 (Apple Silicon) | `darwin-arm64/cloudflared` | ~38 MB |
| macOS | x64 (Intel) | `darwin-x64/cloudflared` | ~40 MB |

## Download Sources

All binaries are downloaded from the official CloudFlare GitHub releases:

```powershell
# Windows x64
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "bin\win32-x64\cloudflared.exe"

# Linux x64
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" -OutFile "bin\linux-x64\cloudflared"

# macOS ARM64
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz" -OutFile "bin\darwin-arm64\cloudflared.tgz"
tar -xzf "bin\darwin-arm64\cloudflared.tgz" -C "bin\darwin-arm64"
Remove-Item "bin\darwin-arm64\cloudflared.tgz"

# macOS x64
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz" -OutFile "bin\darwin-x64\cloudflared.tgz"
tar -xzf "bin\darwin-x64\cloudflared.tgz" -C "bin\darwin-x64"
Remove-Item "bin\darwin-x64\cloudflared.tgz"
```

Or use the bash script from the project root:
```bash
./scripts/download-cloudflared.sh
```

## Version Info

Current binaries: **cloudflared version 2025.11.1** (downloaded January 2026)

Official releases: https://github.com/cloudflare/cloudflared/releases

## Usage

These binaries are automatically detected and used by the Electron app's `main.js`:
- The app checks for bundled binaries in these directories first
- Falls back to system-installed cloudflared if bundled versions are not found
- Unix binaries (Linux/macOS) have executable permissions set automatically at runtime

## License

Cloudflared is licensed under the Apache License 2.0.
See: https://github.com/cloudflare/cloudflared/blob/master/LICENSE
