/**
 * Genererer PNG-ikonene til appen. Tegner samme motiv som icon.svg med
 * enkel rasterisering, slik at bygget ikke trenger bildeverktøy.
 *
 * Kjøres med: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../public/icons/', import.meta.url);

const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Tegner ikonet i gitt størrelse. `padding` gir plass til maskable-ikoner. */
function draw(size, { padding = 0 } = {}) {
  const px = new Uint8Array(size * size * 4);
  const bg = rgb('#0f172a');
  const blue = rgb('#3b82f6');
  const light = rgb('#e8edf7');
  const red = rgb('#ef4444');

  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const na = a / 255;
    px[i] = Math.round(px[i] * (1 - na) + r * na);
    px[i + 1] = Math.round(px[i + 1] * (1 - na) + g * na);
    px[i + 2] = Math.round(px[i + 2] * (1 - na) + b * na);
    px[i + 3] = 255;
  };

  const rect = (x0, y0, w, h, color) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) set(x, y, color);
  };

  const s = size;
  const inner = s * (1 - padding * 2);
  const o = s * padding;
  const u = (v) => o + (v / 512) * inner; // koordinater fra SVG-en (512x512)
  const w = (v) => (v / 512) * inner;

  // Bakgrunn med avrundede hjørner.
  const radius = w(96);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = Math.max(o + radius - x, 0, x - (o + inner - radius));
      const dy = Math.max(o + radius - y, 0, y - (o + inner - radius));
      if (x < o || y < o || x >= o + inner || y >= o + inner) continue;
      if (Math.hypot(dx, dy) <= radius) set(x, y, bg);
    }
  }

  // Blå hjørnemarkører som antyder en søker.
  const t = w(26);
  const arm = w(78);
  for (const [cx, cy, sx, sy] of [
    [u(108), u(108), 1, 1], [u(404), u(108), -1, 1],
    [u(108), u(404), 1, -1], [u(404), u(404), -1, -1],
  ]) {
    rect(sx > 0 ? cx : cx - arm, sy > 0 ? cy : cy - t, arm, t, blue);
    rect(sx > 0 ? cx : cx - t, sy > 0 ? cy : cy - arm, t, arm, blue);
  }

  // Strekkodestreker.
  for (const x of [176, 224, 272, 320]) rect(u(x) - w(11), u(180), w(22), w(152), light);

  // Rød skannelinje.
  rect(u(120), u(256) - w(7), w(272), w(14), red);

  return px;
}

function png(width, height, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bitdybde
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtertype
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable.png', 512, { padding: 0.1 }],
];
for (const [name, size, opts] of targets) {
  writeFileSync(new URL(name, OUT), png(size, size, draw(size, opts)));
  console.log('skrev', name, size + 'x' + size);
}
