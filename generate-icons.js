const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT_DIR = path.join(__dirname, 'public');

function svg({ dark = false, adaptive = false } = {}) {
  const bg = dark ? '#0a0a0a' : '#ffffff';
  const fg = dark ? '#f5f5f5' : '#1a1a1a';
  const faint = dark ? '#5c5c5c' : '#c8c8c8';
  const style = adaptive ? `
  <style>
    .bg { fill: #fff; }
    .fg { stroke: #1a1a1a; fill: none; }
    .dot { fill: #1a1a1a; }
    .faint { stroke: #c8c8c8; }
    @media (prefers-color-scheme: dark) {
      .bg { fill: #0a0a0a; }
      .fg { stroke: #f5f5f5; }
      .dot { fill: #f5f5f5; }
      .faint { stroke: #5c5c5c; }
    }
  </style>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${style}
  <rect class="bg" width="512" height="512" fill="${bg}"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path class="faint" d="M144 330H368M144 256H368M144 182H368" stroke="${faint}" stroke-width="10" opacity="0.52"/>
    <path class="fg" d="M144 344L194 294L244 318L296 252L346 218L392 154" stroke="${fg}" stroke-width="24"/>
    <path class="fg" d="M128 374H392" stroke="${fg}" stroke-width="18"/>
    <path class="fg" d="M128 138V374" stroke="${fg}" stroke-width="18"/>
  </g>
  <circle class="dot" cx="392" cy="154" r="16" fill="${fg}"/>
</svg>`;
}

const outputs = [
  ['favicon.svg', svg({ adaptive: true })],
  ['icon-192.png', svg(), 192],
  ['icon-512.png', svg(), 512],
  ['apple-touch-icon.png', svg(), 180],
  ['icon-dark-192.png', svg({ dark: true }), 192],
  ['icon-dark-512.png', svg({ dark: true }), 512],
  ['apple-touch-icon-dark.png', svg({ dark: true }), 180],
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
