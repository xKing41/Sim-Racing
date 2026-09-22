/**
 * Fahrzeugmodell.
 *
 * Die Karosserie wird aus Querschnitten geloftet: jeder Schnitt beschreibt die
 * Silhouette an einer Stelle der Laengsachse, dazwischen wird gespannt. So
 * entsteht eine echte GT-Form statt einer Ansammlung von Kaesten.
 *
 * Fahrzeugsystem: +Z = vorne, +X = rechts, +Y = oben.
 */
import * as THREE from 'three';
import { makeSignTexture } from './textures.js';

/** Halbprofil eines Querschnitts -> geschlossener Linienzug mit 16 Punkten. */
function sectionOutline(s) {
  const right = [
    [0, s.floorY],
    [s.floorHalf * 0.7, s.floorY],
    [s.floorHalf, s.floorY + 0.02],
    [s.halfWidth, s.floorY + (s.shoulderY - s.floorY) * 0.4],
    [s.halfWidth, s.shoulderY],
    [s.halfWidth * 0.94, s.shoulderY + (s.roofY - s.shoulderY) * 0.38],
    [s.roofHalf, s.roofY],
    [s.roofHalf * 0.5, s.roofY + 0.012],
    [0, s.roofY + 0.018],
  ];
  const loop = right.map(([x, y]) => [x, y]);
  for (let i = right.length - 2; i >= 1; i--) {
    loop.push([-right[i][0], right[i][1]]);
  }
  return loop; // 16 Punkte
}

/**
 * Querschnitte eines GT-Coupes, von hinten nach vorne.
 *
 * Zwei Details machen die Form aus:
 *  - An den Achsen wird der Karosserieboden (floorY) angehoben. Das ist das
 *    Radhaus; ohne den Ausschnitt verschwindet der Reifen in der Karosserie.
 *  - Vorne liegt die Haube (roofY) TIEFER als die Kotfluegelkante (shoulderY).
 *    Genau dieser Versatz ergibt die typische GT-Silhouette mit den hohen
 *    Kotfluegeln links und rechts der abfallenden Haube.
 */
const BODY_SECTIONS = [
  { z: -2.28, halfWidth: 0.80, floorHalf: 0.64, floorY: 0.24, shoulderY: 0.60, roofHalf: 0.64, roofY: 0.72 },
  { z: -2.15, halfWidth: 0.95, floorHalf: 0.76, floorY: 0.20, shoulderY: 0.72, roofHalf: 0.80, roofY: 0.78 },
  { z: -1.95, halfWidth: 1.02, floorHalf: 0.80, floorY: 0.16, shoulderY: 0.80, roofHalf: 0.86, roofY: 0.82 },
  { z: -1.65, halfWidth: 1.05, floorHalf: 0.74, floorY: 0.34, shoulderY: 0.84, roofHalf: 0.86, roofY: 0.84 },
  { z: -1.27, halfWidth: 1.06, floorHalf: 0.72, floorY: 0.44, shoulderY: 0.86, roofHalf: 0.82, roofY: 0.86 },
  { z: -1.05, halfWidth: 1.03, floorHalf: 0.76, floorY: 0.32, shoulderY: 0.84, roofHalf: 0.74, roofY: 0.92 },
  { z: -0.75, halfWidth: 1.00, floorHalf: 0.82, floorY: 0.15, shoulderY: 0.84, roofHalf: 0.62, roofY: 1.16 },
  { z: -0.35, halfWidth: 0.99, floorHalf: 0.84, floorY: 0.13, shoulderY: 0.84, roofHalf: 0.64, roofY: 1.22 },
  { z: 0.15, halfWidth: 0.99, floorHalf: 0.84, floorY: 0.13, shoulderY: 0.84, roofHalf: 0.63, roofY: 1.21 },
  { z: 0.42, halfWidth: 1.00, floorHalf: 0.84, floorY: 0.13, shoulderY: 0.84, roofHalf: 0.66, roofY: 1.06 },
  { z: 0.80, halfWidth: 1.02, floorHalf: 0.82, floorY: 0.14, shoulderY: 0.82, roofHalf: 0.72, roofY: 0.80 },
  { z: 1.05, halfWidth: 1.04, floorHalf: 0.76, floorY: 0.30, shoulderY: 0.80, roofHalf: 0.58, roofY: 0.70 },
  { z: 1.378, halfWidth: 1.06, floorHalf: 0.72, floorY: 0.44, shoulderY: 0.78, roofHalf: 0.54, roofY: 0.66 },
  { z: 1.70, halfWidth: 1.05, floorHalf: 0.74, floorY: 0.32, shoulderY: 0.74, roofHalf: 0.52, roofY: 0.62 },
  { z: 1.98, halfWidth: 1.00, floorHalf: 0.78, floorY: 0.14, shoulderY: 0.62, roofHalf: 0.54, roofY: 0.52 },
  { z: 2.20, halfWidth: 0.90, floorHalf: 0.70, floorY: 0.13, shoulderY: 0.48, roofHalf: 0.56, roofY: 0.44 },
  { z: 2.34, halfWidth: 0.66, floorHalf: 0.50, floorY: 0.17, shoulderY: 0.34, roofHalf: 0.46, roofY: 0.38 },
];

function buildBodyGeometry() {
  const outlines = BODY_SECTIONS.map((s) => sectionOutline(s));
  const ring = outlines[0].length;
  const positions = [];
  const indices = [];

  for (let i = 0; i < BODY_SECTIONS.length; i++) {
    const z = BODY_SECTIONS[i].z;
    for (const [x, y] of outlines[i]) positions.push(x, y, z);
  }
  for (let i = 0; i < BODY_SECTIONS.length - 1; i++) {
    const a = i * ring;
    const b = (i + 1) * ring;
    for (let k = 0; k < ring; k++) {
      const k2 = (k + 1) % ring;
      // Reihenfolge so, dass die Normalen nach aussen zeigen. Andersherum
      // waere die Karosserie innen-aussen und man saehe durch das Dach.
      indices.push(a + k, a + k2, b + k);
      indices.push(a + k2, b + k2, b + k);
    }
  }
  // Vorder- und Rueckseite schliessen
  const capFan = (offset, reverse) => {
    const centerIndex = positions.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < ring; k++) {
      cx += positions[(offset + k) * 3];
      cy += positions[(offset + k) * 3 + 1];
      cz += positions[(offset + k) * 3 + 2];
    }
    positions.push(cx / ring, cy / ring, cz / ring);
    for (let k = 0; k < ring; k++) {
      const k2 = (k + 1) % ring;
      if (reverse) indices.push(centerIndex, offset + k2, offset + k);
      else indices.push(centerIndex, offset + k, offset + k2);
    }
  };
  capFan(0, false);
  capFan((BODY_SECTIONS.length - 1) * ring, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Scheiben als eigene, leicht eingerueckte Flaechen. */
function buildGlass() {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x101418,
    transparent: true,
    opacity: 0.52,
    roughness: 0.08,
    metalness: 0,
    transmission: 0,
    side: THREE.DoubleSide,
  });

  const quad = (pts) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  };

  // Frontscheibe
  group.add(quad([
    [-0.78, 0.83, 0.84], [0.78, 0.83, 0.84], [0.62, 1.20, 0.22], [-0.62, 1.20, 0.22],
  ]));
  // Heckscheibe
  group.add(quad([
    [-0.62, 1.21, -0.38], [0.62, 1.21, -0.38], [0.80, 0.86, -1.00], [-0.80, 0.86, -1.00],
  ]));
  // Seitenscheiben
  for (const s of [-1, 1]) {
    group.add(quad([
      [s * 0.82, 0.85, 0.64], [s * 0.65, 1.19, 0.22], [s * 0.64, 1.20, -0.36], [s * 0.84, 0.86, -0.62],
    ]));
  }
  return group;
}

function buildWheel(radius, width, rimColor) {
  const group = new THREE.Group();

  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 26, 1),
    new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92, metalness: 0 })
  );
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  group.add(tyre);

  // Reifenschulter etwas abgesetzt
  const shoulder = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.995, radius * 0.995, width * 1.02, 26, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.75 })
  );
  shoulder.rotation.z = Math.PI / 2;
  group.add(shoulder);

  const rimMat = new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.32, metalness: 0.85 });
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.63, radius * 0.63, width * 0.9, 22),
    rimMat
  );
  rim.rotation.z = Math.PI / 2;
  group.add(rim);

  // Speichen: je Radseite ein Stern aus flachen Streben
  const spokeGeo = new THREE.BoxGeometry(0.045, radius * 0.56, 0.05);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.position.set(
        side * width * 0.40,
        Math.sin(angle) * radius * 0.30,
        Math.cos(angle) * radius * 0.30
      );
      spoke.rotation.set(-angle, 0, 0);
      group.add(spoke);
    }
  }

  // Bremsscheibe und Sattel
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, 0.032, 20),
    new THREE.MeshStandardMaterial({ color: 0x35373c, roughness: 0.45, metalness: 0.7 })
  );
  disc.rotation.z = Math.PI / 2;
  group.add(disc);

  const caliper = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.13, 0.19),
    new THREE.MeshStandardMaterial({ color: 0xd8482c, roughness: 0.5, metalness: 0.3 })
  );
  caliper.position.set(0, radius * 0.46, -0.03);
  group.add(caliper);

  return group;
}

/**
 * Baut das komplette Auto.
 * @param {{bodyColor?:number, accentColor?:number, number?:string, quality?:string}} opts
 */
export function buildCar(opts = {}) {
  const bodyColor = opts.bodyColor ?? 0x1d4fd8;
  const accentColor = opts.accentColor ?? 0xf5f5f5;
  const carNumber = opts.number ?? '41';
  const quality = opts.quality ?? 'high';

  const car = new THREE.Group();
  car.name = 'car';

  const shell = new THREE.Group();
  shell.name = 'shell'; // wird fuer Nick- und Waelzbewegung gedreht
  car.add(shell);

  // --- Karosserie ---------------------------------------------------------
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.34,
    metalness: 0.42,
  });
  const body = new THREE.Mesh(buildBodyGeometry(), bodyMat);
  body.castShadow = quality !== 'low';
  shell.add(body);

  shell.add(buildGlass());

  const darkMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.6, metalness: 0.2 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.35, metalness: 0.3 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.35, metalness: 0.55 });

  // --- Frontsplitter ------------------------------------------------------
  {
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.03, 0.46), carbonMat);
    splitter.position.set(0, 0.07, 2.20);
    splitter.castShadow = quality === 'high';
    shell.add(splitter);
    // Dive planes
    for (const s of [-1, 1]) {
      const plane = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.02, 0.16), carbonMat);
      plane.position.set(s * 0.86, 0.30, 2.09);
      plane.rotation.z = s * 0.14;
      shell.add(plane);
    }
  }

  // --- Heckfluegel --------------------------------------------------------
  {
    const wing = new THREE.Group();
    const plane = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.035, 0.34), carbonMat);
    plane.rotation.x = -0.16;
    plane.castShadow = quality === 'high';
    wing.add(plane);
    const gurney = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.045, 0.015), carbonMat);
    gurney.position.set(0, 0.04, -0.16);
    wing.add(gurney);
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.30, 0.46), accentMat);
      plate.position.set(s * 0.94, 0.02, 0);
      wing.add(plate);
      // Schwanenhals-Aufhaengung
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.30, 0.05), carbonMat);
      post.position.set(s * 0.42, -0.16, 0.06);
      wing.add(post);
    }
    wing.position.set(0, 1.06, -2.00);
    shell.add(wing);
  }

  // --- Diffusor -----------------------------------------------------------
  {
    const diff = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.04, 0.62), carbonMat);
    diff.position.set(0, 0.20, -2.10);
    diff.rotation.x = 0.28;
    shell.add(diff);
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.60), carbonMat);
      fin.position.set(i * 0.33, 0.24, -2.10);
      fin.rotation.x = 0.28;
      shell.add(fin);
    }
  }

  // --- Unterboden ---------------------------------------------------------
  // Schliesst die Karosserie zwischen den Radhaeusern nach unten ab.
  {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.04, 3.9), carbonMat);
    floor.position.set(0, 0.125, 0.05);
    shell.add(floor);
  }

  // --- Seitenschweller, Spiegel, Dachluke --------------------------------
  for (const s of [-1, 1]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 2.0), carbonMat);
    sill.position.set(s * 1.00, 0.17, 0.0);
    shell.add(sill);

    const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.03), darkMat);
    mirrorArm.position.set(s * 1.00, 0.88, 0.66);
    shell.add(mirrorArm);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.16), darkMat);
    mirror.position.set(s * 1.10, 0.89, 0.66);
    shell.add(mirror);
  }
  {
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.52), darkMat);
    scoop.position.set(0, 1.245, -0.05);
    shell.add(scoop);
  }

  // --- Leuchten -----------------------------------------------------------
  {
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xdfe8ff, emissive: 0x9fb4ff, emissiveIntensity: 0.55, roughness: 0.25,
    });
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0xd02a1e, emissive: 0xff2a18, emissiveIntensity: 0.9, roughness: 0.4,
    });
    for (const s of [-1, 1]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.06), headMat);
      head.position.set(s * 0.62, 0.50, 2.14);
      head.rotation.y = s * 0.12;
      shell.add(head);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.10, 0.05), tailMat);
      tail.position.set(s * 0.62, 0.76, -2.24);
      shell.add(tail);
    }
    const rain = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.04), tailMat);
    rain.position.set(0, 0.46, -2.26);
    shell.add(rain);
  }

  // --- Startnummern -------------------------------------------------------
  {
    const numTex = makeSignTexture(carNumber, '#f2f2f0', '#14161c', 256);
    const numMat = new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.5, transparent: false });
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.52), numMat);
      plate.position.set(s * 1.00, 0.56, -0.05);
      plate.rotation.y = s * Math.PI / 2;
      shell.add(plate);
    }
    const roofNum = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), numMat);
    roofNum.position.set(0, 1.235, -0.30);
    roofNum.rotation.x = -Math.PI / 2;
    shell.add(roofNum);
  }

  // --- Innenraum ----------------------------------------------------------
  const interior = new THREE.Group();
  {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.42), darkMat);
    dash.position.set(0, 0.80, 0.82);
    dash.rotation.x = -0.18;
    interior.add(dash);

    // Ueberrollkaefig
    const barMat = new THREE.MeshStandardMaterial({ color: 0xc23b2f, roughness: 0.45, metalness: 0.4 });
    const bar = (x1, y1, z1, x2, y2, z2, r = 0.032) => {
      const dir = new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1);
      const len = dir.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), barMat);
      m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      interior.add(m);
    };
    for (const s of [-1, 1]) {
      bar(s * 0.62, 0.30, -0.55, s * 0.62, 1.12, -0.48); // B-Saeule
      bar(s * 0.62, 1.12, -0.48, s * 0.58, 1.10, 0.35); // Dachlaengsholm
      bar(s * 0.58, 1.10, 0.35, s * 0.74, 0.80, 0.92); // A-Saeule
      bar(s * 0.62, 1.12, -0.48, s * 0.80, 0.42, -1.25); // Strebe nach hinten
    }
    bar(-0.62, 1.12, -0.48, 0.62, 1.12, -0.48); // Querstrebe Dach
    bar(-0.62, 0.70, -0.52, 0.62, 1.05, -0.50); // Diagonale

    // Sitz
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.50), darkMat);
    seat.position.set(-0.30, 0.42, -0.12);
    interior.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.72, 0.12), darkMat);
    back.position.set(-0.30, 0.74, -0.36);
    back.rotation.x = -0.14;
    interior.add(back);
  }
  shell.add(interior);

  // --- Lenkrad ------------------------------------------------------------
  const steeringWheel = new THREE.Group();
  {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.15, 0.022, 8, 24, Math.PI * 1.45),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.75 })
    );
    rim.rotation.z = Math.PI * 0.275;
    steeringWheel.add(rim);
    const hub = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.10, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.5 })
    );
    steeringWheel.add(hub);
    for (const s of [-1, 1]) {
      const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.13, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.9 })
      );
      grip.position.set(s * 0.14, 0.0, 0.01);
      steeringWheel.add(grip);
    }
    steeringWheel.position.set(-0.30, 0.74, 0.62);
    steeringWheel.rotation.x = -0.42;
  }
  shell.add(steeringWheel);

  // --- Raeder -------------------------------------------------------------
  const wheelMeta = [
    { name: 'FL', x: -0.84, z: 1.378, radius: 0.335, width: 0.30 },
    { name: 'FR', x: 0.84, z: 1.378, radius: 0.335, width: 0.30 },
    { name: 'RL', x: -0.82, z: -1.272, radius: 0.352, width: 0.34 },
    { name: 'RR', x: 0.82, z: -1.272, radius: 0.352, width: 0.34 },
  ];
  const wheels = {};
  for (const meta of wheelMeta) {
    const pivot = new THREE.Group(); // dreht sich beim Lenken
    pivot.position.set(meta.x, meta.radius, meta.z);
    const spin = new THREE.Group(); // dreht sich beim Rollen
    const mesh = buildWheel(meta.radius, meta.width, 0x9aa0a8);
    spin.add(mesh);
    pivot.add(spin);
    car.add(pivot);
    wheels[meta.name] = { pivot, spin, radius: meta.radius, meta };
  }

  return {
    root: car,
    shell,
    body,
    bodyMaterial: bodyMat,
    steeringWheel,
    wheels,
    interior,
    /** Farbe zur Laufzeit wechseln. */
    setColor(hex) {
      bodyMat.color.setHex(hex);
    },
  };
}

export { BODY_SECTIONS };
