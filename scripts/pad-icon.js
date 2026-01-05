#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function padIcon() {
  const uiDir = path.join(__dirname, '..', 'ui');
  const sourceIcon = path.join(uiDir, 'appicon.png');
  const paddedIcon = path.join(uiDir, 'appicon_padded.png');
  
  if (!fs.existsSync(sourceIcon)) {
    console.error(`Source icon not found: ${sourceIcon}`);
    process.exit(1);
  }

  try {
    console.log('Creating icon with moderate padding...');
    
    // Use sips to:
    // 1. Resize to 815x815 (maintains good size)
    // 2. Then canvas to 1024x1024 (adds moderate padding)
    // This provides a nice balance - not too small, not filling the entire space
    execSync(`sips -z 815 815 "${sourceIcon}" --out "${paddedIcon}"`, { stdio: 'pipe' });
    execSync(`sips -c 1024 1024 "${paddedIcon}" --out "${paddedIcon}"`, { stdio: 'pipe' });
    
    console.log(`✅ Created padded icon: ${paddedIcon}`);
    console.log('Icon has moderate padding for proper taskbar appearance');
  } catch (err) {
    console.error('Failed to pad icon:', err.message);
    process.exit(1);
  }
}

padIcon();
