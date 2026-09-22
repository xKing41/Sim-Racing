/**
 * Strecke zur Laufzeit: Abtastung der Mittellinie, schnelle Ortsabfrage und
 * Streckenfortschritt fuer die Zeitnahme.
 *
 * Die Ortsabfrage laeuft 960-mal pro Sekunde (vier Raeder bei 240 Hz), deshalb
 * liegt ueber der Mittellinie ein Gitter: statt alle Stuetzpunkte zu pruefen,
 * werden nur die der passenden Zelle betrachtet.
 */

import { buildCenterline } from './geometry.js';

export const SURFACES = {
  asphalt: { grip: 1.0, rumble: 0, rolling: 1.0 },
  kerb: { grip: 0.93, rumble: 1.0, rolling: 1.15 },
  gravel: { grip: 0.48, rumble: 0.35, rolling: 3.2 },
  grass: { grip: 0.42, rumble: 0.18, rolling: 2.4 },
  wall: { grip: 0.3, rumble: 0, rolling: 1 },
};

const GRID_CELL = 24; // m

export class Track {
  constructor(def) {
    this.def = def;
    const cl = buildCenterline(def.corners, {
      step: 2.0,
      defaultWidth: def.defaultWidth,
    });
    this.points = cl.points;
    this.length = cl.total;
    this.cornerInfo = cl.corners;
    this.warnings = cl.warnings;
    this.step = this.length / this.points.length;

    this.kerbWidth = 1.6;
    this.runoffWidth = 14;
    this.wallSetback = 3;

    this._markKerbs();
    this._buildGrid();

    this.startIndex = Math.round((def.startOffset || 0) / this.step) % this.points.length;
    this.sectorSplits = (def.sectors || [0.33, 0.66]).map((f) =>
      Math.round(f * this.points.length) % this.points.length
    );
  }

  /** Curbs nur dort, wo die Strecke tatsaechlich Kurve faehrt. */
  _markKerbs() {
    const n = this.points.length;
    for (const p of this.points) {
      p.kerbLeft = false;
      p.kerbRight = false;
    }
    for (let i = 0; i < n; i++) {
      const k = this.points[i].curvature;
      if (Math.abs(k) < 1 / 260) continue;
      // Innenseite der Kurve bekommt immer einen Curb, die Aussenseite nur in
      // engen Kurven (dort wird sie beim Herausbeschleunigen mitgenommen).
      const tight = Math.abs(k) > 1 / 110;
      // positive Kruemmung = Rechtskurve -> innen ist rechts
      if (k > 0) {
        this.points[i].kerbRight = true;
        this.points[i].kerbLeft = tight;
      } else {
        this.points[i].kerbLeft = true;
        this.points[i].kerbRight = tight;
      }
    }
    // Curbs ein Stueck vor und nach der Kurve verlaengern
    const grow = 6;
    const left = this.points.map((p) => p.kerbLeft);
    const right = this.points.map((p) => p.kerbRight);
    for (let i = 0; i < n; i++) {
      for (let k = -grow; k <= grow; k++) {
        const j = (i + k + n) % n;
        if (left[j]) this.points[i].kerbLeft = true;
        if (right[j]) this.points[i].kerbRight = true;
      }
    }
  }

  _buildGrid() {
    this.grid = new Map();
    const reach = this.def.defaultWidth / 2 + this.kerbWidth + this.runoffWidth + this.wallSetback + 6;
    const cells = Math.ceil(reach / GRID_CELL);
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const cx = Math.floor(p.x / GRID_CELL);
      const cz = Math.floor(p.z / GRID_CELL);
      for (let dx = -cells; dx <= cells; dx++) {
        for (let dz = -cells; dz <= cells; dz++) {
          const key = (cx + dx) * 100003 + (cz + dz);
          let list = this.grid.get(key);
          if (!list) {
            list = [];
            this.grid.set(key, list);
          }
          list.push(i);
        }
      }
    }
  }

  /** Index des naechstgelegenen Mittellinienpunkts. */
  nearestIndex(x, z, hint = -1) {
    const n = this.points.length;
    // Wenn wir wissen, wo das Auto zuletzt war, reicht eine lokale Suche.
    if (hint >= 0) {
      let best = -1;
      let bestD = Infinity;
      for (let k = -14; k <= 14; k++) {
        const i = (hint + k + n) % n;
        const p = this.points[i];
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      // Nur uebernehmen, wenn das Ergebnis nicht am Rand des Suchfensters liegt
      const off = Math.abs(((best - hint + n + n / 2) % n) - n / 2);
      if (off < 13) return best;
    }

    const key = Math.floor(x / GRID_CELL) * 100003 + Math.floor(z / GRID_CELL);
    const list = this.grid.get(key);
    let best = -1;
    let bestD = Infinity;
    if (list) {
      for (const i of list) {
        const p = this.points[i];
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best < 0) {
      // Weit ausserhalb: notfalls alles durchsuchen
      for (let i = 0; i < n; i += 3) {
        const p = this.points[i];
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  /**
   * Vollstaendige Ortsabfrage.
   * @returns {{index:number, s:number, lateral:number, width:number, height:number,
   *            grip:number, surface:string, rumble:number, heading:number, curvature:number}}
   */
  sample(x, z, hint = -1) {
    const n = this.points.length;
    const i = this.nearestIndex(x, z, hint);
    const p = this.points[i];

    // Zwischen den Stuetzpunkten linear auflösen, damit die Abfrage glatt ist
    const next = this.points[(i + 1) % n];
    const prev = this.points[(i - 1 + n) % n];
    const dx = x - p.x;
    const dz = z - p.z;
    const along = dx * p.dirX + dz * p.dirZ;
    const t = Math.max(-1, Math.min(1, along / this.step));
    const ref = t >= 0 ? next : prev;
    const blend = Math.abs(t);

    const dirX = p.dirX + (ref.dirX - p.dirX) * blend;
    const dirZ = p.dirZ + (ref.dirZ - p.dirZ) * blend;
    // Normale zur RECHTEN Seite der Fahrtrichtung: rechts = vorwaerts x oben.
    // Damit bedeutet lateral > 0 immer "rechts der Mittellinie".
    const nx = -dirZ;
    const nz = dirX;
    const lateral = dx * nx + dz * nz;

    const width = p.width + (ref.width - p.width) * blend;
    const elevation = p.elevation + (ref.elevation - p.elevation) * blend;
    const banking = p.banking + (ref.banking - p.banking) * blend;
    const curvature = p.curvature + (ref.curvature - p.curvature) * blend;

    const halfWidth = width / 2;
    const absLat = Math.abs(lateral);
    const onRight = lateral > 0;
    const hasKerb = onRight ? p.kerbRight : p.kerbLeft;

    let surface = 'asphalt';
    if (absLat <= halfWidth) {
      surface = 'asphalt';
    } else if (hasKerb && absLat <= halfWidth + this.kerbWidth) {
      surface = 'kerb';
    } else if (absLat <= halfWidth + this.kerbWidth + this.runoffWidth) {
      surface = Math.abs(curvature) > 1 / 200 ? 'gravel' : 'grass';
    } else {
      surface = 'grass';
    }

    const props = SURFACES[surface];
    // Hoehe: Streckenverlauf plus Ueberhoehung. Die Ueberhoehung gilt nur auf
    // der Fahrbahn - sonst wuerde das Gelaende daneben immer weiter ansteigen.
    const latOnTrack = Math.max(-halfWidth, Math.min(halfWidth, lateral));
    let height = elevation + banking * latOnTrack;
    if (absLat > halfWidth) {
      const over = absLat - halfWidth;
      // Curb liegt leicht erhoeht, dahinter faellt das Gelaende ab
      height += Math.min(over, this.kerbWidth) * 0.05;
      if (over > this.kerbWidth) {
        height -= Math.min(over - this.kerbWidth, 12) * 0.05;
      }
    }

    let rumble = props.rumble;
    if (surface === 'kerb') {
      // Rillen im Curb
      rumble = 0.6 + 0.4 * Math.abs(Math.sin(p.s * 1.6));
    }

    return {
      index: i,
      s: p.s + along,
      lateral,
      width,
      height,
      grip: props.grip,
      surface,
      rumble,
      heading: Math.atan2(dirX, dirZ),
      curvature,
      banking,
      wallDistance: halfWidth + this.kerbWidth + this.runoffWidth + this.wallSetback,
    };
  }

  /** Position und Ausrichtung eines Startplatzes. */
  gridSlot(n) {
    const spacing = this.def.gridSpacing || 9;
    const side = n % 2 === 0 ? -1 : 1;
    const row = Math.floor(n / 2);
    const back = row * spacing + 8;
    const idx = (this.startIndex - Math.round(back / this.step) + this.points.length * 2) % this.points.length;
    const p = this.points[idx];
    const nx = -p.dirZ;
    const nz = p.dirX;
    const offset = side * (p.width * 0.22);
    return {
      x: p.x + nx * offset,
      z: p.z + nz * offset,
      y: p.elevation + p.banking * offset,
      yaw: p.heading,
      index: idx,
    };
  }

  /** Punkt auf der Mittellinie bei Bogenlaenge s. */
  pointAt(s) {
    const n = this.points.length;
    let i = Math.floor(((s % this.length) + this.length) / this.step) % n;
    return this.points[i];
  }

  /** Streckenfortschritt 0..1 ab Start/Ziel. */
  progress(s) {
    const L = this.length;
    const rel = s - this.points[this.startIndex].s;
    // Zweimal Modulo: der erste Rest kann negativ sein, deshalb erst die
    // Laenge addieren und dann erneut reduzieren. Ohne den zweiten Schritt
    // laeuft der Wert bis 2 und die Rundenerkennung greift an der falschen
    // Stelle.
    return (((rel % L) + L) % L) / L;
  }
}
