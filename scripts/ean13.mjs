/**
 * Tegner en EAN-13-strekkode som punktmatrise. Brukes av kameratesten for
 * å mate et ekte, skannbart bilde inn i nettleseren.
 */
const A = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const B = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const C = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PARITY = ['AAAAAA','AABABB','AABBAB','AABBBA','ABAABB','ABBAAB','ABBBAA','ABABAB','ABABBA','ABBABA'];

/** Returnerer de 95 modulene i en EAN-13-kode som en streng av 0/1. */
export function ean13Modules(code) {
  const d = String(code).replace(/\D/g, '');
  if (d.length !== 13) throw new Error('EAN-13 må ha 13 siffer');
  const parity = PARITY[Number(d[0])];
  let out = '101';
  for (let i = 0; i < 6; i++) out += (parity[i] === 'A' ? A : B)[Number(d[i + 1])];
  out += '01010';
  for (let i = 7; i < 13; i++) out += C[Number(d[i])];
  return out + '101';
}

/**
 * Rasteriserer koden midt på et hvitt bilde. Returnerer en gråtoneflate
 * (én byte per piksel) i oppgitt størrelse.
 */
export function renderEan13(code, { width = 640, height = 480, scale = 4, barHeight = 220 } = {}) {
  const modules = ean13Modules(code);
  const gray = new Uint8Array(width * height).fill(255);
  const barWidth = modules.length * scale;
  const x0 = Math.floor((width - barWidth) / 2);
  const y0 = Math.floor((height - barHeight) / 2);
  for (let m = 0; m < modules.length; m++) {
    if (modules[m] !== '1') continue;
    for (let x = x0 + m * scale; x < x0 + (m + 1) * scale; x++) {
      for (let y = y0; y < y0 + barHeight; y++) gray[y * width + x] = 0;
    }
  }
  return { gray, width, height };
}

/** Pakker gråtonebildet som en Y4M-videofil Chromium kan bruke som kamera. */
export function toY4m({ gray, width, height }, frames = 30) {
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420\n`, 'ascii');
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n', 'ascii'), Buffer.from(gray), chroma, chroma]);
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]);
}
