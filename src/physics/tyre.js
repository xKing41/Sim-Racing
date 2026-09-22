/**
 * Reifenmodell - vereinfachte Pacejka "Magic Formula" mit kombiniertem Schlupf.
 *
 * Koordinaten im Radsystem:
 *   x = Rollrichtung des Rades (vorwaerts)
 *   y = quer zum Rad, positiv nach rechts
 *
 * Vorzeichen:
 *   kappa > 0  -> Rad dreht schneller als der Untergrund -> Fx > 0 (Vortrieb)
 *   alpha > 0  -> Reifen rutscht nach links -> Fy > 0 (Kraft nach rechts)
 */

/**
 * Rohform der Magic Formula, normiert auf Amplitude 1.
 * Erzeugt die typische Kurve: linearer Anstieg, Peak, leichter Abfall ins Gleiten.
 */
function shapeRaw(s, B, C, E) {
  const Bs = B * s;
  return Math.sin(C * Math.atan(Bs - E * (Bs - Math.atan(Bs))));
}

/**
 * Sucht Lage und Hoehe des Kraftmaximums der Rohkurve.
 * Wird einmal beim Erzeugen eines Reifens berechnet, damit wir die Kurve so
 * normieren koennen, dass das Maximum exakt bei s = 1 und Wert 1 liegt.
 * Dadurch ist "normierter Schlupf 1" immer genau der Grenzbereich - das macht
 * die kombinierte Schlupfrechnung und alle Fahrhilfen sauber steuerbar.
 */
function findPeak(B, C, E) {
  let bestS = 0;
  let bestV = 0;
  // Grobsuche
  for (let s = 0.001; s < 4; s += 0.001) {
    const v = shapeRaw(s, B, C, E);
    if (v > bestV) {
      bestV = v;
      bestS = s;
    }
  }
  // Feinsuche per goldenem Schnitt um das gefundene Maximum
  let lo = Math.max(1e-4, bestS - 0.002);
  let hi = bestS + 0.002;
  const phi = 0.6180339887;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  for (let i = 0; i < 64; i++) {
    if (shapeRaw(c, B, C, E) > shapeRaw(d, B, C, E)) hi = d;
    else lo = c;
    c = hi - phi * (hi - lo);
    d = lo + phi * (hi - lo);
  }
  const sPeak = 0.5 * (lo + hi);
  return { sPeak, vPeak: shapeRaw(sPeak, B, C, E) };
}

export const TYRE_COMPOUNDS = {
  // mu      = Reibbeiwert bei Nennlast
  // loadSens= Degression: wie stark mu bei Mehrlast einbricht (Lastabhaengigkeit)
  // peakSlipRatio / peakSlipAngle = Schlupf am Kraftmaximum
  slick: {
    name: 'Slick (Trocken)',
    mu: 1.62,
    loadSens: 0.22,
    peakSlipRatio: 0.11,
    peakSlipAngle: 0.145, // rad ~ 8.3 Grad
    B: 9.5,
    C: 1.62,
    E: 0.35,
    gripFalloff: 0.82, // Restgrip weit jenseits des Peaks (Gleitreibung / mu)
  },
  medium: {
    name: 'Medium',
    mu: 1.48,
    loadSens: 0.2,
    peakSlipRatio: 0.12,
    peakSlipAngle: 0.16,
    B: 8.6,
    C: 1.6,
    E: 0.38,
    gripFalloff: 0.85,
  },
  wet: {
    name: 'Regen',
    mu: 1.15,
    loadSens: 0.16,
    peakSlipRatio: 0.14,
    peakSlipAngle: 0.19,
    B: 7.4,
    C: 1.55,
    E: 0.45,
    gripFalloff: 0.9,
  },
};

export class Tyre {
  constructor(compound = TYRE_COMPOUNDS.slick, nominalLoad = 3500) {
    this.p = { ...compound };
    this.nominalLoad = nominalLoad;

    const peak = findPeak(this.p.B, this.p.C, this.p.E);
    this._sPeak = peak.sPeak;
    this._vPeak = peak.vPeak;

    // Zustand fuer Sound/Effekte
    this.slipLoad = 0; // 0 = Haftung, 1 = am Limit, >1 = rutscht
    this.load = 0;
    this.surfaceGrip = 1;
  }

  /** Normierte Kraftkurve: Maximum exakt bei s = 1 mit Wert 1. */
  curve(s) {
    const v = shapeRaw(s * this._sPeak, this.p.B, this.p.C, this.p.E) / this._vPeak;
    if (s <= 1) return v;
    // Jenseits des Peaks nicht gegen 0 laufen lassen, sondern gegen Gleitreibung
    const floor = this.p.gripFalloff;
    return Math.max(v, floor);
  }

  /**
   * Lastabhaengiger Reibbeiwert. Reale Reifen verlieren mit steigender Radlast
   * relativ an Grip - genau das erzeugt den Effekt, dass Gewichtsverlagerung
   * die Balance des Autos veraendert.
   */
  frictionAt(Fz) {
    const rel = Fz / this.nominalLoad;
    const mu = this.p.mu * (1 - this.p.loadSens * (rel - 1));
    return Math.max(this.p.mu * 0.45, Math.min(this.p.mu * 1.35, mu));
  }

  /**
   * Reifenkraefte bei gegebenem Laengs-/Querschlupf.
   * @param {number} kappa  Laengsschlupf (dimensionslos)
   * @param {number} alpha  Schraeglaufwinkel in rad
   * @param {number} Fz     Radlast in N (>= 0)
   * @param {number} surfaceGrip Untergrundfaktor (Asphalt 1.0, Gras ~0.45 ...)
   * @returns {{fx:number, fy:number, slip:number, saturation:number}}
   */
  forces(kappa, alpha, Fz, surfaceGrip = 1) {
    this.load = Fz;
    this.surfaceGrip = surfaceGrip;

    if (Fz <= 1) {
      this.slipLoad = 0;
      return { fx: 0, fy: 0, slip: 0, saturation: 0 };
    }

    // Schlupf auf den jeweiligen Peak normieren -> gemeinsamer Reibkreis
    const sx = kappa / this.p.peakSlipRatio;
    const sy = Math.tan(alpha) / this.p.peakSlipAngle;
    const s = Math.hypot(sx, sy);

    this.slipLoad = s;

    if (s < 1e-6) {
      return { fx: 0, fy: 0, slip: 0, saturation: 0 };
    }

    const mu = this.frictionAt(Fz) * surfaceGrip;
    const fMax = mu * Fz;
    const f = fMax * this.curve(s);

    // Kraft liegt entgegengesetzt zur Schlupfrichtung -> Reibkreis ist automatisch
    // eingehalten: Gas + Lenken teilen sich denselben Grip.
    return {
      fx: (sx / s) * f,
      fy: (sy / s) * f,
      slip: s,
      saturation: Math.min(1, s),
    };
  }
}
