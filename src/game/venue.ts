/**
 * Venue scenery — the stage the court sits on. The court geometry itself
 * lives in full-court.ts (lines, hoops, paint); the venue adds everything
 * AROUND it: walls, ceiling, crowd, props, skybox.
 *
 * Three venues to pick from (or randomize):
 *   - 'gym'  : high-school gym on a Saturday (polished wood, banners,
 *              pull-out bleachers, fluorescent ceiling)
 *   - 'rec'  : rec-center / YMCA (cinderblock walls, folding chairs,
 *              utilitarian fluorescents, volleyball lines bleeding through)
 *   - 'park' : suburban park / outdoor court (chain-link fence, lawn
 *              chairs, trees, open sky)
 */
import * as THREE from 'three';
import { levelConfig } from '@/dev/level-config';

export type VenueId = 'gym' | 'rec' | 'park';

export const VENUE_IDS: VenueId[] = ['gym', 'rec', 'park'];

export function venueLabel(id: VenueId): string {
  switch (id) {
    case 'gym': return 'High School Gym';
    case 'rec': return 'Rec Center';
    case 'park': return 'Suburban Park';
  }
}

export function randomVenue(): VenueId {
  return VENUE_IDS[Math.floor(Math.random() * VENUE_IDS.length)];
}

/**
 * Build the scenery for a given venue. Returns a THREE.Group that the
 * caller adds to the scene. Does NOT include the court lines / hoops —
 * those come from createFullCourt().
 */
export function createVenue(venueId: VenueId): THREE.Group {
  switch (venueId) {
    case 'gym': return buildGym();
    case 'rec': return buildRecCenter();
    case 'park': return buildPark();
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

/** Dimensions derived from the live level-config so venues scale with the court. */
function stageDims() {
  return {
    courtW: levelConfig.court.width,
    courtL: levelConfig.court.length,
    wallOffset: 3, // distance from court edge to interior wall
    wallHeight: 10,
  };
}

/**
 * Crowd archetypes — low-poly seated figures. Each is a head + torso + legs
 * + simple arms (upper + forearm per side). Keeps the triangle count
 * manageable while giving enough anatomy for mood poses to read.
 *
 * Mood is picked inline from the seed so callers don't need to know:
 *   (seed * 7919) % 100   <  10  → 'head-in-hands' (~10%)
 *                         < 13   → 'sleeping' old guy (~3%, forced to 'dad')
 *                         else   → 'normal'
 * 7919 is a prime chosen to decorrelate mood from the other seed uses
 * (hair/shirt/skin at %5/6, type at %53, y-rotation at %37).
 */
type CrowdType = 'dad' | 'wife' | 'kid';
type CrowdMood = 'normal' | 'head-in-hands' | 'sleeping';

function pickMood(seed: number): CrowdMood {
  const roll = (seed * 7919) % 100;
  if (roll < 10) return 'head-in-hands';
  if (roll < 13) return 'sleeping';
  return 'normal';
}

function createCrowdPerson(typeIn: CrowdType, seed: number): THREE.Group {
  const g = new THREE.Group();

  // Mood drives pose AND (for 'sleeping') forces archetype to 'dad' so we
  // can render an elderly figure with gray hair.
  const mood = pickMood(seed);
  const type: CrowdType = mood === 'sleeping' ? 'dad' : typeIn;

  // Pseudo-random per-seed color choice so the crowd doesn't look cloned.
  // Sleeping old guy overrides hair to gray/white regardless of seed.
  const hairPalette = [0x3a2a1a, 0x5a4030, 0x1a1a1a, 0x806050, 0xc8b8a8, 0xe8d8c8];
  const hair = mood === 'sleeping'
    ? (seed % 2 === 0 ? 0xdadada : 0xb0b0b0) // white or silver
    : hairPalette[seed % 6];
  const shirtPalette =
    type === 'dad' ? [0x3c5a8a, 0x8a3c3c, 0x4a5a6a, 0x6a5a4a, 0x2a5a2a] :
    type === 'wife' ? [0xa86ba8, 0x6a8aaa, 0xc86a8a, 0x8aaa6a, 0xcaa86a] :
    /* kid */ [0xff8c00, 0x00a8ff, 0xff4466, 0x66cc44, 0xffc500];
  const shirt = shirtPalette[seed % shirtPalette.length];
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });

  const skinColor = [0xd4956a, 0xc68642, 0x8d5524, 0xf1c27d, 0xe0ac69][seed % 5];
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor });

  // Size by type
  const s = type === 'kid' ? 0.7 : 1.0;
  const torsoW = (type === 'dad' ? 0.5 : type === 'wife' ? 0.38 : 0.32) * s;
  const torsoH = 0.6 * s;
  const torsoD = (type === 'dad' ? 0.36 : 0.22) * s;

  // Torso (seated). For moods that slump (head-in-hands, sleeping) we tilt
  // the torso forward/back a touch so the silhouette reads at a distance.
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(torsoW, torsoH, torsoD),
    shirtMat,
  );
  torso.position.y = 0.55 * s;
  if (mood === 'head-in-hands') {
    torso.rotation.x = 0.18; // shirt sags forward
    torso.position.z += 0.03 * s;
  } else if (mood === 'sleeping') {
    torso.rotation.x = -0.12; // leaning back
  }
  g.add(torso);

  // Head — pivot is at neck so rotating around X tilts the face.
  const headPivot = new THREE.Group();
  headPivot.position.y = 0.82 * s;
  g.add(headPivot);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18 * s, 8, 6),
    skinMat,
  );
  head.position.y = 0.13 * s;
  headPivot.add(head);

  if (mood === 'head-in-hands') {
    headPivot.rotation.x = 0.6; // tilt face-down into hands
  } else if (mood === 'sleeping') {
    headPivot.rotation.x = -0.5; // tilt back (nodded off)
  }

  // Hair — big afro if wife, small mat if dad (only 50% chance because
  // middle-aged guys are bald-weighted), bright stub for kid. Sleeping
  // old guy always gets a cap of gray hair regardless of the 50/50.
  const hairMat = new THREE.MeshStandardMaterial({ color: hair });
  if (type === 'wife') {
    const mane = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 8, 6), hairMat);
    mane.position.y = 0.14 * s;
    mane.scale.set(1, 0.9, 1.15);
    headPivot.add(mane);
  } else if (mood === 'sleeping' || type === 'kid' || (type === 'dad' && seed % 2 === 0)) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26 * s, 0.1 * s, 0.2 * s), hairMat);
    cap.position.y = 0.2 * s;
    headPivot.add(cap);
  }

  // Legs (knees bent — seated): two boxes angled forward
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.9 });
  const legGeo = new THREE.BoxGeometry(0.12 * s, 0.35 * s, 0.12 * s);
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.1 * s, 0.27 * s, 0.15 * s);
  legL.rotation.x = -0.6; // knees forward
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.1 * s;
  g.add(legR);

  // Arms — one pivot per side at the shoulder, upper arm hanging down from
  // it, with a forearm pivoted at the elbow. Rotating the shoulder pivot
  // around X swings the arm forward/up; the elbow bend stays relative.
  const armLen = 0.28 * s;
  const armThick = 0.09 * s;
  const shoulderY = (0.55 + torsoH / 2 - 0.06) * s; // just inside the torso top
  const shoulderX = (torsoW / 2 + armThick / 2 - 0.02);
  const armGeo = new THREE.BoxGeometry(armThick, armLen, armThick);

  const makeArm = (side: 1 | -1): THREE.Group => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * shoulderX, shoulderY, 0);

    // Upper arm — origin at shoulder, hanging down by default
    const upper = new THREE.Mesh(armGeo, shirtMat);
    upper.position.y = -armLen / 2;
    shoulder.add(upper);

    // Elbow pivot at the bottom of the upper arm
    const elbow = new THREE.Group();
    elbow.position.y = -armLen;
    shoulder.add(elbow);

    const forearm = new THREE.Mesh(armGeo, skinMat);
    forearm.position.y = -armLen / 2;
    elbow.add(forearm);

    // Default pose: arms at sides with a touch of outward tilt
    shoulder.rotation.z = side * 0.08;
    elbow.rotation.x = -0.2; // slight forward bend

    if (mood === 'head-in-hands') {
      // Upper arms swing up and slightly inward, elbows bend hard so the
      // forearms come back toward the face. Rotation around X is positive
      // -> the arm (which hangs -Y) swings toward +Z (forward).
      shoulder.rotation.x = 1.9;
      shoulder.rotation.z = side * 0.35; // elbows out, hands in
      elbow.rotation.x = -2.2; // tight fold so hand reaches face
    } else if (mood === 'sleeping') {
      // Arms cross on the lap — shoulders swing forward ~90 deg, elbows
      // bend inward so forearms meet at the belly/lap.
      shoulder.rotation.x = 1.4;
      shoulder.rotation.z = side * 0.55; // elbows out at ribs
      elbow.rotation.x = -1.2;
    }

    return shoulder;
  };

  g.add(makeArm(1));
  g.add(makeArm(-1));

  // Dads get a beer can in their right "hand" — skip when in head-in-hands
  // (both hands busy) or sleeping (dropped it somewhere).
  if (type === 'dad' && mood === 'normal') {
    const beer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.7, roughness: 0.35 }),
    );
    beer.position.set(0.25 * s, 0.55 * s, 0.12 * s);
    g.add(beer);
  }

  // Slight random y-rotation so a packed crowd doesn't look identical
  g.rotation.y = ((seed * 37) % 100) / 100 * 0.6 - 0.3;
  return g;
}

/**
 * Fill a rectangle of seat slots with a distribution of dads/wives/kids.
 * Returns the crowd group for the caller to add to the venue.
 */
function fillCrowd(startX: number, z: number, count: number, spacing: number, yBase: number, seedOffset = 0): THREE.Group {
  const crowd = new THREE.Group();
  crowd.name = 'crowd-row';
  for (let i = 0; i < count; i++) {
    const seed = seedOffset + i;
    // 50% dads, 30% wives, 20% kids
    const r = ((seed * 53) % 100) / 100;
    const type: CrowdType = r < 0.5 ? 'dad' : r < 0.8 ? 'wife' : 'kid';
    const person = createCrowdPerson(type, seed);
    person.position.set(startX + i * spacing, yBase, z);
    crowd.add(person);
  }
  return crowd;
}

// ============================================================================
// GYM — polished wood, bleachers, banners, fluorescents
// ============================================================================

function buildGym(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'venue-gym';
  const d = stageDims();
  const halfW = d.courtW / 2 + d.wallOffset;
  const halfL = d.courtL / 2 + d.wallOffset;

  // Walls — painted cinderblock in a school-mascot tone (maroon)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x7a1f2c, roughness: 0.85 });
  const wallBack = new THREE.Mesh(
    new THREE.BoxGeometry(halfW * 2 + 2, d.wallHeight, 0.2),
    wallMat,
  );
  wallBack.position.set(0, d.wallHeight / 2, -halfL - 1);
  group.add(wallBack);
  const wallFront = wallBack.clone();
  wallFront.position.z = halfL + 1;
  group.add(wallFront);
  // Only far-side sidewall (negative X). Camera-side wall removed so the
  // camera (at +X ≈ 6-12) has a clean view into the court.
  const wallLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, d.wallHeight, halfL * 2 + 2),
    wallMat,
  );
  wallLeft.position.set(-halfW - 1, d.wallHeight / 2, 0);
  group.add(wallLeft);

  // Ceiling — soft gray drop-tile with fluorescents
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.95 });
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(halfW * 2 + 2, halfL * 2 + 2),
    ceilingMat,
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = d.wallHeight;
  group.add(ceiling);

  // Fluorescent fixtures (glowing rectangles)
  const fluorMat = new THREE.MeshStandardMaterial({
    color: 0xf8f8ee, emissive: 0xf8f8ee, emissiveIntensity: 0.9,
  });
  for (let x = -halfW + 3; x < halfW; x += 6) {
    for (let z = -halfL + 4; z < halfL; z += 7) {
      const fx = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.1, 0.5),
        fluorMat,
      );
      fx.position.set(x, d.wallHeight - 0.1, z);
      group.add(fx);
    }
  }

  // Banners on the back wall — faded, "1987 SECTIONAL FINALIST" vibe
  const bannerPalette = [0xb8a862, 0xa09060, 0x8c7e56]; // faded golds
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: bannerPalette[i % bannerPalette.length],
      roughness: 0.9,
    });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 0.05), mat);
    const xSpan = halfW * 1.6;
    banner.position.set(-xSpan / 2 + (i * xSpan) / 4, d.wallHeight - 1.2, -halfL - 0.85);
    group.add(banner);
  }

  // Bleachers — stepped box seats along the FAR sideline only (negative X).
  // Rows step AWAY from the court (each row deeper into -X, slightly higher).
  // Length runs along Z so spectators face +X (toward the court / camera).
  const bleacherMat = new THREE.MeshStandardMaterial({ color: 0x5c3e1d, roughness: 0.9 });
  const bleacherRows = 5;
  const bleacherRowDepth = 0.9;
  const bleacherStepH = 0.4;
  const bleacherLen = 26;     // spans Z ≈ [-13, +13]
  const bleacherInnerX = -8.5; // front edge of row 0 (court side)
  for (let r = 0; r < bleacherRows; r++) {
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(bleacherRowDepth, 0.35, bleacherLen),
      bleacherMat,
    );
    // Each successive row shifts into -X and upward
    const x = bleacherInnerX - bleacherRowDepth / 2 - r * bleacherRowDepth;
    const y = 0.35 / 2 + r * bleacherStepH;
    bench.position.set(x, y, 0);
    group.add(bench);
  }

  // Crowd on the far-side bleachers — fill 3 rows facing +X. Reduced from
  // 20 per row to 13 (~35% fewer total figures), spacing scaled up to match.
  // 3 rows × 13 = 39 figures.
  const crowdPerRow = 13;
  const crowdSpacing = bleacherLen / crowdPerRow; // ~2.0
  for (let row = 0; row < 3; row++) {
    const x = bleacherInnerX - bleacherRowDepth / 2 - row * bleacherRowDepth;
    const yBase = 0.35 / 2 + row * bleacherStepH + 0.35; // bench top + shin height
    const zStart = -bleacherLen / 2 + crowdSpacing / 2;
    const rowGroup = new THREE.Group();
    rowGroup.name = 'crowd-row';
    for (let i = 0; i < crowdPerRow; i++) {
      const seed = row * 37 + i;
      const r = ((seed * 53) % 100) / 100;
      const type: CrowdType = r < 0.5 ? 'dad' : r < 0.8 ? 'wife' : 'kid';
      const person = createCrowdPerson(type, seed);
      person.position.set(x, yBase, zStart + i * crowdSpacing);
      // Face +X (toward the court / camera). createCrowdPerson applies a
      // small random y-rotation; we add +PI/2 so the default -Z facing
      // becomes +X facing.
      person.rotation.y += Math.PI / 2;
      rowGroup.add(person);
    }
    group.add(rowGroup);
  }

  return group;
}

// ============================================================================
// REC CENTER — cinderblock, folding chairs, utilitarian
// ============================================================================

function buildRecCenter(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'venue-rec';
  const d = stageDims();
  const halfW = d.courtW / 2 + d.wallOffset;
  const halfL = d.courtL / 2 + d.wallOffset;

  // Walls — beige-gray cinderblock. Camera-side (+X) wall omitted so the
  // play-cam has an unobstructed view in.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xaea89b, roughness: 0.95 });
  const walls = [
    { geo: new THREE.BoxGeometry(halfW * 2 + 2, d.wallHeight, 0.2), pos: [0, d.wallHeight / 2, -halfL - 1] },
    { geo: new THREE.BoxGeometry(halfW * 2 + 2, d.wallHeight, 0.2), pos: [0, d.wallHeight / 2,  halfL + 1] },
    { geo: new THREE.BoxGeometry(0.2, d.wallHeight, halfL * 2 + 2), pos: [-halfW - 1, d.wallHeight / 2, 0] },
  ];
  for (const w of walls) {
    const m = new THREE.Mesh(w.geo, wallMat);
    m.position.set(w.pos[0], w.pos[1], w.pos[2]);
    group.add(m);
  }

  // Ceiling — lower, off-white
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(halfW * 2 + 2, halfL * 2 + 2),
    new THREE.MeshStandardMaterial({ color: 0xd4cfbf, roughness: 0.95 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = d.wallHeight;
  group.add(ceiling);

  // Fluorescents — fewer than the gym, longer strips
  const fluorMat = new THREE.MeshStandardMaterial({
    color: 0xfefdf0, emissive: 0xfefdf0, emissiveIntensity: 0.85,
  });
  for (let x = -halfW + 4; x < halfW; x += 8) {
    const fx = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.4), fluorMat);
    fx.position.set(x, d.wallHeight - 0.08, 0);
    group.add(fx);
  }

  // Single CITY PARKS & REC banner on the back wall
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(8, 1.6, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x134f2c, roughness: 0.9 }),
  );
  banner.position.set(0, d.wallHeight - 2, -halfL - 0.85);
  group.add(banner);

  // Folding chairs — single row along the FAR sideline (negative X) only.
  // Chairs face +X (toward the court), so the seat-back sits on the -X side.
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
  const chairLineX = -8.5;
  const chairZStart = -halfL + 1.5;
  const chairZEnd = halfL - 0.5;
  // Spaced out from 1.2 → 2.3 so a row of ~32 units carries ~14 chairs
  // instead of ~26 (cuts crowd ~45%).
  const chairSpacing = 2.3;
  for (let z = chairZStart; z < chairZEnd; z += chairSpacing) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), chairMat);
    seat.position.set(chairLineX, 0.5, z);
    group.add(seat);
    // Back is on the far-X side of the seat so the chair faces +X
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.5), chairMat);
    back.position.set(chairLineX - 0.22, 0.8, z);
    group.add(back);
    // Legs — skip, save geometry
  }

  // Crowd on the folding chairs — one per chair, all along the far sideline,
  // rotated to face +X (toward the court).
  const chairCount = Math.floor((chairZEnd - chairZStart) / chairSpacing);
  const rowGroup = new THREE.Group();
  rowGroup.name = 'crowd-row';
  for (let i = 0; i < chairCount; i++) {
    const seed = i;
    const r = ((seed * 53) % 100) / 100;
    const type: CrowdType = r < 0.5 ? 'dad' : r < 0.8 ? 'wife' : 'kid';
    const person = createCrowdPerson(type, seed);
    person.position.set(chairLineX, 0.55, chairZStart + i * chairSpacing);
    person.rotation.y += Math.PI / 2; // face +X
    rowGroup.add(person);
  }
  group.add(rowGroup);

  return group;
}

// ============================================================================
// PARK — outdoor asphalt court, chain-link, trees, open sky
// ============================================================================

function buildPark(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'venue-park';
  const d = stageDims();
  const halfW = d.courtW / 2 + d.wallOffset;
  const halfL = d.courtL / 2 + d.wallOffset;

  // NO walls, NO ceiling — open sky. Add distant ground and trees instead.

  // Grass surround (green plane beyond the asphalt court)
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.95 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.01;
  group.add(grass);

  // Chain-link fence (visualized as a thin dark box perimeter)
  const fenceMat = new THREE.MeshStandardMaterial({
    color: 0x333333, transparent: true, opacity: 0.55, roughness: 0.8,
  });
  const fenceH = 3;
  // Three sides only — camera-side (+X) fence omitted so the play-cam has
  // a clean view in. Park still reads as fenced from far-side / behind-hoop.
  const fences = [
    { geo: new THREE.BoxGeometry(halfW * 2 + 2, fenceH, 0.05), pos: [0, fenceH / 2, -halfL - 0.5] },
    { geo: new THREE.BoxGeometry(halfW * 2 + 2, fenceH, 0.05), pos: [0, fenceH / 2,  halfL + 0.5] },
    { geo: new THREE.BoxGeometry(0.05, fenceH, halfL * 2 + 2), pos: [-halfW - 0.5, fenceH / 2, 0] },
  ];
  for (const f of fences) {
    const m = new THREE.Mesh(f.geo, fenceMat);
    m.position.set(f.pos[0], f.pos[1], f.pos[2]);
    group.add(m);
  }

  // Trees — simple cone + trunk around the edges
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d5a1a, roughness: 0.9 });
  const placeTree = (x: number, z: number) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.5, 8), trunkMat);
    trunk.position.set(x, 1.25, z);
    group.add(trunk);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(2, 4.5, 8), leafMat);
    leaves.position.set(x, 4.5, z);
    group.add(leaves);
  };
  const treePositions = [
    [-halfW - 6,  halfL + 3], [-halfW - 7, -halfL - 2], [-halfW - 4, -halfL - 6],
    [ halfW + 6, -halfL - 3], [ halfW + 4,  halfL + 6], [ halfW + 7,  halfL - 2],
    [-halfW - 5,  halfL + 8], [ halfW + 5,  halfL + 8],
    [-halfW - 8,  0],         [ halfW + 8,  0],
  ];
  for (const [x, z] of treePositions) placeTree(x, z);

  // Picnic tables — two on the non-court side
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.9 });
  const placeTable = (x: number, z: number) => {
    const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 1), tableMat);
    top.position.set(x, 0.75, z);
    group.add(top);
    const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 1), tableMat);
    leg1.position.set(x - 0.9, 0.38, z);
    group.add(leg1);
    const leg2 = leg1.clone();
    leg2.position.x = x + 0.9;
    group.add(leg2);
  };
  // Two picnic tables, both on the far (-X) side — one behind each hoop.
  placeTable(-halfW - 4,  halfL + 2);
  placeTable(-halfW - 4, -halfL - 2);

  // Crowd at the park — leaners/standers along the far sideline (negative X),
  // rotated to face +X. A few more seated at the picnic tables.
  const leanX = -halfW - 1.5;
  // Dropped from 6 → 3 leaners; combined with 2+2 picnic seats this gives 7
  // total park-goers (was 10).
  const leanCount = 3;
  const leanSpacing = 4.0;
  const leanZStart = -((leanCount - 1) * leanSpacing) / 2;
  const leaners = new THREE.Group();
  leaners.name = 'crowd-row';
  for (let i = 0; i < leanCount; i++) {
    const seed = 200 + i;
    const r = ((seed * 53) % 100) / 100;
    const type: CrowdType = r < 0.5 ? 'dad' : r < 0.8 ? 'wife' : 'kid';
    const person = createCrowdPerson(type, seed);
    person.position.set(leanX, 0.3, leanZStart + i * leanSpacing);
    person.rotation.y += Math.PI / 2; // face +X toward the court
    leaners.add(person);
  }
  group.add(leaners);

  // Seated at each (far-side) picnic table
  group.add(fillCrowd(-halfW - 5,  halfL + 2, 2, 1.0, 0.75, 220));
  group.add(fillCrowd(-halfW - 5, -halfL - 2, 2, 1.0, 0.75, 230));

  return group;
}
