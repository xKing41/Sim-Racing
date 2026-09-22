/**
 * Prueft, ob die Abstimmung tatsaechlich wirkt - und zwar dort, wo es zaehlt.
 *
 * Gemessen wird am Grenzbereich: der Lenkeinschlag wird so lange erhoeht,
 * bis die Querbeschleunigung nicht mehr steigt. Interessant ist dann, WELCHE
 * Achse zuerst saettigt. Vorne zuerst heisst Untersteuern, hinten zuerst
 * heisst Uebersteuern. Bei halber Kraft sagt eine Balancemessung wenig aus,
 * weil dort noch beide Achsen Reserve haben.
 */
import { Vehicle } from '../src/physics/vehicle.js';
import { setupToPhysics, DEFAULT_SETUP, SETUP_PRESETS } from '../src/physics/setup.js';

const ASSISTS = {
  abs: false, tractionControl: false, stabilityControl: false,
  steerAssist: false, autoGearbox: true,
};

function corner(setup, steer, speedKmh) {
  const ph = setupToPhysics(setup);
  const v = new Vehicle({
    assists: ASSISTS, chassis: ph.chassis, suspension: ph.suspension,
    drivetrain: ph.drivetrain, compound: ph.compound, fuel: ph.fuel,
  });
  v.placeAt(0, 0, 0, speedKmh / 3.6, 0, 85);
  const dt = 1 / 240;
  let lat = 0, sf = 0, sr = 0, n = 0;
  for (let i = 0; i < 240 * 4; i++) {
    v.step(dt, { steer, throttle: 0.3, brake: 0, handbrake: 0, clutch: 0, shiftUp: false, shiftDown: false });
    if (!isFinite(v.u) || Math.abs(v.w) > 30) return null; // weggedreht
    if (i > 240 * 2.5) {
      lat += Math.abs(v.accelLat) / 9.81;
      sf += Math.max(v.wheels[0].slipLoad, v.wheels[1].slipLoad);
      sr += Math.max(v.wheels[2].slipLoad, v.wheels[3].slipLoad);
      n++;
    }
  }
  return { lat: lat / n, front: sf / n, rear: sr / n, roll: Math.abs(v.suspension.roll) * 57.3 };
}

/** Sucht den Grenzbereich und meldet, welche Achse dort zuerst aufgibt. */
function limit(setup, speedKmh = 140) {
  let best = null;
  for (let steer = 0.03; steer <= 0.40; steer += 0.01) {
    const r = corner(setup, steer, speedKmh);
    if (!r) break;
    if (!best || r.lat > best.lat) best = { ...r, steer };
    // Sobald eine Achse deutlich jenseits des Kraftmaximums ist, sind wir durch
    if (r.front > 1.5 || r.rear > 1.5) break;
  }
  return best;
}

function label(front, rear) {
  const d = front - rear;
  if (d > 0.22) return 'untersteuert deutlich';
  if (d > 0.07) return 'untersteuert';
  if (d > -0.07) return 'neutral';
  if (d > -0.22) return 'uebersteuert';
  return 'uebersteuert deutlich';
}

function show(name, setup) {
  const r = limit(setup);
  if (!r) { console.log('  ' + name.padEnd(26) + 'nicht fahrbar'); return; }
  console.log(
    '  ' + name.padEnd(26) +
    r.lat.toFixed(2) + ' g   Saettigung vorn ' + r.front.toFixed(2) +
    ' / hinten ' + r.rear.toFixed(2) +
    '   ' + label(r.front, r.rear).padEnd(22) +
    'Waelzen ' + r.roll.toFixed(2) + '°'
  );
}

console.log('BALANCE AM GRENZBEREICH (140 km/h, Saettigung 1.0 = Kraftmaximum)\n');
console.log('Stabilisatoren vorne/hinten:');
for (const [f, r] of [[8, 70], [18, 50], [30, 36], [42, 26], [58, 16], [80, 8]]) {
  show(`${f} / ${r} kN/m`, { ...DEFAULT_SETUP, arbFront: f, arbRear: r });
}

console.log('\nFederraten vorne/hinten:');
for (const [f, r] of [[110, 200], [140, 165], [160, 140], [200, 110], [235, 95]]) {
  show(`${f} / ${r} N/mm`, { ...DEFAULT_SETUP, springFront: f, springRear: r });
}

console.log('\nFrontabtrieb bei 230 km/h:');
for (const a of [34, 38, 42, 46, 52]) {
  const r = limit({ ...DEFAULT_SETUP, aeroFront: a }, 230);
  console.log('  ' + String(a).padStart(2) + ' %'.padEnd(22) +
    (r ? r.lat.toFixed(2) + ' g   Saettigung vorn ' + r.front.toFixed(2) + ' / hinten ' + r.rear.toFixed(2) + '   ' + label(r.front, r.rear) : 'nicht fahrbar'));
}

console.log('\nAeusserste Kombinationen:');
for (const [n, v] of [
  ['lose bis zum Anschlag', { arbFront: 5, arbRear: 85, aeroFront: 52, springFront: 105, springRear: 215 }],
  ['stur bis zum Anschlag', { arbFront: 85, arbRear: 5, aeroFront: 34, springFront: 235, springRear: 95 }],
]) show(n, { ...DEFAULT_SETUP, ...v });

console.log('\nHeckfluegel bei 230 km/h:');
for (const w of [1, 4, 8, 12]) {
  const r = limit({ ...DEFAULT_SETUP, wing: w }, 230);
  console.log('  Stufe ' + String(w).padStart(2).padEnd(24) +
    (r ? r.lat.toFixed(2) + ' g   Saettigung vorn ' + r.front.toFixed(2) + ' / hinten ' + r.rear.toFixed(2) : 'nicht fahrbar'));
}

console.log('\nFertige Abstimmungen:');
for (const [, p] of Object.entries(SETUP_PRESETS)) {
  show(p.name, { ...DEFAULT_SETUP, ...p.values });
}
