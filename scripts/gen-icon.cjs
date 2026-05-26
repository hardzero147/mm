'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Smooth step for anti-alias approximation
function smoothStep(edge0, edge1, t) {
  const x = Math.max(0, Math.min(1, (t - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function getPixel(x, y, size) {
  const s = size;
  const mid = s / 2;

  // ── Geometry ──────────────────────────────────────────────
  const chipStart = Math.floor(s * 0.26);
  const chipEnd   = Math.ceil(s * 0.74);
  const chipSize  = chipEnd - chipStart;
  const bdr  = Math.max(1, Math.floor(s * 0.048));   // border thickness
  const pinH = Math.max(2, Math.floor(s * 0.115));   // pin length (outward)
  const pinW = Math.max(1, Math.floor(s * 0.048));   // pin half-width
  const pinSpacing = Math.floor(chipSize / 4);        // 3 pins per side

  const pinPositions = [
    chipStart + pinSpacing,
    chipStart + pinSpacing * 2,
    chipStart + pinSpacing * 3,
  ];

  // ── Colors ────────────────────────────────────────────────
  const C_BG_DARK    = [0x09, 0x0d, 0x18];
  const C_BG_MID     = [0x10, 0x16, 0x28];
  const C_CHIP_BG    = [0x12, 0x16, 0x26];
  const C_INNER_BG   = [0x0b, 0x0f, 0x1d];
  const C_BORDER     = [0x35, 0xba, 0xac];
  const C_PIN        = [0x40, 0xca, 0xbc];
  const C_TRACE      = [0x18, 0x62, 0x5a];
  const C_NODE       = [0x68, 0xe8, 0xdc];
  const C_NODE_DIM   = [0x28, 0x96, 0x8c];

  // ── Background radial gradient ────────────────────────────
  const distC = Math.sqrt((x - mid) ** 2 + (y - mid) ** 2) / (mid * 1.1);
  const bgT   = Math.min(1, distC);
  let r = lerp(C_BG_MID[0], C_BG_DARK[0], bgT);
  let g = lerp(C_BG_MID[1], C_BG_DARK[1], bgT);
  let b = lerp(C_BG_MID[2], C_BG_DARK[2], bgT);

  // ── Pins (drawn before chip body so chip overlaps) ────────
  let inPin = false;
  for (const pp of pinPositions) {
    if (x >= pp - pinW && x <= pp + pinW) {
      if (y >= chipStart - pinH && y < chipStart) inPin = true; // top
      if (y >= chipEnd && y <= chipEnd + pinH)    inPin = true; // bottom
    }
    if (y >= pp - pinW && y <= pp + pinW) {
      if (x >= chipStart - pinH && x < chipStart) inPin = true; // left
      if (x >= chipEnd && x <= chipEnd + pinH)    inPin = true; // right
    }
  }
  if (inPin) { [r, g, b] = C_PIN; }

  // Pin base highlight (where pin meets chip)
  if (!inPin) {
    for (const pp of pinPositions) {
      const baseW = pinW + 1;
      if (x >= pp - baseW && x <= pp + baseW) {
        if (y === chipStart - 1 || y === chipEnd) { [r, g, b] = C_BORDER; }
      }
      if (y >= pp - baseW && y <= pp + baseW) {
        if (x === chipStart - 1 || x === chipEnd) { [r, g, b] = C_BORDER; }
      }
    }
  }

  // ── Chip body ─────────────────────────────────────────────
  if (x >= chipStart && x < chipEnd && y >= chipStart && y < chipEnd) {
    const onBorder =
      x < chipStart + bdr || x >= chipEnd - bdr ||
      y < chipStart + bdr || y >= chipEnd - bdr;

    if (onBorder) {
      // Subtle corner highlight
      const onCorner =
        (x < chipStart + bdr && y < chipStart + bdr) ||
        (x >= chipEnd - bdr  && y < chipStart + bdr) ||
        (x < chipStart + bdr && y >= chipEnd - bdr)  ||
        (x >= chipEnd - bdr  && y >= chipEnd - bdr);
      if (onCorner) {
        [r, g, b] = [
          Math.floor(C_BORDER[0] * 0.7),
          Math.floor(C_BORDER[1] * 0.7),
          Math.floor(C_BORDER[2] * 0.7),
        ];
      } else {
        [r, g, b] = C_BORDER;
      }
    } else {
      [r, g, b] = C_CHIP_BG;
    }
  }

  // ── Inner chip area ───────────────────────────────────────
  const innerStart = chipStart + bdr * 2;
  const innerEnd   = chipEnd   - bdr * 2;

  if (x >= innerStart && x < innerEnd && y >= innerStart && y < innerEnd) {
    [r, g, b] = C_INNER_BG;

    if (size >= 32) {
      const iMid = Math.floor((innerStart + innerEnd) / 2);
      const span = Math.floor((innerEnd - innerStart) * 0.30);
      const trW  = Math.max(1, Math.floor(s * 0.018));
      const nodeR = Math.max(1, Math.floor(s * 0.042));
      const nodeSmall = Math.max(1, Math.floor(s * 0.024));

      // Corner nodes (4) + center node
      const nodes = [
        [iMid - span, iMid - span, nodeR],
        [iMid + span, iMid - span, nodeR],
        [iMid - span, iMid + span, nodeR],
        [iMid + span, iMid + span, nodeR],
        [iMid,        iMid,        nodeR],
      ];

      // Mid-edge nodes (4) – only at 48px+
      if (size >= 48) {
        nodes.push(
          [iMid,        iMid - span, nodeSmall],
          [iMid,        iMid + span, nodeSmall],
          [iMid - span, iMid,        nodeSmall],
          [iMid + span, iMid,        nodeSmall],
        );
      }

      // Traces: bounding rectangle + diagonals + cross
      // Top edge
      if (Math.abs(y - (iMid - span)) < trW && x > iMid - span && x < iMid + span)
        [r, g, b] = C_TRACE;
      // Bottom edge
      if (Math.abs(y - (iMid + span)) < trW && x > iMid - span && x < iMid + span)
        [r, g, b] = C_TRACE;
      // Left edge
      if (Math.abs(x - (iMid - span)) < trW && y > iMid - span && y < iMid + span)
        [r, g, b] = C_TRACE;
      // Right edge
      if (Math.abs(x - (iMid + span)) < trW && y > iMid - span && y < iMid + span)
        [r, g, b] = C_TRACE;
      // Center cross (only 48px+)
      if (size >= 48) {
        if (Math.abs(x - iMid) < trW && y > iMid - span && y < iMid + span)
          [r, g, b] = C_TRACE;
        if (Math.abs(y - iMid) < trW && x > iMid - span && x < iMid + span)
          [r, g, b] = C_TRACE;
      }

      // Draw nodes (on top of traces)
      for (const [nx, ny, nr] of nodes) {
        const d2 = (x - nx) ** 2 + (y - ny) ** 2;
        if (d2 < nr * nr) {
          const edge = smoothStep(nr * 0.5, nr, Math.sqrt(d2));
          const nc = nx === iMid && ny === iMid ? C_NODE : C_NODE_DIM;
          r = lerp(C_NODE[0], nc[0], edge);
          g = lerp(C_NODE[1], nc[1], edge);
          b = lerp(C_NODE[2], nc[2], edge);
        }
      }
    }
  }

  // ── Pin 1 marker (notch at top-left of chip) ──────────────
  if (size >= 32) {
    const notchR = Math.max(1, Math.floor(s * 0.03));
    const notchX = chipStart + bdr + notchR + 1;
    const notchY = chipStart + bdr + notchR + 1;
    const d2 = (x - notchX) ** 2 + (y - notchY) ** 2;
    if (d2 < notchR * notchR &&
        x >= innerStart && x < innerEnd &&
        y >= innerStart && y < innerEnd) {
      [r, g, b] = [0x2a, 0x90, 0x88];
    }
  }

  return { r, g, b };
}

// ── BMP / ICO generation (unchanged from original) ──────────

function createBMPForIcon(size) {
  const width = size;
  const height = size;
  const rowSize = Math.floor((width * 3 + 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const andRowSize = Math.floor((width + 31) / 32) * 4;
  const andMaskSize = andRowSize * height;
  const totalSize = 40 + pixelDataSize + andMaskSize;
  const buf = Buffer.alloc(totalSize, 0);

  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(width, 4);
  buf.writeInt32LE(height * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(24, 14);
  buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(pixelDataSize, 20);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, g, b } = getPixel(x, height - 1 - y, size);
      const offset = 40 + y * rowSize + x * 3;
      buf[offset]     = b;
      buf[offset + 1] = g;
      buf[offset + 2] = r;
    }
  }

  return { buf, size: totalSize };
}

function generateICO(outputPath) {
  const sizes = [16, 32, 48, 256];
  const images = sizes.map(size => createBMPForIcon(size));

  const headerSize = 6 + 16 * sizes.length;
  const totalSize = headerSize + images.reduce((sum, img) => sum + img.size, 0);
  const ico = Buffer.alloc(totalSize, 0);

  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(sizes.length, 4);

  let dataOffset = headerSize;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const img  = images[i];
    const entry = 6 + i * 16;

    ico[entry]     = size === 256 ? 0 : size;
    ico[entry + 1] = size === 256 ? 0 : size;
    ico[entry + 2] = 0;
    ico[entry + 3] = 0;
    ico.writeUInt16LE(1, entry + 4);
    ico.writeUInt16LE(24, entry + 6);
    ico.writeUInt32LE(img.size, entry + 8);
    ico.writeUInt32LE(dataOffset, entry + 12);

    img.buf.copy(ico, dataOffset);
    dataOffset += img.size;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, ico);
  console.log(`Generated ${path.basename(outputPath)} (${sizes.join(', ')}px)`);
}

generateICO(path.join(__dirname, '..', 'build', 'icon.ico'));
