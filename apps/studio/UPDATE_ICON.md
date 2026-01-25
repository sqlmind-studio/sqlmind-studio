# SQLMind Studio - Icon Update Required

## Current Status
✅ Windows ICO file is in place: `public/icons/win/favicon.ico`
❌ macOS ICNS file is MISSING: `public/icons/mac/sqlmind-icon.icns`
❌ PNG icons not updated yet

## Why the Icon Didn't Change
The Electron app needs **both** ICO (Windows) and ICNS (macOS) files, plus PNG files for different sizes.

## Quick Fix - Create ICNS File

### Option 1: Online Converter (FASTEST)
1. Go to: https://cloudconvert.com/ico-to-icns
2. Upload: `F:\BlogBusiness\sqltools.co\sqlmind-studio-5.4.9\sqlmind-studio-5.4.9\apps\studio\SQLMind.ico`
3. Convert to ICNS
4. Download and save as: `public/icons/mac/sqlmind-icon.icns`

### Option 2: Use iConvert Icons
1. Go to: https://iconverticons.com/online/
2. Upload your `SQLMind.ico`
3. Select "ICNS for macOS"
4. Download and save to: `public/icons/mac/sqlmind-icon.icns`

## Extract PNG Icons (Recommended)

Also extract PNG files for better quality:

1. Go to: https://www.icoconverter.com/
2. Upload `SQLMind.ico`
3. Click "Extract" to get all PNG sizes
4. Save them to `public/icons/png/` folder:
   - 16x16.png
   - 32x32.png
   - 48x48.png
   - 64x64.png
   - 128x128.png
   - 256x256.png
   - 512x512.png

## After Creating the ICNS File

1. **Delete the old build:**
   ```powershell
   Remove-Item -Recurse -Force apps\studio\dist_electron
   ```

2. **Rebuild the app:**
   ```powershell
   yarn bks:build
   ```

3. **Your new icon will appear in:**
   - App title bar
   - Taskbar/Dock
   - Desktop shortcuts
   - Start Menu/Launchpad

## Files Checklist

- [x] `public/icons/win/favicon.ico` - Windows icon (DONE)
- [ ] `public/icons/mac/sqlmind-icon.icns` - macOS icon (NEEDED)
- [ ] `public/icons/png/*.png` - PNG icons (OPTIONAL)

## Note
The icon in the file explorer (your screenshot) is the Windows file icon. The actual app icon will show when you run the built application.
