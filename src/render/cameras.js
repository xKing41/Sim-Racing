/**
 * Kamerafuehrung.
 *
 * Drei Perspektiven: Cockpit, Motorhaube und Verfolgerkamera. Alle bekommen
 * etwas Nachlauf und reagieren auf Querbeschleunigung - ohne diese kleinen
 * Bewegungen wirkt Tempo im Bild viel langsamer, als es sich anfuehlen soll.
 */
import * as THREE from 'three';

export const CAMERA_MODES = ['cockpit', 'haube', 'verfolger', 'fern'];

export const CAMERA_LABELS = {
  cockpit: 'Cockpit',
  haube: 'Motorhaube',
  verfolger: 'Verfolger',
  fern: 'Aussenkamera',
};

const up = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'cockpit';
    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.initialised = false;

    this.shakeSeed = Math.random() * 100;
    this.lateralLag = 0;
    this.pitchLag = 0;
    this.fovBase = 62;
  }

  setMode(mode) {
    if (!CAMERA_MODES.includes(mode)) return;
    this.mode = mode;
    this.initialised = false;
  }

  cycle() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  /**
   * @param {number} dt
   * @param {import('../physics/vehicle.js').Vehicle} v
   */
  update(dt, v) {
    const fwd = v.forwardVector();
    const right = v.rightVector();
    const speed = v.speed;

    // Traege Reaktion auf Querkraft: der Kopf bleibt kurz zurueck
    const lagTau = 0.16;
    const k = 1 - Math.exp(-dt / lagTau);
    this.lateralLag += (v.accelLat / 9.81 - this.lateralLag) * k;
    this.pitchLag += (v.accelLong / 9.81 - this.pitchLag) * k;

    let target = new THREE.Vector3();
    let look = new THREE.Vector3();
    let fov = this.fovBase;
    let smoothing = 1;

    if (this.mode === 'cockpit') {
      const eye = { x: -0.30, y: 1.02, z: 0.28 };
      target.set(
        v.position.x + right.x * eye.x + fwd.x * eye.z,
        v.position.y + eye.y,
        v.position.z + right.z * eye.x + fwd.z * eye.z
      );
      // Blick leicht in die Kurve
      const lead = 14;
      const sideGlance = -this.lateralLag * 2.4;
      look.set(
        target.x + fwd.x * lead + right.x * sideGlance,
        target.y - 0.9 + this.pitchLag * 0.9,
        target.z + fwd.z * lead + right.z * sideGlance
      );
      fov = 68 + Math.min(14, speed * 0.18);
      smoothing = 1; // starr mit dem Auto verbunden
    } else if (this.mode === 'haube') {
      target.set(
        v.position.x + fwd.x * 0.5,
        v.position.y + 1.32,
        v.position.z + fwd.z * 0.5
      );
      const lead = 16;
      look.set(
        target.x + fwd.x * lead - right.x * this.lateralLag * 2.0,
        target.y - 1.0,
        target.z + fwd.z * lead - right.z * this.lateralLag * 2.0
      );
      fov = 66 + Math.min(14, speed * 0.2);
      smoothing = 1;
    } else if (this.mode === 'verfolger') {
      const dist = 7.2 + Math.min(2.4, speed * 0.035);
      const height = 2.55 + Math.min(0.7, speed * 0.012);
      target.set(
        v.position.x - fwd.x * dist + right.x * this.lateralLag * 0.7,
        v.position.y + height,
        v.position.z - fwd.z * dist + right.z * this.lateralLag * 0.7
      );
      look.set(
        v.position.x + fwd.x * 8,
        v.position.y + 0.95,
        v.position.z + fwd.z * 8
      );
      fov = 60 + Math.min(16, speed * 0.24);
      smoothing = 1 - Math.exp(-dt / 0.13);
    } else {
      // Weit hinten, tiefer - gut fuer Wiederholungen und zum Einparken
      const dist = 11 + Math.min(4, speed * 0.05);
      target.set(
        v.position.x - fwd.x * dist,
        v.position.y + 3.6,
        v.position.z - fwd.z * dist
      );
      look.set(v.position.x, v.position.y + 0.8, v.position.z);
      fov = 55;
      smoothing = 1 - Math.exp(-dt / 0.3);
    }

    if (!this.initialised) {
      this.position.copy(target);
      this.lookAt.copy(look);
      this.initialised = true;
    } else {
      this.position.lerp(target, smoothing);
      this.lookAt.lerp(look, this.mode === 'cockpit' || this.mode === 'haube' ? 1 : smoothing);
    }

    // Ruetteln nach Untergrund und Tempo
    let shake = 0;
    if (this.mode === 'cockpit' || this.mode === 'haube') {
      const rumble = Math.max(...v.wheels.map((w) => (w.surface === 'asphalt' ? 0 : w.rumble)));
      shake = rumble * Math.min(1, speed / 25) * 0.035;
      if (!v.onGround) shake *= 0.3;
    }
    const t = performance.now() * 0.001;
    const sx = shake * Math.sin(t * 41 + this.shakeSeed) ;
    const sy = shake * Math.sin(t * 57 + this.shakeSeed * 1.7);

    this.camera.position.copy(this.position);
    this.camera.position.x += sx;
    this.camera.position.y += sy;
    this.camera.up.copy(up);
    this.camera.lookAt(this.lookAt);

    // Waelzbewegung des Aufbaus leicht mitnehmen
    if (this.mode === 'cockpit' || this.mode === 'haube') {
      this.camera.rotateZ(v.rollAngle * 0.55 + this.lateralLag * 0.012);
    }

    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
  }
}
