# PowerShell script to generate all required icon sizes
# Requires ImageMagick to be installed: https://imagemagick.org/script/download.php

$sourceIcon = "mind-map-50.png"
$outputDir = "public\icons\png"

# Create output directory if it doesn't exist
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Icon sizes needed
$sizes = @(16, 24, 32, 48, 64, 96, 128, 256, 512, 1024)

Write-Host "Generating icon sizes from $sourceIcon..." -ForegroundColor Green

foreach ($size in $sizes) {
    $output = "$outputDir\${size}x${size}.png"
    Write-Host "  Creating ${size}x${size}.png..."
    
    # Use ImageMagick to resize
    magick convert $sourceIcon -resize "${size}x${size}" -background none -gravity center -extent "${size}x${size}" $output
}

Write-Host "`nAll PNG icons generated successfully!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Generate Windows ICO: magick convert public\icons\png\*.png public\icons\win\favicon.ico"
Write-Host "2. Generate macOS ICNS: Use 'iconutil' on macOS or online converter"
Write-Host "3. Or use online tools like https://www.icoconverter.com/"
