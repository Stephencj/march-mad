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
  const wallLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, d.wallHeight, halfL * 2 + 2),
    wallMat,
  );
  wallLeft.position.set(-halfW - 1, d.wallHeight / 2, 0);
  group.add(wallLeft);
  const wallRight = wallLeft.clone();
  wallRight.position.x = halfW + 1;
  group.add(wallRight);

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

  // Bleachers — stepped box seats along both sidelines
  const bleacherMat = new THREE.MeshStandardMaterial({ color: 0x5c3e1d, roughness: 0.9 });
  const buildBleachers = (zCenter: number, flip: number) => {
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const bench = new THREE.Mesh(
        new THREE.BoxGeometry(halfW * 2 - 1, 0.35, 0.8),
        bleacherMat,
      );
      bench.position.set(0, 0.35 / 2 + r * 0.4, zCenter + flip * (0.8 * r + 0.4));
      group.add(bench);
    }
  };
  buildBleachers(-halfL + 0.5, -1); // left sideline outside
  buildBleachers(halfL - 0.5, 1);

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

  // Walls — beige-gray cinderblock
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xaea89b, roughness: 0.95 });
  const walls = [
    { geo: new THREE.BoxGeometry(halfW * 2 + 2, d.wallHeight, 0.2), pos: [0, d.wallHeight / 2, -halfL - 1] },
    { geo: new THREE.BoxGeometry(halfW * 2 + 2, d.wallHeight, 0.2), pos: [0, d.wallHeight / 2,  halfL + 1] },
    { geo: new THREE.BoxGeometry(0.2, d.wallHeight, halfL * 2 + 2), pos: [-halfW - 1, d.wallHeight / 2, 0] },
    { geo: new THREE.BoxGeometry(0.2, d.wallHeight, halfL * 2 + 2), pos: [ halfW + 1, d.wallHeight / 2, 0] },
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

  // Folding chairs — single row along each sideline
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
  const buildChairs = (zLine: number) => {
    for (let x = -halfW + 1.5; x < halfW - 0.5; x += 1.2) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), chairMat);
      seat.position.set(x, 0.5, zLine);
      group.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.05), chairMat);
      back.position.set(x, 0.8, zLine + Math.sign(zLine) * 0.22);
      group.add(back);
      // Legs — skip, save geometry
    }
  };
  buildChairs(-halfL + 1);
  buildChairs(halfL - 1);

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
  const fences = [
    { geo: new THREE.BoxGeometry(halfW * 2 + 2, fenceH, 0.05), pos: [0, fenceH / 2, -halfL - 0.5] },
    { geo: new THREE.BoxGeometry(halfW * 2 + 2, fenceH, 0.05), pos: [0, fenceH / 2,  halfL + 0.5] },
    { geo: new THREE.BoxGeometry(0.05, fenceH, halfL * 2 + 2), pos: [-halfW - 0.5, fenceH / 2, 0] },
    { geo: new THREE.BoxGeometry(0.05, fenceH, halfL * 2 + 2), pos: [ halfW + 0.5, fenceH / 2, 0] },
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
  placeTable(-halfW - 4, halfL + 2);
  placeTable( halfW + 4, halfL + 2);

  return group;
}
