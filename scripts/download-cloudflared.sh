#!/bin/bash
# Download cloudflared binaries for all platforms
# Run this script before building the app for distribution

set -e

echo "📥 Downloading cloudflared binaries..."

# Create directories
mkdir -p bin/darwin-arm64 bin/darwin-x64 bin/linux-x64 bin/win32-x64

# macOS ARM64 (Apple Silicon)
echo "📦 Downloading macOS ARM64..."
cd bin/darwin-arm64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz -o cloudflared.tgz
tar -xzf cloudflared.tgz
rm cloudflared.tgz
chmod +x cloudflared
cd ../..

# macOS x64 (Intel)
echo "📦 Downloading macOS x64..."
cd bin/darwin-x64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz -o cloudflared.tgz
tar -xzf cloudflared.tgz
rm cloudflared.tgz
chmod +x cloudflared
cd ../..

# Linux x64
echo "📦 Downloading Linux x64..."
cd bin/linux-x64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
cd ../..

# Windows x64
echo "📦 Downloading Windows x64..."
cd bin/win32-x64
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -o cloudflared.exe
cd ../..

echo ""
echo "✅ All binaries downloaded successfully!"
echo ""
echo "Verifying downloads..."
./bin/darwin-arm64/cloudflared --version
./bin/darwin-x64/cloudflared --version
./bin/linux-x64/cloudflared --version
./bin/win32-x64/cloudflared.exe --version || echo "⚠️  Windows binary cannot be verified on this platform"
echo ""
echo "✅ Ready to build the app!"
