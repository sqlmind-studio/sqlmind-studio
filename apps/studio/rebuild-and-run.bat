@echo off
echo Closing any running SQLMind Studio instances...
taskkill /F /IM "SQLMind Studio.exe" 2>nul
taskkill /F /IM electron.exe 2>nul
timeout /t 2 /nobreak >nul

echo Cleaning dist_electron folder...
rmdir /S /Q dist_electron 2>nul
timeout /t 1 /nobreak >nul

echo Building application...
call npm run build

echo.
echo Build complete! Now run:
echo   npm run electron:build
echo.
echo Or to run in development mode:
echo   npm run electron:serve
pause
