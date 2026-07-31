/**
 * generate-icons.mjs — Genera los iconos PWA (PNG) para cada módulo
 *
 * Sin dependencias: encoder PNG minimalista (zlib + crc32) y render
 * procedural (corona dorada + jarra de cerveza) por módulo.
 *
 * Colores desde tokens SSOT (src/ui/tokens/tokens.json) y manifests
 * (src/core/config/pwa-registry.ts → theme_color/background_color).
 *
 * Uso: node scripts/generate-icons.mjs
 * Salida: public/icons/[modulo]-192.png y -512.png
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'icons');

// ============================================================
// PNG encoder minimalista (RGBA, 8-bit)
// ============================================================

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, pixels /* Uint8ClampedArray RGBA */) {
  // Cada fila: 1 byte de filtro (0 = none) + RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const pixelBuf = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixelBuf.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ============================================================
// Geometría (coordenadas relativas 0..1)
// ============================================================

function hexToRgba(hex, a = 1) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    Math.round(a * 255),
  ];
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x1 - r, x));
  const cy = Math.max(y0 + r, Math.min(y1 - r, y));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inTriangle(x, y, ax, ay, bx, by, cx2, cy2) {
  const sign = (p1x, p1y, p2x, p2y, p3x, p3y) =>
    (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx2, cy2);
  const d3 = sign(x, y, cx2, cy2, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function inAnnulus(x, y, cx, cy, r1, r2) {
  const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
  return d2 >= r1 * r1 && d2 <= r2 * r2;
}

// ============================================================
// Render del icono: corona + jarra
// ============================================================

function renderIcon(size, bgColor, accentColor) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const fill = (x, y, rgba) => {
    const i = (y * size + x) * 4;
    pixels[i] = rgba[0];
    pixels[i + 1] = rgba[1];
    pixels[i + 2] = rgba[2];
    pixels[i + 3] = rgba[3];
  };

  const bg = hexToRgba(bgColor);
  const gold = hexToRgba(accentColor);
  const goldSoft = hexToRgba(accentColor, 0.25);
  const foam = hexToRgba('#F4E8C1');
  const amber = hexToRgba('#E08B27');

  for (let py = 0; py < size; py++) {
    const y = (py + 0.5) / size;
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size;

      // Fondo: rounded rect
      if (inRoundedRect(x, y, 0.04, 0.04, 0.96, 0.96, 0.16)) {
        fill(px, py, bg);
      }

      // Corona (dorada)
      // Base de la corona
      if (inRoundedRect(x, y, 0.27, 0.30, 0.73, 0.375, 0.02)) {
        fill(px, py, gold);
      }
      // Picos (triángulos)
      const spikes = [0.30, 0.42, 0.54, 0.66];
      for (const cx of spikes) {
        if (inTriangle(x, y, cx - 0.05, 0.375, cx + 0.05, 0.375, cx, 0.235)) {
          fill(px, py, gold);
        }
      }
      // Perlas en las puntas
      for (const cx of spikes) {
        if (inCircle(x, y, cx, 0.228, 0.022)) {
          fill(px, py, gold);
        }
      }

      // Jarra de cerveza
      // Cuerpo (cristal ámbar translúcido)
      if (inRoundedRect(x, y, 0.35, 0.46, 0.65, 0.79, 0.03)) {
        fill(px, py, goldSoft);
      }
      // Borde de la jarra
      if (inRoundedRect(x, y, 0.345, 0.455, 0.655, 0.795, 0.03) &&
          !inRoundedRect(x, y, 0.362, 0.472, 0.638, 0.778, 0.02)) {
        fill(px, py, gold);
      }
      // Espuma (crema)
      if (inRoundedRect(x, y, 0.35, 0.46, 0.65, 0.54, 0.03)) {
        fill(px, py, foam);
      }
      // Línea de cerveza dentro del vaso
      if (inRoundedRect(x, y, 0.365, 0.60, 0.635, 0.615, 0)) {
        fill(px, py, amber);
      }
      if (inRoundedRect(x, y, 0.365, 0.68, 0.635, 0.695, 0)) {
        fill(px, py, amber);
      }
      // Mango (anillo derecho)
      if (x > 0.655 && inAnnulus(x, y, 0.692, 0.625, 0.045, 0.075)) {
        fill(px, py, gold);
      }
    }
  }

  return encodePng(size, size, pixels);
}

// ============================================================
// Módulos (colores = manifests/pwa-registry SSOT)
// ============================================================

const MODULES = [
  { id: 'clientes', bg: '#1A0F0A', accent: '#D4AF37' },
  { id: 'cocina',   bg: '#0A0A0A', accent: '#D4AF37' },
  { id: 'bar',      bg: '#1A0F0A', accent: '#E08B27' },
  { id: 'meseros',  bg: '#1A0F0A', accent: '#D4AF37' },
  { id: 'caja',     bg: '#1A0F0A', accent: '#0D5C3A' },
  { id: 'admin',    bg: '#1A0F0A', accent: '#D4AF37' },
];

// ============================================================
// Main
// ============================================================

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const mod of MODULES) {
  for (const size of [192, 512]) {
    const png = renderIcon(size, mod.bg, mod.accent);
    const outFile = path.join(OUT_DIR, `${mod.id}-${size}.png`);
    fs.writeFileSync(outFile, png);
    console.log(`✓ ${path.relative(ROOT, outFile)} (${png.length} bytes)`);
  }
}

console.log('Icons generated.');
