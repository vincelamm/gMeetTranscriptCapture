/**
 * generate-icons.js — Run once with Node.js to create placeholder PNG icons.
 * Requires the 'canvas' package: npm install canvas
 * Or just replace icons/ with your own 16x16, 48x48, 128x128 PNG files.
 *
 * Usage: node generate-icons.js
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1a73e8';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.15);
  ctx.fill();

  // Simple "speech bubble / transcript" icon
  ctx.fillStyle = '#ffffff';
  const pad = size * 0.2;
  const lineH = size * 0.12;
  const gap = size * 0.08;
  const w = size - pad * 2;
  for (let i = 0; i < 3; i++) {
    const y = pad + i * (lineH + gap);
    const lineW = i === 2 ? w * 0.6 : w;
    ctx.beginPath();
    ctx.roundRect(pad, y, lineW, lineH, lineH * 0.3);
    ctx.fill();
  }

  const buf = canvas.toBuffer('image/png');
  const outPath = path.join(__dirname, 'icons', `icon${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Written: ${outPath}`);
}
