/**
 * Baut die sichtbare Strecke: Fahrbahn, Randlinien, Curbs, Start-Ziel-Linie,
 * Gelaende und Leitplanken.
 *
 * Alles wird in wenige grosse BufferGeometries zusammengefasst, damit pro Bild
 * nur eine Handvoll Zeichenaufrufe noetig ist - das entscheidet auf dem Handy
 * ueber die Bildrate.
 */
import * as THREE from 'three';
import {
  makeAsphaltTexture,
  makeGrassTexture,
  makeGravelTexture,
  makeKerbTexture,
  makeStartLineTexture,
} from './textures.js';

const ROAD_LIFT = 0.012; // damit Linien nicht mit der Fahrbahn flimmern

/** Normale zur rechten Seite - identisch zu track.js, sonst passen Netz
 *  und Physik nicht zusammen und Curbs liegen auf der falschen Seite. */
function normalAt(p) {
  return { x: -p.dirZ, z: p.dirX };
}

/** Punkt auf der Fahrbahn bei seitlichem Versatz. */
function edge(p, offset) {
  const n = normalAt(p);
  return {
    x: p.x + n.x * offset,
    y: p.elevation + p.banking * offset,
    z: p.z + n.z * offset,
  };
}

/**
 * Baendermesh entlang der Strecke.
 * @param {object[]} points Mittellinie
 * @param {(p:object,i:number)=>({inner:number,outer:number}|null)} widthFn
 *        liefert pro Stuetzpunkt den inneren und aeusseren Versatz, oder null
 *        wenn an dieser Stelle nichts gezeichnet werden soll.
 */
function buildRibbon(points, widthFn, uvScale, lift) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const n = points.length;
  let vertexCount = 0;
  let runStart = -1;
  let runLength = 0;

  const flushRun = () => {
    runStart = -1;
    runLength = 0;
  };

  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const p = points[idx];
    const w = widthFn(p, idx);

    if (!w) {
      flushRun();
      continue;
    }

    const a = edge(p, w.inner);
    const b = edge(p, w.outer);
    positions.push(a.x, a.y + lift, a.z, b.x, b.y + lift, b.z);
    const v = p.s * uvScale.v;
    uvs.push(0, v, 1, v);

    if (runStart >= 0) {
      const base = vertexCount;
      // Zwei Dreiecke zum vorherigen Querschnitt. Die Reihenfolge bestimmt,
      // wohin die Normale zeigt - falsch herum wird die Flaeche von oben
      // weggeschnitten und ist unsichtbar.
      indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
    } else {
      runStart = vertexCount;
    }
    vertexCount += 2;
    runLength++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Fahrbahn mit korrekt skalierter Asphalttextur (Meter statt Streckenanteil). */
function buildRoad(track) {
  const points = track.points;
  const positions = [];
  const uvs = [];
  const indices = [];
  const n = points.length;
  const TEX_METERS = 6; // Kantenlaenge der Asphalttextur in Metern

  for (let i = 0; i <= n; i++) {
    const p = points[i % n];
    const hw = p.width / 2;
    const l = edge(p, -hw);
    const r = edge(p, hw);
    positions.push(l.x, l.y, l.z, r.x, r.y, r.z);
    const v = p.s / TEX_METERS;
    uvs.push(0, v, p.width / TEX_METERS, v);
    if (i > 0) {
      const b = i * 2;
      indices.push(b - 2, b - 1, b, b - 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Gelaende als Gitter, dessen Hoehe der Strecke folgt. */
function buildTerrain(track, quality) {
  const cell = quality === 'low' ? 14 : 9;
  const margin = 190;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of track.points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;

  const nx = Math.ceil((maxX - minX) / cell) + 1;
  const nz = Math.ceil((maxZ - minZ) / cell) + 1;

  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const indices = [];

  const grassA = new THREE.Color(0x4e6f36);
  const grassB = new THREE.Color(0x3d5a2b);
  const sand = new THREE.Color(0x9d8c68);
  const tmp = new THREE.Color();

  let hint = -1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cell;
      const z = minZ + j * cell;
      const k = j * nx + i;

      const q = track.sample(x, z, hint);
      hint = q.index;
      const absLat = Math.abs(q.lateral);
      const half = q.width / 2;

      let y;
      const runoffEnd = half + track.kerbWidth + track.runoffWidth;
      if (absLat < runoffEnd) {
        y = q.height;
      } else {
        // (weiter unten wird das Gelaende unter dem Belag abgesenkt)
        // Ausserhalb des Auslaufs sanft in eine huegelige Landschaft uebergehen
        const t = Math.min(1, (absLat - runoffEnd) / 120);
        const hills =
          Math.sin(x * 0.0042) * Math.cos(z * 0.0037) * 11 +
          Math.sin(x * 0.011 + 1.7) * Math.cos(z * 0.009) * 4;
        y = q.height * (1 - t) + (q.height + hills) * t - t * 1.5;
      }

      // Unter Fahrbahn und Curb muss das Gelaende tiefer liegen, sonst decken
      // sich beide Flaechen exakt und das Gelaende verdeckt den Belag. Nach
      // aussen laeuft der Absatz auf die realistische Asphaltkante aus.
      const paved = half + track.kerbWidth;
      const drop =
        absLat < paved
          ? 0.08 + 0.3 * (1 - absLat / paved)
          : 0.08 * Math.max(0, 1 - (absLat - paved) / 3);
      y -= drop;

      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      uvs[k * 2] = x / 22;
      uvs[k * 2 + 1] = z / 22;

      // Kiesbett direkt neben der Strecke, dahinter Gras
      const gravelEnd = half + track.kerbWidth + track.runoffWidth * 0.55;
      let mix;
      if (absLat < gravelEnd) mix = 1;
      else mix = Math.max(0, 1 - (absLat - gravelEnd) / 16);
      tmp.copy(Math.sin(x * 0.07) * Math.cos(z * 0.06) > 0 ? grassA : grassB).lerp(sand, mix);
      colors[k * 3] = tmp.r;
      colors[k * 3 + 1] = tmp.g;
      colors[k * 3 + 2] = tmp.b;
    }
  }

  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Leitplanke als senkrechtes Band mit Ober- und Unterkante. */
function buildBarrier(track, side) {
  const points = track.points;
  const n = points.length;
  const positions = [];
  const colors = [];
  const indices = [];
  const height = 1.05;
  const c1 = new THREE.Color(0xb9bdc4);
  const c2 = new THREE.Color(0x6d7178);

  for (let i = 0; i <= n; i++) {
    const p = points[i % n];
    const dist = (p.width / 2 + track.kerbWidth + track.runoffWidth + track.wallSetback) * side;
    const base = edge(p, dist);
    // Sockel etwas tiefer ansetzen, damit keine Luecke zum Gelaende entsteht
    positions.push(base.x, base.y - 0.45, base.z, base.x, base.y + height, base.z);
    const stripe = Math.floor(p.s / 4) % 2 === 0 ? c1 : c2;
    colors.push(stripe.r * 0.75, stripe.g * 0.75, stripe.b * 0.75, stripe.r, stripe.g, stripe.b);
    if (i > 0) {
      const b = i * 2;
      indices.push(b - 2, b - 1, b, b - 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildTrackMesh(track, quality = 'high') {
  const group = new THREE.Group();
  group.name = 'track';

  // --- Fahrbahn -----------------------------------------------------------
  const asphalt = makeAsphaltTexture(quality === 'low' ? 256 : 512);
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphalt,
    roughness: 0.94,
    metalness: 0.0,
    // Zusaetzliche Absicherung gegen Flimmern an der Gelaendekante
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const road = new THREE.Mesh(buildRoad(track), roadMat);
  road.receiveShadow = quality !== 'low';
  road.renderOrder = 1;
  group.add(road);

  // --- Randlinien ---------------------------------------------------------
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf0f0ec,
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  for (const side of [-1, 1]) {
    const geo = buildRibbon(
      track.points,
      (p) => {
        const hw = p.width / 2;
        return side < 0
          ? { inner: -hw + 0.02, outer: -hw + 0.17 }
          : { inner: hw - 0.17, outer: hw - 0.02 };
      },
      { v: 1 },
      ROAD_LIFT
    );
    group.add(new THREE.Mesh(geo, lineMat));
  }

  // --- Curbs --------------------------------------------------------------
  const kerbTex = makeKerbTexture();
  kerbTex.repeat.set(1, 1);
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.7 });
  for (const side of [-1, 1]) {
    const geo = buildRibbon(
      track.points,
      (p) => {
        const has = side < 0 ? p.kerbLeft : p.kerbRight;
        if (!has) return null;
        const hw = p.width / 2;
        return side < 0
          ? { inner: -hw - track.kerbWidth, outer: -hw }
          : { inner: hw, outer: hw + track.kerbWidth };
      },
      { v: 1 / 1.5 }, // Streifenlaenge 1,5 m
      ROAD_LIFT + 0.03
    );
    const mesh = new THREE.Mesh(geo, kerbMat);
    mesh.receiveShadow = quality === 'high';
    group.add(mesh);
  }

  // --- Start-Ziel-Linie ---------------------------------------------------
  {
    const startTex = makeStartLineTexture();
    startTex.repeat.set(1, 1);
    const n = track.points.length;
    const i0 = track.startIndex;
    const positions = [];
    const uvs = [];
    const indices = [];
    const depth = 3; // Punkte = 6 m
    for (let k = 0; k <= depth; k++) {
      const p = track.points[(i0 + k) % n];
      const hw = p.width / 2;
      const l = edge(p, -hw);
      const r = edge(p, hw);
      positions.push(l.x, l.y + ROAD_LIFT + 0.004, l.z, r.x, r.y + ROAD_LIFT + 0.004, r.z);
      const v = k / depth;
      uvs.push(0, v, 1, v);
      if (k > 0) {
        const b = k * 2;
        indices.push(b - 2, b - 1, b, b - 1, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.85 })));
  }

  // --- Gelaende -----------------------------------------------------------
  {
    const grass = makeGrassTexture(quality === 'low' ? 128 : 256);
    grass.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: grass,
      vertexColors: true,
      roughness: 1.0,
      metalness: 0,
    });
    const terrain = new THREE.Mesh(buildTerrain(track, quality), mat);
    terrain.receiveShadow = quality === 'high';
    terrain.renderOrder = 0;
    group.add(terrain);
  }

  // --- Leitplanken --------------------------------------------------------
  {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.65,
      side: THREE.DoubleSide,
    });
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(buildBarrier(track, side), mat);
      mesh.castShadow = quality === 'high';
      group.add(mesh);
    }
  }

  return group;
}

export { edge, normalAt, buildRibbon };
