/**
 * Spielschleife.
 *
 * Die Physik laeuft mit fester Schrittweite (240 Hz), unabhaengig von der
 * Bildrate. Das Bild darf dabei schwanken, das Fahrverhalten nicht - sonst
 * faehrt sich dasselbe Auto auf dem Handy anders als am PC.
 */
import * as THREE from 'three';

import { Vehicle } from './physics/vehicle.js';
import { TYRE_COMPOUNDS } from './physics/tyre.js';
import { Track } from './track/track.js';
import { AUTODROM_NORDWIND } from './track/trackData.js';
import { LapTimer, formatTime } from './track/timing.js';

import { Renderer } from './render/scene.js';
import { CameraRig, CAMERA_LABELS } from './render/cameras.js';
import { buildTrackMesh } from './render/trackMesh.js';
import { buildScenery } from './render/scenery.js';
import { buildCar } from './render/carModel.js';
import { SkidMarks, DustParticles } from './render/effects.js';

import { InputManager } from './input/input.js';
import { Hud } from './ui/hud.js';
import { TouchControls } from './ui/touchControls.js';
import { Menu, loadSettings, saveSettings } from './ui/menu.js';
import { EngineAudio } from './audio/engineAudio.js';

// Die Physik laeuft normalerweise mit 240 Hz. Schafft das Geraet das nicht,
// wird die Schrittweite vergroebert statt Zeit zu verwerfen - sonst laeuft das
// Spiel auf schwacher Hardware in Zeitlupe.
const PHYSICS_RATES = [240, 120, 80];
const MAX_SUBSTEPS = 10;

class Game {
  constructor(root) {
    this.root = root;
    this.settings = loadSettings();
    this.running = false;
    this.paused = true;
    this.accumulator = 0;
    this.lastFrame = 0;
    this.frameTimes = [];
    this.fps = 0;
    this.rateIndex = 0;
    this.physicsDt = 1 / PHYSICS_RATES[0];
    this.overloadStreak = 0;
    this.comfortStreak = 0;

    this._boot();
  }

  _boot() {
    const canvas = document.getElementById('view');
    this.renderer = new Renderer(canvas, this.settings.quality);
    this.cameraRig = new CameraRig(this.renderer.camera);
    this.cameraRig.setMode(this.settings.camera);

    this.track = new Track(AUTODROM_NORDWIND);
    if (this.track.warnings.length) console.warn('Strecke:', this.track.warnings);

    this.renderer.scene.add(buildTrackMesh(this.track, this.settings.quality));
    this.renderer.scene.add(buildScenery(this.track, this.settings.quality));

    this.skids = new SkidMarks(this.renderer.scene);
    this.dust = new DustParticles(this.renderer.scene);

    this.carView = buildCar({
      bodyColor: this.settings.color,
      number: this.settings.number,
      quality: this.settings.quality,
    });
    this.renderer.scene.add(this.carView.root);

    this.vehicle = new Vehicle({
      assists: this.settings.assists,
      compound: TYRE_COMPOUNDS.slick,
    });
    this._hint = -1;
    this.vehicle.surfaceQuery = (x, z) => {
      const q = this.track.sample(x, z, this._hint);
      this._hint = q.index;
      return q;
    };

    this.timer = new LapTimer(this.track);
    this.input = new InputManager({ tiltRange: this.settings.tiltRange });
    this.audio = new EngineAudio();
    this.audio.setVolume(this.settings.volume);

    const ui = document.getElementById('ui');
    this.hud = new Hud(ui, this.track);
    this.touch = new TouchControls(ui, this.input);
    this.touch.setLayout(this.settings.touchLayout);

    this.menu = new Menu(ui, this.settings, {
      onStart: () => this.start(),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onChange: (s) => this.applySettings(s),
      onCalibrateTilt: () => {
        this.input.calibrateTilt();
        this.hud.showMessage('Nullpunkt gesetzt', 1.6);
      },
      onCalibrateWheel: () => {
        if (this.input.calibration) this.input.cancelCalibration();
        else this.input.startCalibration();
      },
      onEnableTilt: async () => {
        const ok = await this.input.enableTilt();
        if (ok) {
          this.input.calibrateTilt();
          this.touch.setLayout('neigung');
        } else {
          this.settings.tilt = false;
          this.settings.touchLayout = 'tasten';
          this.touch.setLayout('tasten');
          this.menu.refreshTouch();
        }
        saveSettings(this.settings);
      },
    });

    this.touchCapable = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.touch.setVisible(false);

    this.resetToGrid();
    this.applySettings(this.settings);

    window.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.running && !this.paused) this.pause();
    });

    this.menu.show('start');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    document.getElementById('boot')?.remove();
  }

  // ------------------------------------------------------------- Steuerung
  applySettings(s) {
    Object.assign(this.vehicle.assists, s.assists);
    this.vehicle.drivetrain.autoGearbox = s.assists.autoGearbox;
    this.carView.setColor(s.color);
    this.cameraRig.setMode(s.camera);
    this.audio.setVolume(s.volume);
    this.input.tilt.range = s.tiltRange;
    this.input.enabled.tilt = s.tilt;
    if (this.renderer.quality !== s.quality) this.renderer.setQuality(s.quality);
    this.touch.setLayout(s.tilt ? 'neigung' : s.touchLayout);
    if (!s.tilt) this.input.disableTilt();
  }

  start() {
    this.audio.start();
    this.menu.hide();
    this.paused = false;
    this.running = true;
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.touch.setVisible(this.touchCapable);
    this.hud.setVisible(true);
    this.hud.showMessage('Freies Fahren – viel Spass', 2.4);
  }

  resume() {
    this.audio.start();
    this.menu.hide();
    this.paused = false;
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.touch.setVisible(this.touchCapable);
  }

  pause() {
    this.paused = true;
    this.audio.stop();
    this.touch.setVisible(false);
    this.menu.showResults(this.timer);
    this.menu.show('pause');
  }

  restart() {
    this.timer.reset();
    this.skids.clear();
    this.dust.clear();
    this.hud.lapList.innerHTML = '';
    this.resetToGrid();
    this.resume();
    this.hud.showMessage('Neu gestartet', 1.8);
  }

  resetToGrid() {
    const slot = this.track.gridSlot(0);
    this.vehicle.placeAt(slot.x, slot.z, slot.yaw, 0, slot.y);
    this._hint = slot.index;
    this.timer.restart();
    for (let i = 0; i < 4; i++) this.skids.reset(i);
  }

  /** Nach einem Dreher zurueck auf die Strecke, in Fahrtrichtung. */
  recover() {
    const q = this.track.sample(this.vehicle.position.x, this.vehicle.position.z, this._hint);
    const p = this.track.points[q.index];
    const speed = Math.min(this.vehicle.speed, 22);
    this.vehicle.placeAt(p.x, p.z, p.heading, speed, p.elevation);
    this._hint = q.index;
    this.timer.invalidate();
    for (let i = 0; i < 4; i++) this.skids.reset(i);
    this.hud.showMessage('Zurueck auf der Strecke – Runde ungueltig', 2.0, 'warn');
  }

  // ------------------------------------------------------------- Kollision
  _resolveWall() {
    const v = this.vehicle;
    const q = this.track.sample(v.position.x, v.position.z, this._hint);
    this._hint = q.index;
    const over = Math.abs(q.lateral) - q.wallDistance;
    if (over <= 0) return 0;

    const sign = Math.sign(q.lateral);
    // Normale zur rechten Seite der Strecke - gleiche Konvention wie
    // track.sample(), sonst schiebt die Bande in die falsche Richtung.
    const nx = -Math.cos(q.heading);
    const nz = Math.sin(q.heading);

    // aus der Wand schieben
    v.position.x -= sign * nx * over;
    v.position.z -= sign * nz * over;

    // Geschwindigkeit in Streckenkoordinaten zerlegen
    const f = v.forwardVector();
    const r = v.rightVector();
    const vx = f.x * v.u + r.x * v.w;
    const vz = f.z * v.u + r.z * v.w;
    const across = vx * nx + vz * nz;

    if (sign * across <= 0) return 0; // faehrt bereits weg von der Wand

    const impact = Math.abs(across);
    const restitution = 0.18;
    const newVx = vx - nx * across * (1 + restitution);
    const newVz = vz - nz * across * (1 + restitution);

    // Laengsanteil bremsen - Wandkontakt kostet immer Tempo
    const drag = Math.max(0.55, 1 - impact * 0.06);
    v.u = (newVx * f.x + newVz * f.z) * drag;
    v.w = (newVx * r.x + newVz * r.z) * drag;
    v.r *= 0.35;
    return impact;
  }

  // ------------------------------------------------------------- Schleife
  loop(now) {
    requestAnimationFrame(this.loop);

    const rawDt = Math.min(0.1, (now - this.lastFrame) / 1000 || 0);
    this.lastFrame = now;

    if (this.frameTimes.push(rawDt) > 60) this.frameTimes.shift();
    this.fps = 1 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);

    if (this.menu.isOpen) {
      this.menu.updateDeviceStatus(this.input);
      this.input.update(rawDt);
      this.input.consume();
    }

    if (!this.paused) this._tick(rawDt);

    this.renderer.followShadow(this.vehicle.position.x, this.vehicle.position.y, this.vehicle.position.z);
    this.renderer.render();
  }

  _tick(dt) {
    this.touch.update(dt);
    const axes = this.input.update(dt);
    const events = this.input.consume();

    if (events.pause) {
      this.pause();
      return;
    }
    if (events.camera) {
      let mode = this.cameraRig.mode;
      for (let i = 0; i < events.camera; i++) mode = this.cameraRig.cycle();
      this.settings.camera = mode;
      saveSettings(this.settings);
      this.menu.refreshCamera();
      this.hud.showMessage(`Kamera: ${CAMERA_LABELS[mode]}`, 1.2);
    }
    if (events.reset) this.recover();
    if (events.toTrack) {
      this.resetToGrid();
      this.hud.showMessage('Zurueck an den Start', 1.6);
    }

    const input = {
      steer: axes.steer,
      throttle: axes.throttle,
      brake: axes.brake,
      handbrake: axes.handbrake,
      clutch: axes.clutch,
      shiftUp: events.shiftUp > 0,
      shiftDown: events.shiftDown > 0,
    };

    // --- Physik mit fester Schrittweite ------------------------------------
    this.accumulator += dt;
    let steps = 0;
    let maxImpact = 0;
    while (this.accumulator >= this.physicsDt && steps < MAX_SUBSTEPS) {
      this.vehicle.step(this.physicsDt, input);
      maxImpact = Math.max(maxImpact, this._resolveWall());
      // Schaltbefehle gelten nur fuer den ersten Teilschritt
      input.shiftUp = false;
      input.shiftDown = false;
      this.accumulator -= this.physicsDt;
      steps++;
    }
    this._adaptPhysicsRate(steps);

    // --- Zeitnahme ---------------------------------------------------------
    const q = this.track.sample(this.vehicle.position.x, this.vehicle.position.z, this._hint);
    this._hint = q.index;
    const offTrack = this.vehicle.wheels.every((w) => w.surfaceGrip < 0.75);
    const lap = this.timer.update(dt, q.s, offTrack, this.vehicle.speed);
    if (lap) {
      this.hud.addLap(lap);
      if (!lap.valid) this.hud.showMessage(`Runde ${lap.number} ungueltig`, 2.4, 'warn');
      else if (lap.best) this.hud.showMessage(`Neue Bestzeit  ${formatTime(lap.time)}`, 3.0, 'best');
      else this.hud.showMessage(`Runde ${lap.number}  ${formatTime(lap.time)}`, 2.4);
    }

    if (maxImpact > 4) this.hud.showMessage('Bandenkontakt', 1.2, 'warn');

    // --- Darstellung -------------------------------------------------------
    this._updateCarVisual(dt);
    this._updateEffects(dt);
    this.cameraRig.update(dt, this.vehicle);

    const tel = this.vehicle.telemetry();
    this.audio.update(tel, {
      slip: tel.maxSlip,
      rumble: Math.max(...this.vehicle.wheels.map((w) => (w.surface === 'kerb' ? w.rumble : w.surface === 'asphalt' ? 0 : 0.5))),
      airborne: tel.airborne,
    });
    this.hud.update(tel, this.timer, this.vehicle.position, dt);
  }

  /**
   * Haelt die Simulation in Echtzeit. Reicht das Teilschritt-Budget dauerhaft
   * nicht, wird die Schrittweite vergroebert; laeuft es wieder rund, geht es
   * zurueck auf die feinere Aufloesung.
   */
  _adaptPhysicsRate(steps) {
    if (steps >= MAX_SUBSTEPS) {
      this.overloadStreak++;
      this.comfortStreak = 0;
      if (this.overloadStreak > 5 && this.rateIndex < PHYSICS_RATES.length - 1) {
        this.rateIndex++;
        this.physicsDt = 1 / PHYSICS_RATES[this.rateIndex];
        this.overloadStreak = 0;
      }
      // Restzeit verwerfen, damit sich kein Rueckstand aufbaut
      this.accumulator = 0;
    } else {
      this.overloadStreak = 0;
      if (steps <= MAX_SUBSTEPS / 3) {
        this.comfortStreak++;
        if (this.comfortStreak > 600 && this.rateIndex > 0) {
          this.rateIndex--;
          this.physicsDt = 1 / PHYSICS_RATES[this.rateIndex];
          this.comfortStreak = 0;
        }
      } else {
        this.comfortStreak = 0;
      }
    }
  }

  _updateCarVisual(dt) {
    const v = this.vehicle;
    const view = this.carView;

    view.root.position.set(v.position.x, v.position.y, v.position.z);
    // Das ganze Auto folgt der Fahrbahnneigung: erst waelzen, dann nicken,
    // dann gieren. Ohne das steht es in ueberhoehten Kurven schief in der Luft.
    view.root.rotation.order = 'YXZ';
    // Mesh-+X ist die linke Fahrzeugseite, deshalb kippt ein nach rechts
    // ansteigendes Quergefaelle das Modell um -terrainRoll.
    view.root.rotation.set(-v.terrainPitch, v.yaw, -v.terrainRoll);

    // Der Aufbau nickt und waelzt zusaetzlich gegenueber den Raedern
    view.shell.rotation.set(v.pitchAngle, 0, -v.rollAngle);
    view.shell.position.y = -Math.abs(v.rollAngle) * 0.12;

    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      const vis = view.wheels[w.name];
      if (!vis) continue;
      vis.pivot.rotation.y = -w.steer;
      vis.spin.rotation.x = w.spinAngle;
      // Federweg andeuten: mehr Last -> Rad steht relativ hoeher im Radhaus
      const nominal = w.tyre.nominalLoad;
      const travel = Math.max(-0.05, Math.min(0.05, (w.load - nominal) / nominal * 0.045));
      vis.pivot.position.y = vis.radius - travel;
    }

    // Lenkrad im Cockpit
    view.steeringWheel.rotation.z = -v.steerInput * 2.6;
    view.interior.visible = this.cameraRig.mode !== 'cockpit' ? true : true;
  }

  _updateEffects(dt) {
    const v = this.vehicle;
    const fwd = v.forwardVector();
    const right = v.rightVector();
    const speed = v.speed;

    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      const wx = v.position.x + fwd.x * w.lz + right.x * w.lx;
      const wz = v.position.z + fwd.z * w.lz + right.z * w.lx;
      const wy = w.groundHeight;

      const sliding = w.slipLoad > 1.12 && speed > 4;
      const onAsphalt = w.surface === 'asphalt' || w.surface === 'kerb';

      if (sliding && onAsphalt) {
        const strength = Math.min(1, (w.slipLoad - 1.12) * 1.5);
        this.skids.add(i, wx, wy, wz, fwd.x, fwd.z, 0.26, strength);
        if (Math.random() < strength * 0.5) {
          this.dust.emit(wx, wy, wz, -fwd.x * speed * 0.08, -fwd.z * speed * 0.08, [0.62, 0.62, 0.64], 0.8);
        }
      } else {
        this.skids.reset(i);
      }

      // Staub und Grasfetzen neben der Strecke
      if (!onAsphalt && speed > 6 && Math.random() < Math.min(0.85, speed / 45)) {
        const color = w.surface === 'gravel' ? [0.72, 0.64, 0.48] : [0.42, 0.5, 0.28];
        this.dust.emit(wx, wy, wz, -fwd.x * speed * 0.12, -fwd.z * speed * 0.12, color, 1.15);
      }
    }
    this.dust.update(dt);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.game = new Game(document.body);
  } catch (err) {
    console.error(err);
    const boot = document.getElementById('boot');
    if (boot) {
      boot.innerHTML = `<div class="boot-error"><h2>Start fehlgeschlagen</h2><pre>${String(err && err.stack || err)}</pre></div>`;
    }
  }
});
