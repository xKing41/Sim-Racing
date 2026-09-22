/**
 * Streckenumgebung: Zielbogen, Boxengebaeude, Tribuenen, Streckenposten,
 * Bremspunkttafeln und Baeume.
 *
 * Baeume und Tribuenenbesucher laufen ueber InstancedMesh - sonst waeren es
 * tausende Zeichenaufrufe und das Handy gibt auf.
 */
import * as THREE from 'three';
import { makeSignTexture, mulberry } from './textures.js';

function offsetPoint(p, lateral) {
  const nx = -p.dirZ;
  const nz = p.dirX;
  return new THREE.Vector3(
    p.x + nx * lateral,
    p.elevation + p.banking * Math.max(-p.width / 2, Math.min(p.width / 2, lateral)),
    p.z + nz * lateral
  );
}

function buildGantry(track) {
  const group = new THREE.Group();
  const p = track.points[track.startIndex];
  const half = p.width / 2 + 2.2;
  const steel = new THREE.MeshStandardMaterial({ color: 0x8e949c, roughness: 0.45, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.6 });

  for (const side of [-1, 1]) {
    const base = offsetPoint(p, side * half);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, 7.0, 0.42), steel);
    post.position.copy(base);
    post.position.y += 3.5;
    post.castShadow = true;
    group.add(post);
  }
  const left = offsetPoint(p, -half);
  const right = offsetPoint(p, half);
  const mid = left.clone().add(right).multiplyScalar(0.5);
  const span = left.distanceTo(right);

  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.5, 0.75), dark);
  beam.position.copy(mid);
  beam.position.y += 7.2;
  beam.rotation.y = -p.heading + Math.PI / 2;
  beam.castShadow = true;
  group.add(beam);

  const signTex = makeSignTexture('START', '#0f1116', '#f0f0ee', 256);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 0.42, 1.2),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 })
  );
  sign.position.copy(mid);
  sign.position.y += 7.2;
  sign.rotation.y = -p.heading + Math.PI;
  sign.position.x += Math.sin(p.heading) * 0.4;
  sign.position.z += Math.cos(p.heading) * 0.4;
  group.add(sign);

  // Startampel
  const lightBox = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.3), dark);
  lightBox.position.copy(mid);
  lightBox.position.y += 6.1;
  lightBox.rotation.y = -p.heading + Math.PI / 2;
  group.add(lightBox);

  return group;
}

function buildPitBuilding(track) {
  const group = new THREE.Group();
  const n = track.points.length;
  const wall = new THREE.MeshStandardMaterial({ color: 0xd8d9d5, roughness: 0.85 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x2b3946, roughness: 0.2, metalness: 0.4,
  });
  const roof = new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.75 });

  const boxCount = 9;
  const spacingPoints = 7; // ~14 m je Box
  for (let i = 0; i < boxCount; i++) {
    const idx = (track.startIndex - 26 + i * spacingPoints + n) % n;
    const p = track.points[idx];
    const lateral = -(p.width / 2 + 17);
    const base = offsetPoint(p, lateral);
    const yaw = -p.heading;

    const unit = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(13.0, 4.4, 9.0), wall);
    body.position.y = 2.2;
    body.castShadow = true;
    body.receiveShadow = true;
    unit.add(body);

    const window2 = new THREE.Mesh(new THREE.BoxGeometry(12.0, 1.5, 9.4), glass);
    window2.position.y = 5.7;
    unit.add(window2);

    const top = new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.45, 9.6), roof);
    top.position.y = 6.7;
    top.castShadow = true;
    unit.add(top);

    // Torklappe zur Strecke hin
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, 3.2, 0.2),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2f5fa8 : 0xb8402f, roughness: 0.6 })
    );
    door.position.set(0, 1.7, 4.55);
    unit.add(door);

    unit.position.copy(base);
    unit.rotation.y = yaw;
    group.add(unit);
  }
  return group;
}

function buildGrandstand(track, index, side, length = 8) {
  const group = new THREE.Group();
  const n = track.points.length;
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb8b6b0, roughness: 0.9 });
  const seatColors = [0x2f5fa8, 0xc23b2f, 0xe8b619];

  const rows = 9;
  for (let r = 0; r < rows; r++) {
    const idxStart = index % n;
    const p = track.points[idxStart];
    const lateral = side * (p.width / 2 + track.kerbWidth + track.runoffWidth + 7 + r * 1.25);
    const base = offsetPoint(p, lateral);
    const step = new THREE.Mesh(new THREE.BoxGeometry(length * 4.2, 0.9 + r * 0.05, 1.3), concrete);
    step.position.copy(base);
    step.position.y += 0.45 + r * 0.72;
    step.rotation.y = -p.heading + Math.PI / 2;
    step.receiveShadow = true;
    group.add(step);

    // Sitzreihe
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(length * 4.1, 0.34, 0.5),
      new THREE.MeshStandardMaterial({ color: seatColors[r % seatColors.length], roughness: 0.8 })
    );
    seat.position.copy(step.position);
    seat.position.y += (0.9 + r * 0.05) / 2 + 0.17;
    seat.rotation.y = step.rotation.y;
    group.add(seat);
  }

  // Dach
  const p = track.points[index % n];
  const lateral = side * (p.width / 2 + track.kerbWidth + track.runoffWidth + 13);
  const base = offsetPoint(p, lateral);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(length * 4.6, 0.3, 16),
    new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.7, metalness: 0.3 })
  );
  roof.position.copy(base);
  roof.position.y += 9.4;
  roof.rotation.y = -p.heading + Math.PI / 2;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

function buildMarkerBoards(track) {
  const group = new THREE.Group();
  const n = track.points.length;
  // Vor den engsten Kurven Bremspunkttafeln aufstellen
  const braking = [];
  for (let i = 0; i < n; i++) {
    const k = Math.abs(track.points[i].curvature);
    const kPrev = Math.abs(track.points[(i - 8 + n) % n].curvature);
    if (k > 1 / 90 && kPrev < 1 / 200) braking.push(i);
  }
  const used = [];
  for (const i of braking) {
    if (used.some((u) => Math.abs(u - i) < 40)) continue;
    used.push(i);
    for (const dist of [50, 100, 150]) {
      const idx = (i - Math.round(dist / track.step) + n * 2) % n;
      const p = track.points[idx];
      const side = p.curvature > 0 ? -1 : 1;
      const lateral = side * (p.width / 2 + track.kerbWidth + 3.2);
      const base = offsetPoint(p, lateral);
      const tex = makeSignTexture(String(dist), '#16181e', '#f5f5f0', 128);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 1.15),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65, side: THREE.DoubleSide })
      );
      board.position.copy(base);
      board.position.y += 1.5;
      board.rotation.y = -p.heading + Math.PI;
      group.add(board);

      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 1.5, 0.09),
        new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.8 })
      );
      post.position.copy(base);
      post.position.y += 0.75;
      group.add(post);
    }
  }
  return group;
}

function buildTrees(track, quality) {
  const target = quality === 'low' ? 220 : quality === 'medium' ? 520 : 900;
  const rand = mulberry(20260922);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of track.points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const pad = 170;
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.0, 6);
  trunkGeo.translate(0, 1.5, 0);
  const leafGeo = new THREE.ConeGeometry(2.3, 6.2, 7);
  leafGeo.translate(0, 5.6, 0);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5b2a, roughness: 0.95 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, target);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, target);
  trunks.castShadow = quality === 'high';
  leaves.castShadow = quality === 'high';

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scaleV = new THREE.Vector3();
  const posV = new THREE.Vector3();
  const color = new THREE.Color();

  const minClearance = track.runoffWidth + track.wallSetback + 26;
  let placed = 0;
  let attempts = 0;
  let hint = -1;
  while (placed < target && attempts < target * 45) {
    attempts++;
    const x = minX + rand() * (maxX - minX);
    const z = minZ + rand() * (maxZ - minZ);
    const s = track.sample(x, z, hint);
    hint = s.index;
    if (Math.abs(s.lateral) < s.width / 2 + minClearance) continue;

    const scale = 0.62 + rand() * 0.95;
    posV.set(x, s.height - 0.3, z);
    scaleV.set(scale, scale * (0.8 + rand() * 0.5), scale);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    m.compose(posV, q, scaleV);
    trunks.setMatrixAt(placed, m);
    leaves.setMatrixAt(placed, m);
    color.setHSL(0.26 + rand() * 0.06, 0.34 + rand() * 0.2, 0.19 + rand() * 0.12);
    leaves.setColorAt(placed, color);
    placed++;
  }
  trunks.count = placed;
  leaves.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.add(trunks, leaves);
  return group;
}

export function buildScenery(track, quality = 'medium') {
  const group = new THREE.Group();
  group.name = 'scenery';
  group.add(buildGantry(track));
  group.add(buildPitBuilding(track));
  group.add(buildMarkerBoards(track));
  group.add(buildTrees(track, quality));

  // Tribuenen an drei markanten Stellen
  const n = track.points.length;
  group.add(buildGrandstand(track, Math.round(n * 0.02), -1, 10));
  group.add(buildGrandstand(track, Math.round(n * 0.31), 1, 7));
  group.add(buildGrandstand(track, Math.round(n * 0.73), 1, 6));

  return group;
}
