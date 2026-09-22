/** Zeichnet das Streckenlayout als PNG, damit man es vor dem Bauen sieht. */
import { buildCenterline, checkSelfIntersection } from '../src/track/geometry.js';
import { AUTODROM_NORDWIND } from '../src/track/trackData.js';
import { Canvas } from './png.mjs';

const track = AUTODROM_NORDWIND;
const cl = buildCenterline(track.corners, { step: 2, defaultWidth: track.defaultWidth });

console.log('Streckenlaenge:', cl.total.toFixed(0), 'm');
if (cl.warnings.length) console.log('Hinweise:', cl.warnings.join(' | '));

const check = checkSelfIntersection(cl.points, track.defaultWidth * 2.2);
console.log(
  'Mindestabstand zwischen entfernten Streckenteilen:',
  check.minDistance.toFixed(1), 'm ->',
  check.ok ? 'in Ordnung' : 'ZU ENG / SCHNEIDET SICH'
);

let minE = Infinity, maxE = -Infinity, maxCurv = 0;
for (const p of cl.points) {
  minE = Math.min(minE, p.elevation); maxE = Math.max(maxE, p.elevation);
  maxCurv = Math.max(maxCurv, Math.abs(p.curvature));
}
console.log('Hoehenunterschied:', (maxE - minE).toFixed(1), 'm | engster Radius:', (1 / maxCurv).toFixed(0), 'm');

console.log('');
console.log('Kurven:');
for (const corner of cl.corners) {
  // grobe Grenzgeschwindigkeit bei 1.45 g Querbeschleunigung
  const vmax = Math.sqrt(1.45 * 9.81 * corner.radius) * 3.6;
  console.log('  ' + (corner.name || '?').padEnd(17) + 'R=' + corner.radius.toFixed(0).padStart(4) + ' m   ~' + vmax.toFixed(0).padStart(3) + ' km/h');
}
console.log('');

// --- zeichnen ---
const W = 900, H = 900, PAD = 50;
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (const p of cl.points) {
  x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
  z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
}
const scale = Math.min((W - 2 * PAD) / (x1 - x0), (H - 2 * PAD) / (z1 - z0));
const tx = (x) => PAD + (x - x0) * scale;
const ty = (z) => H - PAD - (z - z0) * scale;

const c = new Canvas(W, H, [24, 28, 24]);

// Asphaltband
for (const p of cl.points) {
  const hw = (p.width / 2) * scale;
  const nx = p.dirZ, nz = -p.dirX;
  c.line(tx(p.x - nx * p.width / 2), ty(p.z - nz * p.width / 2),
         tx(p.x + nx * p.width / 2), ty(p.z + nz * p.width / 2), [70, 72, 78], 2);
}
// Mittellinie eingefaerbt nach Hoehe
for (let i = 0; i < cl.points.length; i++) {
  const p = cl.points[i], q = cl.points[(i + 1) % cl.points.length];
  const t = (p.elevation - minE) / Math.max(1, maxE - minE);
  c.line(tx(p.x), ty(p.z), tx(q.x), ty(q.z), [40 + t * 200, 200 - t * 120, 90], 1);
}
// Ecken markieren
cl.corners.forEach((corner, i) => {
  c.disc(tx(corner.x), ty(corner.z), 4, [230, 80, 60]);
});
// Start/Ziel
const si = Math.round(track.startOffset / (cl.total / cl.points.length)) % cl.points.length;
const sp = cl.points[si];
const snx = sp.dirZ, snz = -sp.dirX;
c.line(tx(sp.x - snx * 9), ty(sp.z - snz * 9), tx(sp.x + snx * 9), ty(sp.z + snz * 9), [255, 255, 255], 4);
// Fahrtrichtungspfeil
const ap = cl.points[(si + 25) % cl.points.length];
c.line(tx(sp.x), ty(sp.z), tx(ap.x), ty(ap.z), [90, 200, 255], 3);

c.save('/tmp/claude-0/-home-user-Sim-Racing/fc7fa129-c979-579c-b12e-012ab736975e/scratchpad/track.png');
console.log('Vorschau geschrieben.');
