/**
 * Generates NSIS installer BMP assets:
 *   build/installer-header.bmp  – 150×57  (top banner shown on all pages)
 *   build/installer-sidebar.bmp – 164×314 (left panel on welcome/finish pages)
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });

function writeBMP(filePath, width, height, getPixel) {
  const rowSize = Math.floor((width * 3 + 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buf = Buffer.alloc(fileSize, 0);

  // File header
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10); // pixel data offset

  // BITMAPINFOHEADER
  buf.writeUInt32LE(40, 14); // header size
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(-height, 22); // negative = top-down
  buf.writeUInt16LE(1, 26);  // planes
  buf.writeUInt16LE(24, 28); // bpp
  buf.writeUInt32LE(0, 30);  // compression (none)
  buf.writeUInt32LE(pixelDataSize, 34);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getPixel(x, y, width, height);
      const offset = 54 + y * rowSize + x * 3;
      buf[offset] = b;
      buf[offset + 1] = g;
      buf[offset + 2] = r;
    }
  }

  fs.writeFileSync(filePath, buf);
  console.log(`Generated ${path.basename(filePath)} (${width}×${height})`);
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// --- Header BMP 150×57 ---
// Dark navy gradient, teal accent stripe at bottom, subtle right highlight
writeBMP(path.join(buildDir, 'installer-header.bmp'), 150, 57, (x, y, w, h) => {
  const tx = x / (w - 1);
  const ty = y / (h - 1);

  // Base: dark navy → slightly lighter
  let r = lerp(0x17, 0x1e, ty * 0.6 + tx * 0.4);
  let g = lerp(0x19, 0x22, ty * 0.6 + tx * 0.4);
  let b = lerp(0x1e, 0x28, ty * 0.6 + tx * 0.4);

  // Teal stripe at bottom 4px
  if (y >= h - 4) {
    const stripT = (y - (h - 4)) / 4;
    r = lerp(0x35, 0x17, stripT);
    g = lerp(0xba, 0x19, stripT);
    b = lerp(0xac, 0x1e, stripT);
  }

  // Subtle teal glow on left
  const glowX = Math.max(0, 1 - tx * 3);
  r = Math.min(255, r + Math.round(glowX * 0x18));
  g = Math.min(255, g + Math.round(glowX * 0x38));
  b = Math.min(255, b + Math.round(glowX * 0x38));

  return { r, g, b };
});

// --- Sidebar BMP 164×314 ---
// Dark gradient with teal/blue gradient at top, subtle geometric accent
writeBMP(path.join(buildDir, 'installer-sidebar.bmp'), 164, 314, (x, y, w, h) => {
  const tx = x / (w - 1);
  const ty = y / (h - 1);

  // Base dark gradient (top darker, bottom slightly lighter)
  let r = lerp(0x13, 0x1e, ty);
  let g = lerp(0x15, 0x22, ty);
  let b = lerp(0x1a, 0x28, ty);

  // Top teal gradient zone (top 30%)
  if (ty < 0.30) {
    const t = ty / 0.30;
    const tealR = lerp(0x25, 0x13, t);
    const tealG = lerp(0x52, 0x15, t);
    const tealB = lerp(0x4e, 0x1a, t);
    r = lerp(tealR, r, t * t);
    g = lerp(tealG, g, t * t);
    b = lerp(tealB, b, t * t);
  }

  // Vertical teal line at x=4..6 (decorative stripe)
  if (x >= w - 3 && x <= w - 1) {
    const stripeT = Math.min(1, Math.abs(x - (w - 2)) / 2);
    r = lerp(0x35, r, stripeT);
    g = lerp(0xba, g, stripeT);
    b = lerp(0xac, b, stripeT);
  }

  // Subtle right-edge glow
  const edgeGlow = Math.max(0, 1 - (1 - tx) * 8);
  g = Math.min(255, g + Math.round(edgeGlow * 24));
  b = Math.min(255, b + Math.round(edgeGlow * 18));

  return { r: Math.min(255, r), g: Math.min(255, g), b: Math.min(255, b) };
});

console.log('Done! BMP assets saved to build/');
