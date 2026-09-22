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

// Waermekapazitaet der Lauflaeche in J/K und Abkuehlbeiwert in 1/s.
// Beide sind so gewaehlt, dass ein Reifen in ein bis zwei zuegigen Runden
// auf Temperatur kommt und im Schiebebetrieb wieder abkuehlt.
const TYRE_HEAT_CAPACITY = 11000;
const TYRE_COOLING = 0.0042;

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
    optimumTemp: 88,
    tempWindow: 46,
    tempSensitivity: 0.30,
    wearRate: 3.4e-9,
    pneumaticTrail: 0.034, // m, Nachlauf der Aufstandsflaeche bei kleinem Schlupf
    mechanicalTrail: 0.021, // m, aus dem Nachlaufwinkel der Achse
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
    optimumTemp: 80,
    tempWindow: 54,
    tempSensitivity: 0.24,
    wearRate: 2.1e-9,
    pneumaticTrail: 0.032, // m, Nachlauf der Aufstandsflaeche bei kleinem Schlupf
    mechanicalTrail: 0.021, // m, aus dem Nachlaufwinkel der Achse
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
    optimumTemp: 62,
    tempWindow: 40,
    tempSensitivity: 0.26,
    wearRate: 1.6e-9,
    pneumaticTrail: 0.030, // m, Nachlauf der Aufstandsflaeche bei kleinem Schlupf
    mechanicalTrail: 0.021, // m, aus dem Nachlaufwinkel der Achse
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

    // Waerme und Verschleiss
    this.ambient = 22;
    this.temperature = this.ambient;
    this.wear = 0; // 0 = neu, 1 = abgefahren
    this.gripTemp = 1;
    this.gripWear = 1;
    this.heatPower = 0;
    this.trail = 0;
  }

  /**
   * Waermehaushalt und Verschleiss.
   *
   * Der Reifen heizt sich durch Reibleistung im Latsch und durch Walkarbeit
   * auf und kuehlt an der Luft wieder ab. Grip gibt es nur in einem Fenster
   * um die Betriebstemperatur: kalte Slicks rutschen, ueberhitzte auch.
   * Genau das macht die erste Runde aus einem Aufwaermen statt einer
   * Zeitenjagd - und daran unterscheidet sich ein Simulator von einem
   * Arcade-Spiel, in dem der Reifen immer gleich klebt.
   *
   * @param {number} dt
   * @param {number} fx Laengskraft am Reifen in N
   * @param {number} fy Querkraft am Reifen in N
   * @param {number} slipVx Gleitgeschwindigkeit laengs in m/s
   * @param {number} slipVy Gleitgeschwindigkeit quer in m/s
   * @param {number} speed Fahrzeuggeschwindigkeit in m/s
   */
  updateThermal(dt, fx, fy, slipVx, slipVy, speed) {
    const p = this.p;

    // Reibleistung im Latsch plus Walkarbeit beim Abrollen
    const friction = Math.abs(fx * slipVx) + Math.abs(fy * slipVy);
    const rolling = this.load * Math.abs(speed) * 0.011;
    this.heatPower = friction + rolling;

    const heat = this.heatPower / TYRE_HEAT_CAPACITY;
    const cooling = TYRE_COOLING * (this.temperature - this.ambient) * (1 + Math.abs(speed) / 42);
    this.temperature += (heat - cooling) * dt;
    this.temperature = Math.max(this.ambient - 5, Math.min(220, this.temperature));

    // Verschleiss folgt der eingetragenen Reibenergie
    this.wear = Math.min(1, this.wear + friction * dt * p.wearRate);

    // Griffbeiwert aus Temperaturfenster und Restprofil
    const off = (this.temperature - p.optimumTemp) / p.tempWindow;
    this.gripTemp = 1 - p.tempSensitivity * Math.min(1, off * off);
    this.gripWear = 1 - 0.26 * this.wear * this.wear;
  }

  /** Reifen auf Ausgangszustand, optional vorgewaermt. */
  resetThermal(temperature = null) {
    this.temperature = temperature === null ? this.ambient : temperature;
    this.wear = 0;
    this.gripTemp = 1;
    this.gripWear = 1;
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
      return { fx: 0, fy: 0, mz: 0, slip: 0, saturation: 0 };
    }

    // Schlupf auf den jeweiligen Peak normieren -> gemeinsamer Reibkreis
    const sx = kappa / this.p.peakSlipRatio;
    const sy = Math.tan(alpha) / this.p.peakSlipAngle;
    const s = Math.hypot(sx, sy);

    this.slipLoad = s;

    if (s < 1e-6) {
      return { fx: 0, fy: 0, mz: 0, slip: 0, saturation: 0 };
    }

    const mu = this.frictionAt(Fz) * surfaceGrip * this.gripTemp * this.gripWear;
    const fMax = mu * Fz;
    const f = fMax * this.curve(s);

    const fx = (sx / s) * f;
    const fy = (sy / s) * f;

    // Rueckstellmoment. Der Nachlauf der Aufstandsflaeche (pneumatischer
    // Nachlauf) faellt zusammen, sobald der Reifen ins Gleiten geht - das
    // Lenkrad wird also leicht, BEVOR die Vorderachse wegrutscht. Genau
    // dieses Signal ist das, was ein Simulator dem Fahrer gibt und ein
    // Arcade-Spiel nicht.
    const pneumatic = this.p.pneumaticTrail * Math.max(0, 1 - s * 0.85);
    this.trail = pneumatic;
    const mz = -fy * (pneumatic + this.p.mechanicalTrail);

    // Kraft liegt entgegengesetzt zur Schlupfrichtung -> Reibkreis ist automatisch
    // eingehalten: Gas + Lenken teilen sich denselben Grip.
    return {
      fx,
      fy,
      mz,
      slip: s,
      saturation: Math.min(1, s),
    };
  }
}
