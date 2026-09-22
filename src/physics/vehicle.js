/**
 * Fahrzeugdynamik mit vier einzeln gerechneten Raedern.
 *
 * Koordinaten (passend zu three.js):
 *   Welt: X/Z-Ebene, Y = oben
 *   Fahrzeug lokal: +Z = vorne, +X = rechts, +Y = oben
 *   Gierwinkel psi = rotation.y, Vorwaertsvektor = (sin psi, 0, cos psi)
 *
 * Zustandsgroessen im Fahrzeugsystem:
 *   u = Laengsgeschwindigkeit (vorwaerts)
 *   w = Quergeschwindigkeit (positiv nach rechts)
 *   r = Gierrate (positiv = Nase dreht nach rechts)
 */

import { Tyre, TYRE_COMPOUNDS } from './tyre.js';
import { Drivetrain, GT3_SETUP, GT3_TORQUE_CURVE } from './drivetrain.js';

const G = 9.81;
const AIR_DENSITY = 1.225;

export const GT3_CHASSIS = {
  name: 'GT3 Coupe',
  mass: 1290, // kg inkl. Fahrer
  yawInertia: 1750, // kg m^2
  wheelbase: 2.65,
  frontWeightBias: 0.48, // Anteil der Radlast vorne im Stand
  trackFront: 1.68,
  trackRear: 1.64,
  cgHeight: 0.32,

  wheelRadiusFront: 0.335,
  wheelRadiusRear: 0.352,
  wheelInertiaFront: 1.25,
  wheelInertiaRear: 1.45,

  maxSteerAngle: 0.5, // rad am Rad (~29 Grad)
  ackermann: 0.65, // 0 = parallel, 1 = volle Ackermann-Geometrie
  steerSpeedFalloff: 0.55, // wie stark der Lenkeinschlag mit Tempo begrenzt wird

  brakeTorqueMax: 5400, // Nm gesamt
  brakeBias: 0.63, // Anteil vorne
  handbrakeTorque: 2600, // Nm auf die Hinterachse

  dragArea: 1.25, // Cd * A
  liftArea: 3.6, // Cl * A (Abtrieb)
  aeroBalance: 0.42, // Anteil des Abtriebs vorne

  rollStiffnessFront: 0.54, // Anteil der Querlastverlagerung vorne -> Balance
  rollTau: 0.11, // s, Aufbau der Waelzbewegung
  pitchTau: 0.085, // s, Aufbau der Nickbewegung

  rollingResistance: 0.014,
};

export const ASSIST_DEFAULTS = {
  abs: true,
  tractionControl: true,
  stabilityControl: false,
  steerAssist: true, // begrenzt den Lenkeinschlag bei hohem Tempo
  autoGearbox: true,
};

const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'];

class Wheel {
  constructor(name, lx, lz, radius, inertia, isFront, isDriven, tyre) {
    this.name = name;
    this.lx = lx; // lokal rechts (+) / links (-)
    this.lz = lz; // lokal vorne (+) / hinten (-)
    this.radius = radius;
    this.inertia = inertia;
    this.isFront = isFront;
    this.isDriven = isDriven;
    this.tyre = tyre;

    this.omega = 0; // rad/s
    this.steer = 0; // rad
    this.load = 0; // N
    this.fx = 0;
    this.fy = 0;
    this.slipRatio = 0;
    this.slipAngle = 0;
    this.slipLoad = 0; // >1 = jenseits des Kraftmaximums
    this.surfaceGrip = 1;
    this.surface = 'asphalt';
    this.groundHeight = 0;
    this.rumble = 0;
    this.spinAngle = 0; // fuer die Darstellung
    this.locked = false;
  }
}

export class Vehicle {
  constructor(options = {}) {
    this.c = { ...GT3_CHASSIS, ...(options.chassis || {}) };
    this.assists = { ...ASSIST_DEFAULTS, ...(options.assists || {}) };

    const compound = options.compound || TYRE_COMPOUNDS.slick;
    const c = this.c;
    const L = c.wheelbase;
    const b = L * c.frontWeightBias; // Abstand Schwerpunkt -> Hinterachse
    const a = L - b; // Abstand Schwerpunkt -> Vorderachse
    this.a = a;
    this.b = b;

    const staticFront = (c.mass * G * c.frontWeightBias) / 2;
    const staticRear = (c.mass * G * (1 - c.frontWeightBias)) / 2;

    this.wheels = [
      new Wheel('FL', -c.trackFront / 2, a, c.wheelRadiusFront, c.wheelInertiaFront, true, false, new Tyre(compound, staticFront)),
      new Wheel('FR', c.trackFront / 2, a, c.wheelRadiusFront, c.wheelInertiaFront, true, false, new Tyre(compound, staticFront)),
      new Wheel('RL', -c.trackRear / 2, -b, c.wheelRadiusRear, c.wheelInertiaRear, false, true, new Tyre(compound, staticRear)),
      new Wheel('RR', c.trackRear / 2, -b, c.wheelRadiusRear, c.wheelInertiaRear, false, true, new Tyre(compound, staticRear)),
    ];

    this.drivetrain = new Drivetrain(
      { ...GT3_SETUP, ...(options.drivetrain || {}) },
      options.torqueCurve || GT3_TORQUE_CURVE
    );
    this.drivetrain.autoGearbox = this.assists.autoGearbox;

    // Zustand
    this.position = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.u = 0;
    this.w = 0;
    this.r = 0;

    this.accelLong = 0;
    this.accelLat = 0;
    this.dFzLong = 0;
    this.dFzLat = 0;

    this.rollAngle = 0;
    this.pitchAngle = 0;
    this.terrainPitch = 0;
    this.terrainRoll = 0;

    this.steerInput = 0;
    this.steerAngle = 0;
    this.throttleApplied = 0;
    this.brakeApplied = 0;

    this.absActive = false;
    this.tcActive = false;
    this.tcCut = 0;
    this.escActive = false;

    this.time = 0;
    this.onGround = true;
    this.airborne = 0;
    this.verticalSpeed = 0;

    /** @type {null | ((x:number,z:number)=>{grip:number,height:number,rumble:number,surface:string})} */
    this.surfaceQuery = null;
  }

  get speed() {
    return Math.hypot(this.u, this.w);
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  /** Vorwaertsvektor in Weltkoordinaten */
  forwardVector() {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
  }

  rightVector() {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  /** Setzt das Auto an eine Position und richtet es aus. */
  placeAt(x, z, yaw, speed = 0, y = 0) {
    this.position.x = x;
    this.position.z = z;
    this.position.y = y;
    this.yaw = yaw;
    this.u = speed;
    this.w = 0;
    this.r = 0;
    this.accelLong = 0;
    this.accelLat = 0;
    this.dFzLong = 0;
    this.dFzLat = 0;
    this.rollAngle = 0;
    this.pitchAngle = 0;
    this.verticalSpeed = 0;
    this.drivetrain.reset();
    if (speed > 0.5) this.drivetrain.gearIndex = 3;
    for (const wheel of this.wheels) {
      wheel.omega = speed / wheel.radius;
      wheel.fx = 0;
      wheel.fy = 0;
      wheel.slipLoad = 0;
    }
  }

  /**
   * Ein Physikschritt mit fester Schrittweite.
   * @param {number} dt
   * @param {{steer:number, throttle:number, brake:number, handbrake:number, clutch:number, shiftUp:boolean, shiftDown:boolean}} input
   */
  step(dt, input) {
    const c = this.c;
    this.time += dt;

    // ---- Schalten ----------------------------------------------------------
    if (input.shiftUp) this.drivetrain.shiftUp(this.time);
    if (input.shiftDown) this.drivetrain.shiftDown(this.time);
    this.drivetrain.autoGearbox = this.assists.autoGearbox;

    // ---- Lenkung -----------------------------------------------------------
    this.steerInput = Math.max(-1, Math.min(1, input.steer));
    let maxSteer = c.maxSteerAngle;
    if (this.assists.steerAssist) {
      // Bei Tempo den maximalen Einschlag begrenzen: verhindert, dass man sich
      // mit Tastatur oder Touch bei 250 km/h sofort abschiesst.
      const v = this.speed;
      const f = 1 / (1 + c.steerSpeedFalloff * (v / 30) * (v / 30));
      maxSteer *= Math.max(0.22, f);
    }
    this.steerAngle = this.steerInput * maxSteer;

    const uSafe = Math.max(Math.abs(this.u), 0.5);

    // ---- Untergrund pro Rad abfragen ---------------------------------------
    const fwd = this.forwardVector();
    const right = this.rightVector();
    let groundSum = 0;
    for (const wheel of this.wheels) {
      const wx = this.position.x + fwd.x * wheel.lz + right.x * wheel.lx;
      const wz = this.position.z + fwd.z * wheel.lz + right.z * wheel.lx;
      if (this.surfaceQuery) {
        const q = this.surfaceQuery(wx, wz);
        wheel.surfaceGrip = q.grip;
        wheel.groundHeight = q.height;
        wheel.rumble = q.rumble;
        wheel.surface = q.surface;
      } else {
        wheel.surfaceGrip = 1;
        wheel.groundHeight = 0;
        wheel.rumble = 0;
        wheel.surface = 'asphalt';
      }
      groundSum += wheel.groundHeight;
    }
    const groundHeight = groundSum / 4;

    // Gelaendeneigung aus den Radhoehen: treibt Schwerkraftanteil und Optik
    const frontH = 0.5 * (this.wheels[0].groundHeight + this.wheels[1].groundHeight);
    const rearH = 0.5 * (this.wheels[2].groundHeight + this.wheels[3].groundHeight);
    const leftH = 0.5 * (this.wheels[0].groundHeight + this.wheels[2].groundHeight);
    const rightH = 0.5 * (this.wheels[1].groundHeight + this.wheels[3].groundHeight);
    this.terrainPitch = Math.atan2(frontH - rearH, c.wheelbase);
    this.terrainRoll = Math.atan2(rightH - leftH, (c.trackFront + c.trackRear) / 2);

    // ---- Vertikaldynamik / Spruenge ---------------------------------------
    this._integrateVertical(dt, groundHeight);
    const contact = this.onGround ? 1 : 0;

    // ---- Aerodynamik -------------------------------------------------------
    const vSq = this.u * this.u;
    const drag = 0.5 * AIR_DENSITY * c.dragArea * vSq * Math.sign(this.u || 1);
    const downforce = 0.5 * AIR_DENSITY * c.liftArea * vSq;
    const downFront = downforce * c.aeroBalance;
    const downRear = downforce * (1 - c.aeroBalance);

    // ---- Radlasten ---------------------------------------------------------
    const weight = c.mass * G * Math.cos(this.terrainPitch);
    const staticFrontTotal = weight * c.frontWeightBias;
    const staticRearTotal = weight * (1 - c.frontWeightBias);

    // Lastverlagerung mit Zeitkonstante: das Auto braucht einen Moment, bis es
    // sich auf die Federn legt. Genau daraus entsteht Lastwechselreaktion.
    const targetLong = (c.mass * this.accelLong * c.cgHeight) / c.wheelbase;
    const avgTrack = (c.trackFront + c.trackRear) / 2;
    const targetLat = (c.mass * this.accelLat * c.cgHeight) / avgTrack;
    this.dFzLong += (targetLong - this.dFzLong) * (1 - Math.exp(-dt / c.pitchTau));
    this.dFzLat += (targetLat - this.dFzLat) * (1 - Math.exp(-dt / c.rollTau));

    const frontTotal = staticFrontTotal + downFront - this.dFzLong;
    const rearTotal = staticRearTotal + downRear + this.dFzLong;
    const latFront = this.dFzLat * c.rollStiffnessFront;
    const latRear = this.dFzLat * (1 - c.rollStiffnessFront);

    // Querbeschleunigung nach rechts entlastet die rechten Raeder.
    const loads = [
      frontTotal / 2 + latFront, // FL
      frontTotal / 2 - latFront, // FR
      rearTotal / 2 + latRear, // RL
      rearTotal / 2 - latRear, // RR
    ];

    // ---- Lenkwinkel je Rad (Ackermann) ------------------------------------
    this._applySteering();

    // ---- Antrieb -----------------------------------------------------------
    const throttleRaw = Math.max(0, Math.min(1, input.throttle));
    const throttle = this._applyTractionControl(throttleRaw, dt);
    this.throttleApplied = throttle;

    const drivenSlip = Math.max(this.wheels[2].slipRatio, this.wheels[3].slipRatio);
    const drive = this.drivetrain.update(
      dt,
      throttle,
      input.clutch || 0,
      this.wheels[2].omega,
      this.wheels[3].omega,
      this.u,
      this.time,
      drivenSlip
    );

    // ---- Bremsen -----------------------------------------------------------
    const brake = Math.max(0, Math.min(1, input.brake));
    this.brakeApplied = brake;
    const handbrake = Math.max(0, Math.min(1, input.handbrake || 0));

    // ---- Kraefte je Rad ----------------------------------------------------
    let Ffwd = 0;
    let Fright = 0;
    let Mz = 0;
    this.absActive = false;

    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels[i];
      wheel.load = Math.max(0, loads[i]) * contact;

      // Curbs/Bodenwellen schuetteln die Radlast durch
      if (wheel.rumble > 0 && this.speed > 3) {
        const f = Math.sin(this.time * 78 + i * 1.7) * wheel.rumble;
        wheel.load *= 1 + f * 0.35;
      }

      // Radgeschwindigkeit im Fahrzeugsystem
      const vFwd = this.u - this.r * wheel.lx;
      const vRight = this.w + this.r * wheel.lz;

      // ... und im Radsystem
      const cs = Math.cos(wheel.steer);
      const sn = Math.sin(wheel.steer);
      const vLong = vFwd * cs + vRight * sn;
      const vLat = -vFwd * sn + vRight * cs;

      const vRef = Math.max(Math.abs(vLong), 1.6);
      const slipAngle = Math.atan2(-vLat, vRef);
      const slipRatio = (wheel.omega * wheel.radius - vLong) / vRef;

      wheel.slipAngle = slipAngle;
      wheel.slipRatio = slipRatio;

      const res = wheel.tyre.forces(slipRatio, slipAngle, wheel.load, wheel.surfaceGrip);
      wheel.fx = res.fx;
      wheel.fy = res.fy;
      wheel.slipLoad = res.slip;

      // Rollwiderstand
      const roll = -Math.sign(vLong) * c.rollingResistance * wheel.load;

      // --- Bremsmoment inkl. ABS -------------------------------------------
      let brakeTorque = brake * c.brakeTorqueMax * (wheel.isFront ? c.brakeBias : 1 - c.brakeBias);
      if (!wheel.isFront) brakeTorque += handbrake * c.handbrakeTorque * 0.5;

      if (this.assists.abs && brakeTorque > 0 && Math.abs(vLong) > 2.5 && handbrake < 0.5) {
        const limit = wheel.tyre.p.peakSlipRatio * 1.05;
        if (slipRatio < -limit) {
          const over = Math.min(1, (-slipRatio - limit) / limit);
          brakeTorque *= Math.max(0.05, 1 - over * 1.6);
          this.absActive = true;
        }
      }

      // --- Raddrehzahl: halbimplizit, sonst wird das bei 240 Hz instabil ----
      const driveTorque = wheel.isDriven
        ? i === 2
          ? this.drivetrain.outTorqueLeft
          : this.drivetrain.outTorqueRight
        : 0;

      const brakeDir = Math.abs(wheel.omega) < 0.6 && Math.abs(vLong) < 1.5 ? 0 : Math.sign(wheel.omega);
      const netTorque = driveTorque - brakeTorque * brakeDir - wheel.fx * wheel.radius;

      // Bei geschlossener Kupplung dreht die Motormasse ueber die Uebersetzung
      // mit - das gehoert in die Traegheit des Antriebsrades.
      const inertiaEff = wheel.inertia + (wheel.isDriven ? drive.reflectedInertia : 0);

      // Halbimplizite Radintegration: die lokale Steifigkeit von Reifen und
      // Antriebsstrang landet als Daempfung im Nenner. Ohne das schwingt die
      // Raddrehzahl bei 240 Hz auf und das Auto bremst sich selbst aus.
      // Wichtig: die Steifigkeit im linearen Bereich verwenden, nicht die am
      // aktuellen Arbeitspunkt. Jenseits des Kraftmaximums ist die lokale
      // Steigung naemlich null - dort waere der Schritt wieder explizit und
      // die Raddrehzahl wuerde aufschwingen. Die lineare Steigung ist eine
      // obere Schranke und daempft damit in jedem Betriebspunkt ausreichend.
      const h = 0.01;
      const probe = wheel.tyre.forces(h, 0, wheel.load, wheel.surfaceGrip);
      const dFxdKappa = Math.max(0, probe.fx / h);
      const stiffness =
        (dFxdKappa * wheel.radius * wheel.radius) / vRef +
        (wheel.isDriven ? drive.drivelineDamping : 0);
      const damping = (dt * stiffness) / inertiaEff;

      wheel.omega += ((netTorque / inertiaEff) * dt) / (1 + damping);

      // Bremse darf das Rad nicht rueckwaerts drehen
      if (brakeTorque > 0 && brakeDir !== 0 && Math.sign(wheel.omega) !== brakeDir && Math.abs(vLong) < 3) {
        wheel.omega = 0;
      }
      if (handbrake > 0.5 && !wheel.isFront) wheel.omega = 0;
      wheel.locked = Math.abs(wheel.omega) < 0.5 && Math.abs(vLong) > 3;

      wheel.spinAngle += wheel.omega * dt;

      // --- Kraefte ins Fahrzeugsystem zuruecktransformieren -----------------
      const fFwd = wheel.fx * cs - wheel.fy * sn + roll;
      const fRight = wheel.fx * sn + wheel.fy * cs;

      Ffwd += fFwd;
      Fright += fRight;
      Mz += wheel.lz * fRight - wheel.lx * fFwd;
    }

    // ---- Luftwiderstand, Hangabtrieb ---------------------------------------
    Ffwd -= drag;
    Ffwd -= c.mass * G * Math.sin(this.terrainPitch);
    Fright += c.mass * G * Math.sin(this.terrainRoll);

    // ---- Fahrdynamikregelung ------------------------------------------------
    if (this.assists.stabilityControl) Mz = this._applyStabilityControl(Mz, dt);

    // ---- Starrkoerper integrieren ------------------------------------------
    const m = c.mass;
    const aFwd = Ffwd / m + this.w * this.r;
    const aRight = Fright / m - this.u * this.r;

    this.u += aFwd * dt;
    this.w += aRight * dt;
    this.r += (Mz / c.yawInertia) * dt;

    // Messwerte fuer Lastverlagerung und HUD (ohne Zentripetalanteil)
    this.accelLong = Ffwd / m;
    this.accelLat = Fright / m;

    // Sehr langsames Rollen sauber zur Ruhe bringen
    if (Math.abs(this.u) < 0.22 && throttle < 0.04 && (brake > 0.02 || handbrake > 0.02)) {
      this.u = 0;
      this.w = 0;
      this.r *= 0.6;
      for (const wheel of this.wheels) wheel.omega = 0;
    }

    // ---- Position und Gierwinkel -------------------------------------------
    this.yaw += this.r * dt;
    if (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    else if (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;

    const f2 = this.forwardVector();
    const r2 = this.rightVector();
    this.position.x += (f2.x * this.u + r2.x * this.w) * dt;
    this.position.z += (f2.z * this.u + r2.z * this.w) * dt;

    // ---- Aufbaubewegung fuer die Darstellung -------------------------------
    const maxTransfer = c.mass * G * 0.5;
    this.rollAngle = -(this.dFzLat / maxTransfer) * 0.075;
    this.pitchAngle = (this.dFzLong / maxTransfer) * 0.06;
  }

  _integrateVertical(dt, groundHeight) {
    const targetY = groundHeight;
    if (this.position.y <= targetY + 0.005 && this.verticalSpeed <= 0) {
      this.position.y = targetY;
      this.verticalSpeed = 0;
      this.onGround = true;
      this.airborne = 0;
    } else {
      this.verticalSpeed -= G * dt;
      this.position.y += this.verticalSpeed * dt;
      if (this.position.y <= targetY) {
        this.position.y = targetY;
        // Landung: etwas Energie schlucken
        this.verticalSpeed = Math.max(0, this.verticalSpeed * -0.15);
        this.onGround = true;
        this.airborne = 0;
      } else {
        this.onGround = false;
        this.airborne += dt;
      }
    }
    // Kuppen: wenn es bergab steiler wird als das Auto folgen kann, hebt es ab
    if (this.onGround) {
      const dropRate = (this._lastGround !== undefined ? groundHeight - this._lastGround : 0) / dt;
      if (dropRate < -6 && this.speed > 22) {
        this.verticalSpeed = Math.max(0, dropRate + 6) + 0.6;
        this.onGround = false;
      }
    }
    this._lastGround = groundHeight;
  }

  _applySteering() {
    const c = this.c;
    const delta = this.steerAngle;
    if (Math.abs(delta) < 1e-5) {
      this.wheels[0].steer = 0;
      this.wheels[1].steer = 0;
      return;
    }
    // Ackermann: das kurvenaeussere Rad schlaegt weniger ein als das innere
    const R = c.wheelbase / Math.tan(Math.abs(delta));
    const inner = Math.atan(c.wheelbase / (R - c.trackFront / 2));
    const outer = Math.atan(c.wheelbase / (R + c.trackFront / 2));
    const k = c.ackermann;
    const innerMix = Math.abs(delta) + (inner - Math.abs(delta)) * k;
    const outerMix = Math.abs(delta) + (outer - Math.abs(delta)) * k;
    const sign = Math.sign(delta);
    if (sign > 0) {
      // Rechtskurve: rechtes Rad ist innen
      this.wheels[1].steer = innerMix * sign;
      this.wheels[0].steer = outerMix * sign;
    } else {
      this.wheels[0].steer = innerMix * sign;
      this.wheels[1].steer = outerMix * sign;
    }
  }

  _applyTractionControl(throttle, dt) {
    if (!this.assists.tractionControl) {
      this.tcCut = 0;
      this.tcActive = false;
      return throttle;
    }
    // Beim Anfahren regelt bereits die Launch Control der Kupplung den Schlupf.
    // Wenn die Traktionskontrolle hier zusaetzlich eingreift, arbeiten beide
    // gegeneinander und das Auto kommt nur stotternd weg.
    if (Math.abs(this.u) < 7 && this.drivetrain.mode === 'slipping') {
      this.tcCut *= Math.exp(-dt / 0.1);
      this.tcActive = false;
      return throttle;
    }

    // Regelziel: Antriebsschlupf knapp oberhalb des Kraftmaximums halten.
    let excess = 0;
    for (const wheel of this.wheels) {
      if (!wheel.isDriven) continue;
      const limit = wheel.tyre.p.peakSlipRatio * 1.2;
      if (wheel.slipRatio > limit) {
        excess = Math.max(excess, (wheel.slipRatio - limit) / (limit * 3));
      }
    }
    const target = Math.min(0.85, excess);
    // Eingriff zieht schnell an und gibt langsam wieder frei - sonst pumpt es.
    const tau = target > this.tcCut ? 0.045 : 0.18;
    this.tcCut += (target - this.tcCut) * (1 - Math.exp(-dt / tau));
    this.tcActive = this.tcCut > 0.04;
    return throttle * (1 - this.tcCut);
  }

  _applyStabilityControl(Mz, dt) {
    const v = this.u;
    if (Math.abs(v) < 8) {
      this.escActive = false;
      return Mz;
    }
    // Soll-Gierrate aus dem Einspurmodell
    const target = (v / (this.c.wheelbase + (this.c.mass * 0.0011 * v * v) / 100)) * Math.tan(this.steerAngle);
    const limit = Math.abs(target) + 0.25;
    const err = this.r - Math.max(-limit, Math.min(limit, target));
    if (Math.abs(err) < 0.09) {
      this.escActive = false;
      return Mz;
    }
    this.escActive = true;
    const correction = -err * this.c.yawInertia * 2.2;
    return Mz + Math.max(-9000, Math.min(9000, correction));
  }

  /** Kompakter Zustand fuer HUD, Sound und Effekte. */
  telemetry() {
    let maxSlip = 0;
    let wheelsOffTrack = 0;
    for (const wheel of this.wheels) {
      maxSlip = Math.max(maxSlip, wheel.slipLoad);
      if (wheel.surfaceGrip < 0.75) wheelsOffTrack++;
    }
    return {
      speedKmh: this.speedKmh,
      rpm: this.drivetrain.rpm,
      gear: this.drivetrain.gearLabel,
      gearIndex: this.drivetrain.gearIndex,
      throttle: this.throttleApplied,
      brake: this.brakeApplied,
      steer: this.steerInput,
      accelLong: this.accelLong / G,
      accelLat: this.accelLat / G,
      maxSlip,
      wheelsOffTrack,
      abs: this.absActive,
      tc: this.tcActive,
      esc: this.escActive,
      airborne: !this.onGround,
      limiter: this.drivetrain.limiterCut,
      shifting: this.drivetrain.isShifting,
    };
  }
}

export { WHEEL_NAMES, G };
