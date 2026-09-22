/**
 * Prozedurale Texturen. Alles wird zur Laufzeit auf ein Canvas gezeichnet -
 * so braucht das Spiel keine externen Bilddateien und startet sofort.
 */
import * as THREE from 'three';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function finish(c, repeat = 1, aniso = 8) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Deterministisches Rauschen, damit jeder Start gleich aussieht. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeAsphaltTexture(size = 512) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rand = mulberry(1337);

  ctx.fillStyle = '#3a3b3f';
  ctx.fillRect(0, 0, size, size);

  // Koerniger Belag
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 40;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 1.05));
  }
  ctx.putImageData(img, 0, 0);

  // Groessere Flecken und Ausbesserungen
  for (let i = 0; i < 26; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const shade = rand() > 0.5 ? 255 : 0;
    g.addColorStop(0, `rgba(${shade},${shade},${shade},${0.035 + rand() * 0.04})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return finish(c, 1, 16);
}

export function makeGrassTexture(size = 256) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rand = mulberry(99);
  ctx.fillStyle = '#4a6b33';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const l = 2 + rand() * 4;
    ctx.strokeStyle = `rgba(${60 + rand() * 60},${90 + rand() * 70},${35 + rand() * 40},0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 3, y - l);
    ctx.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 20 + rand() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(30,50,20,${0.1 + rand() * 0.12})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return finish(c, 1, 8);
}

export function makeGravelTexture(size = 256) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rand = mulberry(7);
  ctx.fillStyle = '#a89570';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.8 + rand() * 2.2;
    const v = 130 + rand() * 90;
    ctx.fillStyle = `rgba(${v},${v * 0.9},${v * 0.72},0.7)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c, 1, 8);
}

/** Curb-Streifen: laeuft in Fahrtrichtung, daher Streifen quer zur Textur. */
export function makeKerbTexture(size = 128) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const stripes = 4;
  const h = size / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#c8352c' : '#e8e8e6';
    ctx.fillRect(0, i * h, size, h);
  }
  // leichte Abnutzung
  const rand = mulberry(42);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Start-Ziel-Linie als Schachbrett. */
export function makeStartLineTexture(size = 256) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const n = 8;
  const s = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f2f2f0' : '#26262a';
      ctx.fillRect(x * s, y * s, s, s);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Himmelsverlauf als Kugeltextur. */
export function makeSkyTexture(size = 512) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0.0, '#2c5f9e');
  g.addColorStop(0.35, '#6ea3d8');
  g.addColorStop(0.62, '#b9d3e8');
  g.addColorStop(0.75, '#dfe7ec');
  g.addColorStop(1.0, '#c9cfd2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // ein paar weiche Wolkenbaender
  const rand = mulberry(2024);
  for (let i = 0; i < 40; i++) {
    const y = size * (0.1 + rand() * 0.42);
    const x = rand() * size;
    const w = 40 + rand() * 150;
    const h = 8 + rand() * 22;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, w);
    grad.addColorStop(0, `rgba(255,255,255,${0.16 + rand() * 0.22})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, h / w);
    ctx.beginPath();
    ctx.arc(0, 0, w, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/** Texturschild mit Text, z. B. Bremspunkt-Tafeln. */
export function makeSignTexture(text, bg = '#12141a', fg = '#f5f5f5', size = 256) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = fg;
  ctx.lineWidth = size * 0.05;
  ctx.strokeRect(size * 0.06, size * 0.06, size * 0.88, size * 0.88);
  ctx.fillStyle = fg;
  ctx.font = `bold ${size * 0.55}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size * 0.54);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export { mulberry };
