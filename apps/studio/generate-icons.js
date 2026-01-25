// Node.js script to generate all required icon sizes
// Install sharp first: npm install sharp
// Then run: node generate-icons.js

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sourceIcon = 'mind-map-50.png';
const outputDir = 'public/icons/png';

// Icon sizes needed
const sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`Generating icon sizes from ${sourceIcon}...`);

async function generateIcons() {
  for (const size of sizes) {
    const output = path.join(outputDir, `${size}x${size}.png`);
    
    try {
      await sharp(sourceIcon)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(output);
      
      console.log(`  ✓ Created ${size}x${size}.png`);
    } catch (error) {
      console.error(`  ✗ Failed to create ${size}x${size}.png:`, error.message);
    }
  }
  
  console.log('\n✓ All PNG icons generated successfully!');
  console.log('\nNext steps:');
  console.log('1. For Windows ICO, use an online converter or ImageMagick');
  console.log('2. For macOS ICNS, use iconutil on macOS or an online converter');
  console.log('3. Or use https://www.icoconverter.com/ for both');
}

generateIcons().catch(console.error);
