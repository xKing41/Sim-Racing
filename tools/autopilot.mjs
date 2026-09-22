/**
 * Prueffahrt ohne Grafik: ein einfacher Autopilot faehrt die Strecke ab.
 *
 * Damit laesst sich pruefen, ob der Kurs ueberhaupt fahrbar ist, wie lange
 * eine Runde dauert und ob die Zeitnahme korrekt ausloest - alles ohne
 * Browser und ohne jemanden ans Lenkrad zu setzen.
 */
import { Vehicle } from '../src/physics/vehicle.js';
import { Track } from '../src/track/track.js';
import { AUTODROM_NORDWIND } from '../src/track/trackData.js';
import { LapTimer, formatTime } from '../src/track/timing.js';

const track = new Track(AUTODROM_NORDWIND);
const vehicle = new Vehicle({ assists: { abs: true, tractionControl: true, stabilityControl: true, steerAssist: false, autoGearbox: true } });
let hint = -1;
vehicle.surfaceQuery = (x, z) => {
  const q = track.sample(x, z, hint);
  hint = q.index;
  return q;
};
const timer = new LapTimer(track);

const slot = track.gridSlot(0);
vehicle.placeAt(slot.x, slot.z, slot.yaw, 0, slot.y);
hint = slot.index;

/**
 * Grenzgeschwindigkeit fuer eine Kruemmung, inklusive Abtrieb.
 * Die Ueberhoehung wird bewusst NICHT mitgerechnet: sie laeuft am Kurven-
 * ausgang aus, und wer sich darauf verlaesst, verliert genau dort den Grip.
 */
function cornerSpeed(curvature) {
  const r = 1 / Math.max(1e-4, Math.abs(curvature));
  // Naeherung: mit Abtrieb steigt die moegliche Querbeschleunigung mit v^2,
  // deshalb iterativ loesen statt direkt.
  let v = 20;
  for (let i = 0; i < 8; i++) {
    const down = 0.5 * 1.225 * 3.6 * v * v;
    const aLat = ((1290 * 9.81 + down) * 1.15) / 1290;
    v = Math.sqrt(aLat * r);
  }
  return Math.min(v, 82);
}

const dt = 1 / 240;
const LAPS = 3;
let t = 0;
let offTrackSteps = 0;
let wallHits = 0;
const laps = [];
let maxLat = 0;

while (laps.length < LAPS && t < 600) {
  const q = track.sample(vehicle.position.x, vehicle.position.z, hint);
  hint = q.index;
  const n = track.points.length;

  // --- Lenken: Zielpunkt vorausschauend auf der Mittellinie --------------
  const lookahead = 11 + vehicle.speed * 0.62;
  const ahead = track.points[(q.index + Math.round(lookahead / track.step)) % n];
  const dx = ahead.x - vehicle.position.x;
  const dz = ahead.z - vehicle.position.z;
  const f = vehicle.forwardVector();
  const r = vehicle.rightVector();
  const localX = dx * r.x + dz * r.z;
  const localZ = dx * f.x + dz * f.z;
  // Zielpunkt anpeilen, dazu den seitlichen Versatz von der Mittellinie
  // ausregeln - reine Vorausschau allein schneidet Kurven an und traegt aus.
  // Die Korrektur muss mit dem Tempo abnehmen - bei 250 km/h reisst der
  // gleiche Ausschlag das Auto quer.
  const lateralCorrection = (-q.lateral * 0.9) / Math.max(12, vehicle.speed);
  const steer = Math.max(-1, Math.min(1, Math.atan2(localX, Math.max(1, localZ)) * 2.1 + lateralCorrection));

  // --- Tempo: engste Kruemmung im Bremsweg suchen ------------------------
  let target = 82;
  const horizon = Math.round((34 + (vehicle.speed * vehicle.speed) / 18) / track.step);
  for (let k = 4; k < horizon; k++) {
    const p = track.points[(q.index + k) % n];
    const vLimit = cornerSpeed(p.curvature);
    const dist = k * track.step;
    // Aus welchem Tempo kann ich noch auf vLimit herunterbremsen?
    // Bergab wird der Bremsweg laenger, bergauf kuerzer
    const slope = (track.points[(q.index + k) % n].elevation - q.height) / Math.max(1, dist);
    const decel = Math.max(4, 11 - slope * 55);
    const reachable = Math.sqrt(vLimit * vLimit + 2 * decel * dist);
    target = Math.min(target, reachable);
  }

  // Schiebt die Vorderachse, geht der Fuss vom Gas und das Tempoziel sinkt -
  // genau wie ein Fahrer, der merkt, dass er zu schnell ist.
  const frontSlip = Math.max(vehicle.wheels[0].slipLoad, vehicle.wheels[1].slipLoad);
  if (frontSlip > 1) target *= Math.max(0.6, 1 - (frontSlip - 1) * 0.35);

  const err = target - vehicle.speed;
  const throttle = Math.max(0, Math.min(1, err * 0.35)) * (frontSlip > 1.15 ? 0.25 : 1);
  const brake = Math.max(0, Math.min(1, -err * 0.28));

  vehicle.step(dt, { steer, throttle, brake, handbrake: 0, clutch: 0, shiftUp: false, shiftDown: false });

  // Bande
  const over = Math.abs(q.lateral) - q.wallDistance;
  if (over > 0) {
    wallHits++;
    const sign = Math.sign(q.lateral);
    const nx = Math.cos(q.heading), nz = -Math.sin(q.heading);
    vehicle.position.x -= sign * nx * over;
    vehicle.position.z -= sign * nz * over;
    vehicle.u *= 0.6; vehicle.w = 0; vehicle.r *= 0.3;
  }

  maxLat = Math.max(maxLat, Math.abs(q.lateral));
  const off = vehicle.wheels.every((w) => w.surfaceGrip < 0.75);
  if (off) offTrackSteps++;

  const lap = timer.update(dt, q.s, off, vehicle.speed);
  if (lap) laps.push(lap);
  t += dt;
}

console.log('Strecke:', track.def.name, '|', track.length.toFixed(0), 'm');
console.log('Simulierte Zeit:', t.toFixed(1), 's');
console.log('Groesster seitlicher Versatz von der Mittellinie:', maxLat.toFixed(1), 'm');
console.log('Schritte neben der Strecke:', offTrackSteps, '| Bandenkontakte:', wallHits);
console.log('');
if (!laps.length) {
  console.log('KEINE RUNDE ABGESCHLOSSEN');
  process.exit(1);
}
for (const lap of laps) {
  console.log(
    `Runde ${lap.number}: ${formatTime(lap.time)} ${lap.valid ? '' : '(ungueltig)'}` +
    (lap.sectors[0] !== null ? `  S1 ${lap.sectors[0].toFixed(2)}  S2 ${lap.sectors[1]?.toFixed(2)}  S3 ${lap.sectors[2]?.toFixed(2)}` : '')
  );
}
const best = Math.min(...laps.map((l) => l.time));
console.log('\nBeste Runde:', formatTime(best), '| Schnitt:', (track.length / best * 3.6).toFixed(1), 'km/h');
