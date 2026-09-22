/**
 * Fahrwerk: gefederter Aufbau mit drei Freiheitsgraden.
 *
 * Bisher war die Radlastverteilung vorgeschrieben - eine Formel rechnete aus
 * der Querbeschleunigung aus, wie viel Last nach aussen wandert, und eine
 * willkuerliche Zeitkonstante verzoegerte das Ganze. Das ist genau der Punkt,
 * an dem sich ein Spiel nach Arcade anfuehlt: die Federn tun nichts, Curbs
 * sind nur ein Rumpeln, und am Fahrwerk laesst sich nichts einstellen.
 *
 * Hier traegt stattdessen an jeder Ecke eine Feder mit Daempfer den Aufbau.
 * Der Aufbau hat drei Freiheitsgrade - Hub, Nicken, Waelzen - und die
 * Radlasten sind das, was die Federn gerade tragen. Gewichtsverlagerung,
 * Nickbewegung, Lastwechsel, Curbschlaege und abhebende Raeder ergeben sich
 * daraus von selbst, mit den Zeitkonstanten, die aus Federrate und
 * Daempfung folgen. Und Federn, Daempfer und Stabilisatoren werden damit zu
 * echten Einstellgroessen.
 *
 * Vorzeichen:
 *   s   > 0  Feder eingefedert (Rad naeher am Aufbau)
 *   pitch > 0  Nase oben
 *   roll  > 0  rechte Seite oben
 *   lx    > 0  rechtes Rad, lz > 0 Vorderachse
 */

const G = 9.81;

export const GT3_SUSPENSION = {
  // Radraten in N/m (Feder mal Uebersetzungsverhaeltnis, am Rad gemessen)
  springRateFront: 160000,
  springRateRear: 140000,

  // Daempfer in Ns/m, Ausfedern haerter als Einfedern - wie am realen Auto
  damperBumpFront: 5200,
  damperReboundFront: 8800,
  damperBumpRear: 4800,
  damperReboundRear: 8200,

  // Stabilisatoren: Kraft je Meter Federwegdifferenz auf einer Achse
  arbFront: 42000,
  arbRear: 26000,

  // Federwege und Anschlaege
  bumpTravel: 0.045,
  droopTravel: 0.055,
  bumpStopRate: 900000,

  // Rollzentrumshoehen. Ueber sie laeuft der geometrische Anteil der
  // Lastverlagerung, der ohne Verzoegerung wirkt.
  rollCentreFront: 0.045,
  rollCentreRear: 0.075,

  // Anti-Dive und Anti-Squat: Anteil der Laengslastverlagerung, der ueber
  // die Lenker statt ueber die Federn laeuft
  antiDive: 0.3,
  antiSquat: 0.22,

  // Traegheiten des Aufbaus
  rollInertia: 480,
  pitchInertia: 1650,
  sprungMassFraction: 0.86,
};

export class Suspension {
  /**
   * @param {object} chassis Fahrzeugdaten (Masse, Radstand, Spur, Schwerpunkt)
   * @param {{lx:number, lz:number, isFront:boolean}[]} corners Radpositionen
   * @param {object} setup Fahrwerksdaten
   */
  constructor(chassis, corners, setup = GT3_SUSPENSION) {
    this.c = chassis;
    this.s = { ...setup };
    this.corners = corners;

    this.sprungMass = chassis.mass * this.s.sprungMassFraction;
    this.unsprungMass = chassis.mass - this.sprungMass;

    // Die Federn tragen nur die gefederte Masse. Raeder, Bremsen und halbe
    // Lenker stehen als ungefederte Masse direkt auf den Reifen und gehen
    // nicht durch die Feder - sonst fehlt in der Radlast genau ihr Gewicht.
    const sprungFront = (this.sprungMass * G * chassis.frontWeightBias) / 2;
    const sprungRear = (this.sprungMass * G * (1 - chassis.frontWeightBias)) / 2;
    this.staticLoad = corners.map((c) => (c.isFront ? sprungFront : sprungRear));

    const unsprungFront = (this.unsprungMass * G * chassis.frontWeightBias) / 2;
    const unsprungRear = (this.unsprungMass * G * (1 - chassis.frontWeightBias)) / 2;
    this.unsprungLoad = corners.map((c) => (c.isFront ? unsprungFront : unsprungRear));

    // Angriffspunkte des Abtriebs, naeherungsweise auf Hoehe der Achsen
    this.aeroArmFront = corners.find((c) => c.isFront).lz;
    this.aeroArmRear = -corners.find((c) => !c.isFront).lz;

    // Nur die gefederte Masse waelzt und nickt um die Aufbauachsen. Ihr
    // Schwerpunkt liegt etwas hoeher als der des ganzen Autos, weil die
    // ungefederte Masse auf Radmittenhoehe sitzt.
    this.wheelHeight = (chassis.wheelRadiusFront + chassis.wheelRadiusRear) / 2;
    this.sprungShare = this.sprungMass / chassis.mass;
    this.sprungCgHeight =
      (chassis.mass * chassis.cgHeight - this.unsprungMass * this.wheelHeight) / this.sprungMass;

    this.reset(0);
  }

  /**
   * Fahrzeugmasse aendern, z. B. wenn Sprit verbraucht wird.
   * Die statischen Radlasten sind die Vorspannung der Federn und muessen
   * deshalb mitwandern, sonst stimmt die Ruhelage nicht mehr.
   */
  setMass(mass) {
    const c = this.c;
    this.sprungMass = mass * this.s.sprungMassFraction;
    this.unsprungMass = mass - this.sprungMass;
    const sprungFront = (this.sprungMass * G * c.frontWeightBias) / 2;
    const sprungRear = (this.sprungMass * G * (1 - c.frontWeightBias)) / 2;
    const unsprungFront = (this.unsprungMass * G * c.frontWeightBias) / 2;
    const unsprungRear = (this.unsprungMass * G * (1 - c.frontWeightBias)) / 2;
    for (let i = 0; i < 4; i++) {
      const front = this.corners[i].isFront;
      this.staticLoad[i] = front ? sprungFront : sprungRear;
      this.unsprungLoad[i] = front ? unsprungFront : unsprungRear;
    }
    this.sprungShare = this.sprungMass / mass;
    this.sprungCgHeight =
      (mass * c.cgHeight - this.unsprungMass * this.wheelHeight) / this.sprungMass;
  }

  reset(groundHeight = 0) {
    this.bodyHeight = groundHeight;
    this.heaveRate = 0;
    this.pitch = 0;
    this.pitchRate = 0;
    this.roll = 0;
    this.rollRate = 0;
    this.travel = [0, 0, 0, 0];
    this.travelRate = [0, 0, 0, 0];
    this.load = this.staticLoad.slice();
    this.springForce = this.staticLoad.slice();
    this.contact = [1, 1, 1, 1];
    this.airborne = false;
    this._filtered = null;
  }

  rate(i) {
    return this.corners[i].isFront ? this.s.springRateFront : this.s.springRateRear;
  }

  damper(i, rate) {
    const front = this.corners[i].isFront;
    if (rate > 0) return front ? this.s.damperBumpFront : this.s.damperBumpRear;
    return front ? this.s.damperReboundFront : this.s.damperReboundRear;
  }

  /**
   * Ein Schritt.
   *
   * Laengs- und Querkraft stammen aus dem vorigen Schritt. Bei 240 Hz ist
   * dieser Versatz bedeutungslos, und er loest das Henne-Ei-Problem: die
   * Radlasten braucht man, um die Reifenkraefte zu rechnen, und die
   * Reifenkraefte, um die Lastverlagerung zu rechnen.
   *
   * @param {number} dt
   * @param {number[]} ground Bodenhoehe unter jedem Rad
   * @param {number} fx Laengskraft aller Reifen (vorwaerts positiv)
   * @param {number} fy Querkraft aller Reifen (rechts positiv)
   * @param {number} fyFront Querkraftanteil der Vorderachse
   * @param {number} aeroFront Abtrieb Vorderachse in N
   * @param {number} aeroRear Abtrieb Hinterachse in N
   */
  update(dt, ground, fx, fy, fyFront, aeroFront, aeroRear) {
    const s = this.s;
    const c = this.c;

    // --- Reifeneinhuellung --------------------------------------------------
    // Der Reifen ueberrollt kurze Stufen, statt ihnen exakt zu folgen; seine
    // Aufstandsflaeche mittelt ueber etwa 20 cm. Ohne diese Glaettung erzeugt
    // jede Curbkante einen Sprung in der Bodenhoehe und damit eine unendliche
    // Daempferkraft.
    const tau = 0.009;
    const a = 1 - Math.exp(-dt / tau);
    if (!this._filtered) this._filtered = ground.slice();
    for (let i = 0; i < 4; i++) {
      this._filtered[i] += (ground[i] - this._filtered[i]) * a;
    }
    const g = this._filtered;

    // --- Federwege und ihre Geschwindigkeit --------------------------------
    for (let i = 0; i < 4; i++) {
      const corner = this.corners[i];
      const bodyAtCorner = this.bodyHeight + this.pitch * corner.lz + this.roll * corner.lx;
      const next = g[i] - bodyAtCorner;
      const rate = (next - this.travel[i]) / dt;
      this.travelRate[i] = Math.max(-6, Math.min(6, rate));
      this.travel[i] = next;
    }

    // --- Federkraefte je Ecke ----------------------------------------------
    // Stabilisator wirkt auf die Differenz der Federwege einer Achse
    const arbFront = s.arbFront * (this.travel[0] - this.travel[1]);
    const arbRear = s.arbRear * (this.travel[2] - this.travel[3]);
    const arb = [arbFront, -arbFront, arbRear, -arbRear];

    let sumF = 0;
    let sumMy = 0; // Nickmoment aus den Federn
    let sumMx = 0; // Waelzmoment aus den Federn

    for (let i = 0; i < 4; i++) {
      const corner = this.corners[i];
      let force =
        this.staticLoad[i] +
        this.rate(i) * this.travel[i] +
        arb[i] +
        this.damper(i, this.travelRate[i]) * this.travelRate[i];

      // Durchschlagpuffer: jenseits des Federwegs wird es sehr steif
      if (this.travel[i] > s.bumpTravel) {
        force += s.bumpStopRate * (this.travel[i] - s.bumpTravel);
      }

      // Ein Rad kann nur druecken, nicht ziehen. Wird die Kraft null, hebt es ab.
      if (force < 0) force = 0;

      this.springForce[i] = force;
      sumF += force;
      sumMy += force * corner.lz;
      sumMx += force * corner.lx;
    }

    // --- Aufbaudynamik -----------------------------------------------------
    // Der Abtrieb greift am Aufbau an und drueckt ihn auf die Federn. Genau
    // deshalb sinkt das Auto mit steigendem Tempo tiefer, und genau deshalb
    // erreicht die Radlast erst ueber die Federn die Reifen - Abtrieb wird
    // hier also NICHT zusaetzlich auf die Raeder addiert.
    const aeroTotal = aeroFront + aeroRear;
    const heaveAccel = (sumF - this.sprungMass * G - aeroTotal) / this.sprungMass;

    // Nicken: Federmomente, Moment der Laengskraft um den Schwerpunkt und
    // das Nickmoment des Abtriebs. Der ueber die Lenker abgestuetzte Anteil
    // (Anti-Dive beim Bremsen, Anti-Squat beim Beschleunigen) belastet die
    // Federn nicht und wandert weiter unten direkt in die Radlast.
    const antiLong = fx > 0 ? s.antiSquat : s.antiDive;
    const fxSprung = fx * this.sprungShare;
    const pitchMoment =
      sumMy +
      fxSprung * this.sprungCgHeight * (1 - antiLong) -
      aeroFront * this.aeroArmFront +
      aeroRear * this.aeroArmRear;
    const pitchAccel = pitchMoment / s.pitchInertia;

    // Waelzen: Federmomente plus Moment der Querkraft um die Waelzachse
    const rcAvg = (s.rollCentreFront + s.rollCentreRear) / 2;
    const rollLever = Math.max(0.02, this.sprungCgHeight - rcAvg);
    const fySprung = fy * this.sprungShare;
    const rollAccel = (sumMx + fySprung * rollLever) / s.rollInertia;

    // Halbimplizit: erst Geschwindigkeit, dann Lage
    this.heaveRate += heaveAccel * dt;
    this.pitchRate += pitchAccel * dt;
    this.rollRate += rollAccel * dt;

    this.bodyHeight += this.heaveRate * dt;
    this.pitch += this.pitchRate * dt;
    this.roll += this.rollRate * dt;

    // Unsinnige Lagen abfangen
    this.pitch = Math.max(-0.3, Math.min(0.3, this.pitch));
    this.roll = Math.max(-0.3, Math.min(0.3, this.roll));

    // --- Geometrische Lastverlagerung --------------------------------------
    // Ueber Rollzentren und Anti-Dive/Anti-Squat laufende Anteile stuetzen
    // sich an den Lenkern ab und wirken deshalb ohne jede Verzoegerung. Ohne
    // sie reagiert das Auto auf den ersten Lenkimpuls sichtbar zu traege.
    // Nur der gefederte Anteil laeuft ueber die Rollzentren; die ungefederte
    // Masse verlagert weiter unten ueber den Hebel der Radmitte.
    const fyFrontSprung = fyFront * this.sprungShare;
    const fyRearSprung = (fy - fyFront) * this.sprungShare;
    const geoFront = (fyFrontSprung * s.rollCentreFront) / c.trackFront;
    const geoRear = (fyRearSprung * s.rollCentreRear) / c.trackRear;
    const geoLong = (fxSprung * this.sprungCgHeight * antiLong) / c.wheelbase;

    // Querkraft nach rechts entlastet die rechten Raeder; Vortrieb entlastet vorne
    const geo = [
      geoFront - geoLong / 2,
      -geoFront - geoLong / 2,
      geoRear + geoLong / 2,
      -geoRear + geoLong / 2,
    ];

    // Auch die ungefederte Masse verlagert Last, allerdings nur ueber den
    // kurzen Hebel der Radmitte.
    const ayApprox = fy / c.mass;
    const axApprox = fx / c.mass;
    const uFront = (this.unsprungMass * c.frontWeightBias * ayApprox * c.wheelRadiusFront) / c.trackFront;
    const uRear = (this.unsprungMass * (1 - c.frontWeightBias) * ayApprox * c.wheelRadiusRear) / c.trackRear;
    const uLong = (this.unsprungMass * axApprox * this.wheelHeight) / c.wheelbase;
    const unsprungShift = [uFront - uLong / 2, -uFront - uLong / 2, uRear + uLong / 2, -uRear + uLong / 2];

    let anyContact = false;
    for (let i = 0; i < 4; i++) {
      const load = Math.max(0, this.springForce[i] + this.unsprungLoad[i] + geo[i] + unsprungShift[i]);
      this.load[i] = load;
      this.contact[i] = load > 1 ? 1 : 0;
      if (this.contact[i]) anyContact = true;
    }
    this.airborne = !anyContact;

    return this.load;
  }

  /** Sichtbarer Federweg eines Rades relativ zum Aufbau. */
  wheelOffset(i) {
    const corner = this.corners[i];
    return this.travel[i] + this.pitch * corner.lz + this.roll * corner.lx;
  }
}

export { G };
