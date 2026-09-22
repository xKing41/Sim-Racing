/**
 * Spuren und Partikel.
 *
 * Beides laeuft ueber je einen festen Ringpuffer in einer einzigen Geometrie.
 * So entstehen keine neuen Objekte waehrend der Fahrt - das ist auf dem Handy
 * der Unterschied zwischen fluessig und ruckelig.
 */
import * as THREE from 'three';

const MARK_SEGMENTS = 2200; // Ringpuffer fuer Bremsspuren

export class SkidMarks {
  constructor(scene, wheelCount = 4) {
    this.capacity = MARK_SEGMENTS;
    this.positions = new Float32Array(this.capacity * 6 * 3);
    this.alphas = new Float32Array(this.capacity * 6);
    this.cursor = 0;
    this.lastPoint = new Array(wheelCount).fill(null);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setDrawRange(0, 0);
    this.geometry = geo;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          gl_FragColor = vec4(0.05, 0.05, 0.06, vAlpha * 0.55);
        }`,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.used = 0;
  }

  /** Fuegt fuer ein Rad ein Spursegment hinzu. */
  add(wheelIndex, x, y, z, dirX, dirZ, width, strength) {
    const prev = this.lastPoint[wheelIndex];
    const here = { x, y, z };
    if (!prev) {
      this.lastPoint[wheelIndex] = here;
      return;
    }
    const dx = x - prev.x;
    const dz = z - prev.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) return;
    this.lastPoint[wheelIndex] = here;

    const nx = dirZ * (width / 2);
    const nz = -dirX * (width / 2);

    const i = this.cursor % this.capacity;
    const p = i * 18;
    const a = i * 6;
    const lift = 0.016;

    const set = (o, px, py, pz) => {
      this.positions[p + o] = px;
      this.positions[p + o + 1] = py + lift;
      this.positions[p + o + 2] = pz;
    };
    set(0, prev.x - nx, prev.y, prev.z - nz);
    set(3, prev.x + nx, prev.y, prev.z + nz);
    set(6, x + nx, y, z + nz);
    set(9, prev.x - nx, prev.y, prev.z - nz);
    set(12, x + nx, y, z + nz);
    set(15, x - nx, y, z - nz);

    for (let k = 0; k < 6; k++) this.alphas[a + k] = strength;

    this.cursor++;
    this.used = Math.min(this.capacity, this.cursor);
    this.geometry.setDrawRange(0, this.used * 6);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  reset(wheelIndex) {
    this.lastPoint[wheelIndex] = null;
  }

  clear() {
    this.cursor = 0;
    this.used = 0;
    this.alphas.fill(0);
    this.geometry.setDrawRange(0, 0);
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.lastPoint.fill(null);
  }
}

const PARTICLE_COUNT = 260;

export class DustParticles {
  constructor(scene) {
    this.count = PARTICLE_COUNT;
    this.positions = new Float32Array(this.count * 3);
    this.sizes = new Float32Array(this.count);
    this.alphas = new Float32Array(this.count);
    this.colors = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geometry = geo;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vAlpha = aAlpha;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = length(d);
          if (r > 0.5 || vAlpha <= 0.002) discard;
          float fade = smoothstep(0.5, 0.05, r);
          gl_FragColor = vec4(vColor, vAlpha * fade * 0.5);
        }`,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vz, color, size = 1) {
    const i = this.cursor % this.count;
    this.cursor++;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y + 0.1;
    this.positions[i * 3 + 2] = z;
    this.velocities[i * 3] = vx + (Math.random() - 0.5) * 1.6;
    this.velocities[i * 3 + 1] = 0.7 + Math.random() * 1.3;
    this.velocities[i * 3 + 2] = vz + (Math.random() - 0.5) * 1.6;
    this.sizes[i] = size * (1.6 + Math.random() * 2.2);
    this.alphas[i] = 0.75;
    this.life[i] = 0.9 + Math.random() * 0.7;
    this.colors[i * 3] = color[0];
    this.colors[i * 3 + 1] = color[1];
    this.colors[i * 3 + 2] = color[2];
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i]);
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      this.velocities[i * 3] *= 1 - dt * 1.6;
      this.velocities[i * 3 + 2] *= 1 - dt * 1.6;
      this.velocities[i * 3 + 1] -= dt * 0.9;
      this.sizes[i] += dt * 2.4;
      this.alphas[i] = Math.max(0, t * 0.6);
    }
    if (any) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aColor.needsUpdate = true;
    }
  }

  clear() {
    this.life.fill(0);
    this.alphas.fill(0);
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
