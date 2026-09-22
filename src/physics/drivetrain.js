/**
 * Antriebsstrang: Motor (Drehmomentkurve), Kupplung, Getriebe, Sperrdifferential.
 *
 * Der Motor haengt ueber eine Kupplung mit begrenztem Uebertragungsmoment am
 * Getriebe. Dadurch kann das Auto anfahren ohne abzuwuergen, und beim harten
 * Runterschalten gibt es echten Schubbetrieb an der Hinterachse.
 */

const RPM_TO_RADS = (2 * Math.PI) / 60;
const RADS_TO_RPM = 60 / (2 * Math.PI);
const LAUNCH_SPEED = 7; // m/s, darunter regelt die Anfahrhilfe

/** Drehmomentkurve eines GT3-artigen Saugers: rpm -> Nm */
export const GT3_TORQUE_CURVE = [
  [0, 0],
  [800, 210],
  [1500, 330],
  [2500, 430],
  [3500, 490],
  [4500, 528],
  [5500, 552],
  [6500, 560],
  [7000, 550],
  [7500, 525],
  [8000, 480],
  [8600, 405],
  [9200, 300],
];

export const GT3_SETUP = {
  idleRpm: 1150,
  redlineRpm: 8400,
  limiterRpm: 8600,
  maxRpm: 9200,
  inertia: 0.18, // kg m^2 (Kurbelwelle + leichtes Rennschwungrad)
  engineBrakeCoeff: 0.055, // Nm pro rad/s Schubmoment
  frictionTorque: 14, // konstante Grundreibung

  // Sequenzielles 6-Gang
  gears: [-3.15, 0, 3.02, 2.15, 1.71, 1.42, 1.21, 1.04],
  finalDrive: 3.55,
  efficiency: 0.92,
  shiftTime: 0.09, // s Zugkraftunterbrechung

  clutchMaxTorque: 780, // Nm
  launchTargetSlip: 0.13, // Zielschlupf beim Anfahren
  launchTime: 0.9, // s bis die Kupplung ohne Schlupf ganz zu waere
  // Sperrdifferential
  diffPreload: 60, // Nm
  diffPowerLock: 0.45, // Sperrwirkung unter Last
  diffCoastLock: 0.25, // Sperrwirkung im Schub
};

function interpCurve(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return last[1];
}

export class Drivetrain {
  constructor(setup = GT3_SETUP, torqueCurve = GT3_TORQUE_CURVE) {
    this.s = { ...setup };
    this.curve = torqueCurve;

    this.gearIndex = 1; // Index in s.gears; 0 = Rueckwaerts, 1 = Neutral, 2.. = 1. Gang
    this.omegaEngine = this.s.idleRpm * RPM_TO_RADS;
    this.shiftTimer = 0;
    this.clutchLock = 0; // 0 = offen, 1 = geschlossen
    this.limiterCut = 0;
    this.autoGearbox = true;
    this.lastShiftAt = -10;

    this.outTorqueLeft = 0;
    this.outTorqueRight = 0;
    this.clutchTorque = 0;
    this.mode = 'slipping';
    this.launchEngage = 0.04;
    this.reflectedInertia = 0;
    this.drivelineDamping = 0;
  }

  get rpm() {
    return this.omegaEngine * RADS_TO_RPM;
  }

  get gearRatio() {
    return this.s.gears[this.gearIndex];
  }

  /** Anzeigename: R, N, 1..6 */
  get gearLabel() {
    if (this.gearIndex === 0) return 'R';
    if (this.gearIndex === 1) return 'N';
    return String(this.gearIndex - 1);
  }

  get isShifting() {
    return this.shiftTimer > 0;
  }

  shiftUp(now) {
    if (this.shiftTimer > 0) return false;
    if (this.gearIndex >= this.s.gears.length - 1) return false;
    this.gearIndex++;
    this.shiftTimer = this.s.shiftTime;
    this.lastShiftAt = now;
    return true;
  }

  shiftDown(now) {
    if (this.shiftTimer > 0) return false;
    if (this.gearIndex <= 0) return false;
    this.gearIndex--;
    this.shiftTimer = this.s.shiftTime;
    this.lastShiftAt = now;
    return true;
  }

  engineTorqueAt(rpm, throttle) {
    const wide = interpCurve(this.curve, rpm);
    // Schubmoment: Motorbremse + Grundreibung
    const drag = this.s.frictionTorque + this.s.engineBrakeCoeff * Math.max(0, this.omegaEngine);
    return wide * throttle - drag * (1 - throttle * 0.55);
  }

  /**
   * Ein Simulationsschritt.
   * @param {number} dt
   * @param {number} throttle 0..1
   * @param {number} clutchPedal 0..1 (1 = getreten = offen)
   * @param {number} omegaLeft  Winkelgeschw. linkes Antriebsrad (rad/s)
   * @param {number} omegaRight Winkelgeschw. rechtes Antriebsrad (rad/s)
   * @param {number} speed      Fahrzeuggeschwindigkeit m/s (fuer Anfahrautomatik)
   * @param {number} now        Zeitstempel s
   * @param {number} drivenSlip Groesster Laengsschlupf an der Antriebsachse
   */
  update(dt, throttle, clutchPedal, omegaLeft, omegaRight, speed, now, drivenSlip = 0) {
    const s = this.s;

    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    const ratio = this.gearRatio * s.finalDrive;
    const inGear = ratio !== 0 && this.shiftTimer <= 0;

    // --- Kupplungszustand -------------------------------------------------
    // Beim Anfahren automatisch schleifen lassen, sonst geschlossen.
    let engage = 1;
    if (!inGear) {
      engage = 0;
    } else {
      const absSpeed = Math.abs(speed);
      if (absSpeed < LAUNCH_SPEED) {
        // Anfahren als Schlupfregelung (das macht eine echte Launch Control
        // genauso): die Kupplung schliesst stetig, oeffnet aber sofort wieder,
        // sobald die Antriebsraeder mehr Schlupf aufbauen als der Reifen in
        // Vortrieb umsetzen kann. Eine Regelung ueber die Motordrehzahl waere
        // dagegen mitkoppelnd - die Drehzahl steigt ja gerade deshalb, weil
        // die Kupplung noch offen ist.
        const slipErr = Math.max(0, drivenSlip - s.launchTargetSlip);
        this.launchEngage += (1 / s.launchTime - slipErr * 25) * dt;

        // Abwuergschutz: faellt die Drehzahl Richtung Leerlauf, geht die
        // Kupplung wieder auf, statt den Motor abzuwuergen.
        const bog = Math.max(0, Math.min(1, (this.rpm - s.idleRpm * 1.15) / (s.idleRpm * 0.9)));
        this.launchEngage = Math.max(0.04, Math.min(1, this.launchEngage));
        engage = Math.min(this.launchEngage, 0.2 + 0.8 * bog);
      } else {
        this.launchEngage = 1;
      }
    }
    if (!inGear || Math.abs(speed) < 0.4) this.launchEngage = Math.min(this.launchEngage, 0.35);
    engage *= 1 - Math.min(1, clutchPedal);

    // Schliessrate begrenzen, damit die Kupplung nie schlagartig ein Vielfaches
    // des uebertragbaren Moments in die Hinterachse wirft.
    const closeRate = dt / 0.18;
    const openRate = dt / 0.05;
    const delta = engage - this.clutchLock;
    this.clutchLock += Math.max(-openRate, Math.min(closeRate, delta));
    engage = this.clutchLock;

    // --- Drehzahlbegrenzer ------------------------------------------------
    let thr = Math.max(0, Math.min(1, throttle));
    if (this.rpm > s.limiterRpm) {
      this.limiterCut = 1;
      thr = 0;
    } else if (this.rpm > s.redlineRpm) {
      // sanftes Ausblenden kurz vor dem harten Cut
      const t = (this.rpm - s.redlineRpm) / (s.limiterRpm - s.redlineRpm);
      this.limiterCut = t;
      thr *= 1 - t * 0.85;
    } else {
      this.limiterCut = 0;
    }
    if (this.shiftTimer > 0) thr *= 0.1; // Zugkraftunterbrechung beim Schalten

    // --- Motor ------------------------------------------------------------
    // Leerlaufregler: stellt wie ein Leerlaufstellglied zusaetzliches Moment
    // bereit, wenn die Drehzahl unter den Sollleerlauf faellt.
    const idleOmega = s.idleRpm * RPM_TO_RADS;
    const omegaDriveAvg = 0.5 * (omegaLeft + omegaRight);
    const omegaTransmission = omegaDriveAvg * ratio;

    // Verriegelter Antriebsstrang, sobald die Kupplung geschlossen ist und die
    // Getriebedrehzahl ueber Leerlauf liegt. Dann wird der Motor nicht mehr
    // ueber eine steife Feder an die Raeder gekoppelt (das waere bei 240 Hz
    // numerisch instabil), sondern seine Traegheit wird ueber die Uebersetzung
    // auf die Raeder umgerechnet und dort mitintegriert.
    const canLock = inGear && engage > 0.985 && omegaTransmission > idleOmega * 1.02;

    let axleTorque = 0;
    let reflectedInertia = 0;
    let drivelineDamping = 0;

    if (canLock) {
      this.mode = 'locked';
      this.omegaEngine = Math.min(s.maxRpm * RPM_TO_RADS, omegaTransmission);

      let tEngine = this.engineTorqueAt(this.rpm, thr);
      const idleErr = (s.idleRpm - this.rpm) / s.idleRpm;
      if (idleErr > 0) tEngine += Math.min(160, idleErr * 900) * (1 - thr);

      axleTorque = tEngine * ratio * s.efficiency;
      this.clutchTorque = tEngine;
      // Motortraegheit auf ein Antriebsrad umgerechnet (Uebersetzung quadratisch)
      reflectedInertia = (s.inertia * ratio * ratio) / 2;
    } else {
      this.mode = 'slipping';

      const idleErr = (s.idleRpm - this.rpm) / s.idleRpm;
      const tIdle = idleErr > 0 ? Math.min(160, idleErr * 900) * (1 - thr) : 0;
      const tEngine = this.engineTorqueAt(this.rpm, thr) + tIdle;

      // Kupplungsmoment proportional zur Drehzahldifferenz, auf die Kapazitaet
      // der Kupplung begrenzt. Im begrenzten Bereich ist das Moment konstant,
      // dort entsteht keine numerische Steifigkeit.
      const capacity = s.clutchMaxTorque * engage;
      const stiffness = 45;
      let tClutch = 0;
      let saturated = true;
      if (capacity > 0) {
        const raw = (this.omegaEngine - omegaTransmission) * stiffness;
        if (Math.abs(raw) < capacity) {
          tClutch = raw;
          saturated = false;
        } else {
          tClutch = Math.sign(raw) * capacity;
        }
      }
      this.clutchTorque = tClutch;

      this.omegaEngine += ((tEngine - tClutch) / s.inertia) * dt;

      // Absterben verhindern
      const stallOmega = idleOmega * 0.55;
      if (this.omegaEngine < stallOmega) this.omegaEngine = stallOmega;
      this.omegaEngine = Math.min(s.maxRpm * RPM_TO_RADS, this.omegaEngine);

      axleTorque = inGear ? tClutch * ratio * s.efficiency : 0;
      // Im nicht begrenzten Bereich wirkt die Kupplung als Daempfer auf das Rad.
      if (!saturated && inGear) {
        drivelineDamping = (stiffness * ratio * ratio * s.efficiency) / 2;
      }
    }

    // --- Sperrdifferential ------------------------------------------------
    // Grundverteilung 50/50, dazu ein Sperrmoment gegen die Drehzahldifferenz.
    const dOmegaWheels = omegaLeft - omegaRight;
    const isPower = axleTorque * (omegaDriveAvg >= 0 ? 1 : -1) > 0;
    const lockRatio = isPower ? s.diffPowerLock : s.diffCoastLock;
    const lockCapacity = s.diffPreload + Math.abs(axleTorque) * lockRatio;
    const tLock = Math.max(-lockCapacity, Math.min(lockCapacity, dOmegaWheels * 22));

    this.outTorqueLeft = axleTorque * 0.5 - tLock;
    this.outTorqueRight = axleTorque * 0.5 + tLock;
    this.reflectedInertia = reflectedInertia;
    this.drivelineDamping = drivelineDamping;

    // --- Automatikgetriebe ------------------------------------------------
    if (this.autoGearbox) this._autoShift(throttle, speed, now);

    return {
      axleTorque,
      reflectedInertia,
      drivelineDamping,
      mode: this.mode,
    };
  }

  _autoShift(throttle, speed, now) {
    if (this.shiftTimer > 0) return;
    if (now - this.lastShiftAt < 0.45) return;

    const rpm = this.rpm;
    const forward = speed > -0.5;

    if (this.gearIndex <= 1 && forward && (speed > 0.3 || throttle > 0.02)) {
      this.gearIndex = 2; // aus N in den 1. Gang
      this.lastShiftAt = now;
      return;
    }
    if (this.gearIndex < 2) return;

    // Beim Anfahren schleift die Kupplung, die Motordrehzahl sagt dann nichts
    // ueber die Fahrgeschwindigkeit aus. Wer hier nach Drehzahl schaltet, legt
    // bei 15 km/h den zweiten Gang ein und wuergt die Beschleunigung ab.
    if (this.mode === 'slipping' && Math.abs(speed) < LAUNCH_SPEED) return;

    const upAt = this.s.redlineRpm * (0.82 + throttle * 0.12);
    const downAt = this.s.redlineRpm * 0.42;

    if (rpm > upAt && this.gearIndex < this.s.gears.length - 1) {
      this.shiftUp(now);
    } else if (rpm < downAt && this.gearIndex > 2) {
      this.shiftDown(now);
    }
  }

  reset() {
    this.gearIndex = 1;
    this.omegaEngine = this.s.idleRpm * RPM_TO_RADS;
    this.shiftTimer = 0;
    this.clutchLock = 0;
    this.launchEngage = 0.04;
    this.outTorqueLeft = 0;
    this.outTorqueRight = 0;
  }
}

export { RPM_TO_RADS, RADS_TO_RPM, interpCurve };
