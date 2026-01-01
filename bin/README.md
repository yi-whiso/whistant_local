# Cloudflared Binaries

This directory contains platform-specific cloudflared binaries bundled with the app.

## Download Instructions

Download the appropriate cloudflared binary for each platform:

### macOS ARM64 (Apple Silicon)
```bash
cd bin/darwin-arm64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz -o cloudflared.tgz
tar -xzf cloudflared.tgz
rm cloudflared.tgz
chmod +x cloudflared
```

### macOS x64 (Intel)
```bash
cd bin/darwin-x64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz -o cloudflared.tgz
tar -xzf cloudflared.tgz
rm cloudflared.tgz
chmod +x cloudflared
```

### Linux x64
```bash
cd bin/linux-x64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
```

### Windows x64
```bash
cd bin/win32-x64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -o cloudflared.exe
```

## Alternative: Download All at Once

Run this script from the `whistant_local` directory:

```bash
# macOS ARM64
mkdir -p bin/darwin-arm64 && cd bin/darwin-arm64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz -o cloudflared.tgz
tar -xzf cloudflared.tgz && rm cloudflared.tgz && chmod +x cloudflared
cd ../..

# macOS x64
mkdir -p bin/darwin-x64 && cd bin/darwin-x64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz -o cloudflared.tgz
tar -xzf cloudflared.tgz && rm cloudflared.tgz && chmod +x cloudflared
cd ../..

# Linux x64
mkdir -p bin/linux-x64 && cd bin/linux-x64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
cd ../..

# Windows x64
mkdir -p bin/win32-x64 && cd bin/win32-x64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -o cloudflared.exe
cd ../..
```

## Verify Installation

After downloading, verify each binary:
```bash
./bin/darwin-arm64/cloudflared --version
./bin/darwin-x64/cloudflared --version
./bin/linux-x64/cloudflared --version
./bin/win32-x64/cloudflared.exe --version
```

## Note

These binaries are not included in the Git repository due to their size. You must download them before building the app for distribution.
