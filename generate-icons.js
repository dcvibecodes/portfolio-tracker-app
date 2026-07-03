const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT_DIR = path.join(__dirname, 'public');

function svg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0a0a0a"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M144 330H368M144 256H368M144 182H368" stroke="#3f3f46" stroke-width="10" opacity="0.7"/>
    <path d="M144 344L194 294L244 318L296 252L346 218L392 154" stroke="#60a5fa" stroke-width="24"/>
    <path d="M128 374H392" stroke="#f5f5f5" stroke-width="18"/>
    <path d="M128 138V374" stroke="#f5f5f5" stroke-width="18"/>
  </g>
  <circle cx="392" cy="154" r="16" fill="#93c5fd"/>
</svg>`;
}

const outputs = [
  ['favicon.svg', svg()],
  ['icon-192.png', svg(), 192],
  ['icon-512.png', svg(), 512],
  ['apple-touch-icon.png', svg(), 180],
  ['favicon-16.png', svg(), 16],
  ['favicon-32.png', svg(), 32],
  ['favicon-16x16.png', svg(), 16],
  ['favicon-32x32.png', svg(), 32],
];

async function generate() {
  for (const [name, source, size] of outputs) {
    const outPath = path.join(OUTPUT_DIR, name);
    if (!size) {
      fs.writeFileSync(outPath, source);
      console.log(`Generated ${name}`);
    } else {
      await sharp(Buffer.from(source)).resize(size, size).png().toFile(outPath);
      console.log(`Generated ${name} (${size}x${size})`);
    }
  }
}

generate().catch(err => {
  console.error('Error generating icons:', err.message);
  process.exit(1);
});
