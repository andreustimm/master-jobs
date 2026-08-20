import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

/**
 * Gera PNG sem dependência: chunks IHDR/IDAT/IEND escritos à mão.
 * Um ícone de app é um quadrado de cor com um glifo; puxar uma biblioteca de
 * imagem para isso seria pagar caro por um retângulo.
 */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Fundo do tema hp escuro (#101215) com o chevron do design em azul (#4d8bff).
const BG = [0x10, 0x12, 0x15];
const FG = [0x4d, 0x8b, 0xff];

/**
 * O chevron ">" do `type-display` — a marca que já está na interface.
 *
 * `inset` encolhe o glifo para a zona segura de 80% do ícone maskable: fora
 * dela o Android recorta, e um chevron cortado vira um risco.
 */
function chevron(x, y, size, inset) {
  const half = inset ? 0.22 : 0.28; // metade da altura do glifo
  const thickness = inset ? 0.062 : 0.075;
  const cx = x / size - 0.5;
  const cy = y / size - 0.5;

  // Ponta à DIREITA: as duas hastes partem de (-half, ∓half) e encontram-se em
  // (+half*0.72, 0). A distância à reta é o que dá espessura constante.
  const tipX = half * 0.72;
  const dyUpper = Math.abs(cy + half - ((cx + half) / (tipX + half)) * half);
  const dyLower = Math.abs(cy - half + ((cx + half) / (tipX + half)) * half);
  const inSpan = cx >= -half && cx <= tipX;

  return inSpan && (dyUpper < thickness || dyLower < thickness);
}

for (const [file, size, inset] of [
  ["public/icons/icon-192.png", 192, false],
  ["public/icons/icon-512.png", 512, false],
  // Maskable: o conteúdo vive na zona segura de 80%, senão o Android corta.
  ["public/icons/icon-maskable-512.png", 512, true],
]) {
  writeFileSync(file, png(size, (x, y, s) => {
    const on = chevron(x, y, s, inset);
    return on ? [...FG, 255] : [...BG, 255];
  }));
  console.log("gerado", file);
}
