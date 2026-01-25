# SQLMind Studio - Icon Setup Guide

Your new logo `mind-map-50.png` needs to be converted to multiple sizes and formats for the app to display correctly across all platforms.

## Quick Setup (Recommended)

### Option 1: Online Icon Generator (Easiest)
1. **Get a higher resolution version** of your logo (ideally 1024x1024 or at least 512x512)
   - If you only have 50x50, upscale it first using an AI upscaler like:
     - https://www.upscale.media/
     - https://bigjpg.com/
     - https://letsenhance.io/

2. **Generate all icon sizes** using an online tool:
   - Go to: https://www.icoconverter.com/
   - Upload your high-res logo
   - Select "ICO for Windows" and "ICNS for macOS"
   - Download the generated files

3. **Replace the icons**:
   - Extract PNG files to: `public/icons/png/`
   - Copy the .ico file to: `public/icons/win/favicon.ico`
   - Copy the .icns file to: `public/icons/mac/bk-icon.icns`

### Option 2: Using Node.js Script
```bash
# Install sharp package
npm install sharp

# Run the icon generator
node generate-icons.js

# Then use online tools for ICO and ICNS formats
```

### Option 3: Using ImageMagick
```powershell
# Install ImageMagick from: https://imagemagick.org/script/download.php

# Run the PowerShell script
.\generate-icons.ps1
```

## Required Icon Files

### PNG Icons (public/icons/png/)
- 16x16.png
- 24x24.png
- 32x32.png
- 48x48.png
- 64x64.png
- 96x96.png
- 128x128.png
- 256x256.png
- 512x512.png
- 1024x1024.png

### Windows Icon (public/icons/win/)
- favicon.ico (multi-size ICO file)

### macOS Icon (public/icons/mac/)
- bk-icon.icns (multi-size ICNS file)

## Important Notes

⚠️ **Current Issue**: Your source logo is only 50x50 pixels. This is too small for high-quality icons.

**Recommendation**: 
1. Get or create a vector version (SVG) of your logo
2. Or get a high-resolution PNG (at least 1024x1024)
3. This will ensure sharp, crisp icons at all sizes

## After Replacing Icons

1. Delete the build cache:
   ```bash
   rm -rf dist_electron
   rm -rf dist
   ```

2. Rebuild the app:
   ```bash
   yarn build
   ```

3. The new SQLMind Studio logo will appear in:
   - App window title bar
   - Taskbar/Dock
   - Desktop shortcut
   - Windows Start Menu
   - macOS Launchpad

## Current Logo
Your new logo is a mind map/network icon - perfect for an AI-powered database tool! 🧠✨
