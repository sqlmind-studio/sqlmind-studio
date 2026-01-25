# Force close all instances
Write-Host "Closing all SQLMind Studio and Electron processes..." -ForegroundColor Yellow
Get-Process | Where-Object {$_.ProcessName -like "*SQLMind*" -or $_.ProcessName -eq "electron"} | Stop-Process -Force -ErrorAction SilentlyContinue

# Wait for processes to close
Start-Sleep -Seconds 3

# Remove dist_electron folder
Write-Host "Removing dist_electron folder..." -ForegroundColor Yellow
if (Test-Path "dist_electron") {
    Remove-Item -Path "dist_electron" -Recurse -Force -ErrorAction SilentlyContinue
}

# Wait a bit more
Start-Sleep -Seconds 2

# Build the application
Write-Host "Building application..." -ForegroundColor Green
npm run build

Write-Host ""
Write-Host "Build complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To run the application, use one of these commands:" -ForegroundColor Cyan
Write-Host "  1. Development mode: npm run electron:serve" -ForegroundColor White
Write-Host "  2. Production build: npm run electron:build" -ForegroundColor White
Write-Host ""
