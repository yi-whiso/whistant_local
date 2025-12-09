#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
let pngToIco = require('png-to-ico');
// Handle CommonJS/ESM interop
pngToIco = pngToIco && typeof pngToIco === 'object' && 'default' in pngToIco ? pngToIco.default : pngToIco;

async function main() {
  const src = path.resolve(__dirname, '../ui/appicon.png');
  const dest = path.resolve(__dirname, '../ui/icon.ico');

  if (!fs.existsSync(src)) {
    console.error(`Source PNG not found: ${src}`);
    process.exit(1);
  }

  try {
    const buf = await pngToIco(src);
    fs.writeFileSync(dest, buf);
    console.log(`Generated ICO: ${dest}`);
  } catch (err) {
    console.error('Failed to convert PNG to ICO:', err);
    process.exit(1);
  }
}

main();
