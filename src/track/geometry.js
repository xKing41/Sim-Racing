/**
 * Streckengeometrie: aus einem geschlossenen Polygon wird ein fahrbarer Kurs.
 *
 * An jeder Ecke wird ein Kreisbogen tangential in die beiden angrenzenden
 * Geraden eingesetzt. Dadurch ist der Kurs zwangslaeufig geschlossen, jede
 * Kurve hat einen definierten Radius, und es gibt keine Knicke - genau so
 * werden reale Streckenlayouts konstruiert.
 */

const TAU = Math.PI * 2;

function sub(a, b) {
  return { x: a.x - b.x, z: a.z - b.z };
}
function len(v) {
  return Math.hypot(v.x, v.z);
}
function norm(v) {
  const l = len(v) || 1;
  return { x: v.x / l, z: v.z / l };
}
function cross2(a, b) {
  return a.x * b.z - a.z * b.x;
}
function dot2(a, b) {
  return a.x * b.x + a.z * b.z;
}

/**
 * Baut den Mittellinienverlauf.
 * @param {{x:number,z:number,radius:number,elevation?:number,width?:number,name?:string}[]} corners
 * @param {{step?:number, defaultWidth?:number}} opts
 */
export function buildCenterline(corners, opts = {}) {
  const step = opts.step || 2.0;
  const defaultWidth = opts.defaultWidth || 12;
  const n = corners.length;
  const warnings = [];

  // --- 1. Tangentenlaengen je Ecke bestimmen ------------------------------
  const info = corners.map((c, i) => {
    const prev = corners[(i - 1 + n) % n];
    const next = corners[(i + 1) % n];
    const inDir = norm(sub(c, prev));
    const outDir = norm(sub(next, c));
    // Richtungsaenderung an der Ecke; Vorzeichen = Kurvenrichtung
    const sinT = cross2(inDir, outDir);
    const cosT = dot2(inDir, outDir);
    const turn = Math.atan2(sinT, cosT);
    const absTurn = Math.abs(turn);
    const tangent = absTurn < 1e-4 ? 0 : c.radius * Math.tan(absTurn / 2);
    return { c, prev, next, inDir, outDir, turn, absTurn, tangent, radius: c.radius };
  });

  // --- 2. Radien kuerzen, wenn zwei Kurven nicht auf eine Gerade passen ---
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const a = info[i];
      const b = info[(i + 1) % n];
      const edge = len(sub(b.c, a.c));
      const need = a.tangent + b.tangent;
      if (need > edge * 0.985) {
        const scale = (edge * 0.985) / need;
        a.radius *= scale;
        b.radius *= scale;
        a.tangent *= scale;
        b.tangent *= scale;
        changed = true;
        if (pass === 0) {
          warnings.push(
            `Radius bei ${a.c.name || 'Ecke ' + i} / ${b.c.name || 'Ecke ' + ((i + 1) % n)} gekuerzt (Gerade zu kurz)`
          );
        }
      }
    }
    if (!changed) break;
  }

  // --- 3. Bogen- und Geradenabschnitte aneinanderreihen -------------------
  /** @type {{type:string, from:object, to:object, length:number, curvature:number, cornerIndex:number}[]} */
  const segments = [];
  for (let i = 0; i < n; i++) {
    const a = info[i];
    const b = info[(i + 1) % n];

    // Gerade zwischen dem Bogenende von a und dem Bogenanfang von b
    const startPt = {
      x: a.c.x + a.outDir.x * a.tangent,
      z: a.c.z + a.outDir.z * a.tangent,
    };
    // Bogenanfang von b liegt auf der einlaufenden Geraden
    const bStart = {
      x: b.c.x - b.inDir.x * b.tangent,
      z: b.c.z - b.inDir.z * b.tangent,
    };
    const straightLen = len(sub(bStart, startPt));
    if (straightLen > 0.01) {
      segments.push({
        type: 'straight',
        from: startPt,
        to: bStart,
        dir: a.outDir,
        length: straightLen,
        curvature: 0,
        cornerIndex: i,
      });
    }

    // Bogen an Ecke b
    if (b.absTurn > 1e-4 && b.radius > 0.01) {
      const arcLength = b.radius * b.absTurn;
      segments.push({
        type: 'arc',
        corner: b.c,
        radius: b.radius,
        turn: b.turn,
        start: bStart,
        startDir: b.inDir,
        length: arcLength,
        curvature: Math.sign(b.turn) / b.radius,
        cornerIndex: (i + 1) % n,
      });
    }
  }

  // --- 4. Gleichmaessig abtasten ------------------------------------------
  const total = segments.reduce((sum, s) => sum + s.length, 0);
  const count = Math.max(64, Math.round(total / step));
  const ds = total / count;

  const points = [];
  let segIdx = 0;
  let segPos = 0;
  let cursor = { ...segments[0].from || segments[0].start };
  let heading = null;

  for (let i = 0; i < count; i++) {
    const s = i * ds;
    // passendes Segment suchen
    let acc = 0;
    let seg = segments[0];
    let local = 0;
    for (const candidate of segments) {
      if (s < acc + candidate.length || candidate === segments[segments.length - 1]) {
        seg = candidate;
        local = s - acc;
        break;
      }
      acc += candidate.length;
    }

    let px;
    let pz;
    let dir;
    let curvature = seg.curvature;

    if (seg.type === 'straight') {
      px = seg.from.x + seg.dir.x * local;
      pz = seg.from.z + seg.dir.z * local;
      dir = seg.dir;
    } else {
      const sign = Math.sign(seg.turn);
      // Kreismittelpunkt liegt senkrecht zur Einfahrtsrichtung
      const nx = seg.startDir.z * sign;
      const nz = -seg.startDir.x * sign;
      const cx = seg.start.x - nx * seg.radius;
      const cz = seg.start.z - nz * seg.radius;
      const a0 = Math.atan2(seg.start.z - cz, seg.start.x - cx);
      const a = a0 + (sign * local) / seg.radius;
      px = cx + Math.cos(a) * seg.radius;
      pz = cz + Math.sin(a) * seg.radius;
      dir = { x: -Math.sin(a) * sign, z: Math.cos(a) * sign };
    }

    points.push({
      s,
      x: px,
      z: pz,
      dirX: dir.x,
      dirZ: dir.z,
      heading: Math.atan2(dir.x, dir.z),
      curvature,
      segmentType: seg.type,
      cornerIndex: seg.cornerIndex,
    });
  }

  // --- 5. Hoehe und Breite periodisch interpolieren -----------------------
  // Stuetzstellen sind die Ecken; dazwischen wird glatt ueberblendet.
  const cornerS = new Array(n).fill(0);
  {
    // Bogenlaenge bis zur jeweiligen Ecke aufsummieren
    let acc = 0;
    for (const seg of segments) {
      if (seg.type === 'arc') cornerS[seg.cornerIndex] = acc + seg.length / 2;
      acc += seg.length;
    }
    // Ecken ohne Bogen (fast gerade) sinnvoll einsortieren
    acc = 0;
    for (const seg of segments) {
      if (seg.type === 'straight' && cornerS[seg.cornerIndex] === 0) {
        cornerS[seg.cornerIndex] = acc;
      }
      acc += seg.length;
    }
  }

  for (const p of points) {
    p.elevation = periodicSample(cornerS, corners.map((c) => c.elevation || 0), p.s, total);
    p.width = periodicSample(cornerS, corners.map((c) => c.width || defaultWidth), p.s, total);
  }

  // --- 6. Ueberhoehung aus der Kruemmung ableiten -------------------------
  // Kurvenaussenseite liegt hoeher. Die Werte bleiben bewusst moderat: reale
  // Rennstrecken haben meist 2 bis 4 Grad. Mehr wuerde in Kurven, deren
  // Ueberhoehung am Ausgang ausl aeuft, den Grip schlagartig wegnehmen.
  for (const p of points) {
    p.banking = Math.max(-0.058, Math.min(0.058, -p.curvature * 170));
  }
  // Grosszuegig glaetten, damit die Neigung sanft ein- und ausl aeuft
  smoothField(points, 'banking', 26);
  smoothField(points, 'elevation', 10);

  return { points, segments, total, warnings, corners: info.map((f) => ({ ...f.c, radius: f.radius })) };
}

/** Glatte periodische Interpolation zwischen Stuetzstellen entlang der Strecke. */
function periodicSample(positions, values, s, total) {
  const n = positions.length;
  // Zwei naechste Stuetzstellen bestimmen (zyklisch)
  let i0 = 0;
  for (let i = 0; i < n; i++) {
    if (positions[i] <= s) i0 = i;
  }
  let i1 = (i0 + 1) % n;
  let s0 = positions[i0];
  let s1 = positions[i1];
  if (s1 <= s0) s1 += total;
  let sx = s;
  if (sx < s0) sx += total;
  const t = Math.max(0, Math.min(1, (sx - s0) / Math.max(1e-6, s1 - s0)));
  const smooth = t * t * (3 - 2 * t); // weiches Ein-/Auslaufen
  return values[i0] + (values[i1] - values[i0]) * smooth;
}

/** Gleitender Mittelwert ueber ein Feld der Mittellinie (zyklisch). */
function smoothField(points, key, radius) {
  const n = points.length;
  const src = points.map((p) => p[key]);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const w = 1 - Math.abs(k) / (radius + 1);
      sum += src[(i + k + n * 2) % n] * w;
      weight += w;
    }
    points[i][key] = sum / weight;
  }
}

/** Prueft, ob sich die Strecke selbst schneidet oder zu nah kommt. */
export function checkSelfIntersection(points, clearance) {
  const n = points.length;
  let worst = Infinity;
  let worstAt = null;
  // Punkte, die entlang der Strecke weit auseinander liegen, aber raeumlich nah
  const minGap = Math.ceil(clearance * 3);
  for (let i = 0; i < n; i++) {
    for (let j = i + minGap; j < n; j++) {
      // Abstand ENTLANG der Strecke zyklisch messen - sonst gelten Punkte
      // kurz vor und kurz nach Start/Ziel faelschlich als Beinahekollision.
      const along = Math.min(j - i, n - (j - i));
      if (along < minGap) continue;
      const d = Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z);
      if (d < worst) {
        worst = d;
        worstAt = [i, j];
      }
    }
  }
  return { minDistance: worst, at: worstAt, ok: worst >= clearance };
}

export { TAU };
