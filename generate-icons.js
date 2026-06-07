// Generate PNG icons from the SVG favicon for Apple touch icon and favicons
// Run: node generate-icons.js

const fs = require('fs');
const path = require('path');

// We'll create a simple PNG using canvas-like approach
// Since we want to avoid heavy dependencies, let's use the 'sharp' package if available,
// otherwise create a standalone HTML file that can be opened in a browser to generate the icons.

try {
  const sharp = require('sharp');
  
  const svgPath = path.join(__dirname, 'public', 'favicon.svg');
  const svg = fs.readFileSync(svgPath);

  const sizes = [
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 },
  ];

  async function generate() {
    for (const { name, size } of sizes) {
      await sharp(svg)
        .resize(size, size)
        .png()
        .toFile(path.join(__dirname, 'public', name));
      console.log(`Generated ${name} (${size}x${size})`);
    }
    console.log('\nAll icons generated successfully!');
  }

  generate().catch(err => {
    console.error('Error generating icons:', err.message);
    console.log('\nFallback: Open public/generate-icons.html in a browser to generate icons manually.');
  });

} catch (e) {
  console.log('sharp not installed. Installing...');
  const { execSync } = require('child_process');
  try {
    execSync('npm install sharp --save-dev', { cwd: __dirname, stdio: 'inherit' });
    console.log('sharp installed. Run this script again: node generate-icons.js');
  } catch (installErr) {
    console.error('Could not install sharp. Creating browser-based generator instead...');
    console.log('Open public/generate-icons.html in a browser to generate icons manually.');
  }
}
