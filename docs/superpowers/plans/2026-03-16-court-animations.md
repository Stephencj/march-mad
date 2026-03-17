# Court Redesign + Animation Polish — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the court as a stylized cartoon/toy full court with two oversized hoops, full markings, and plank-texture floor. Add squash-stretch, anticipation, and secondary motion to player animations. Update menus to offer Quick Play (3v3) vs Main Game (5v5).

**Architecture:** New `createFullCourt()` function alongside existing `createCourt()`. Full court is 28m with hoops at each end. Animation polish is added to the existing `animate()` method via state transition blending and scale oscillation. Position type and body scaling added to PlayerData/GamePlayer.

**Tech Stack:** Three.js (geometry, materials), existing game systems

**Spec:** `docs/superpowers/specs/2026-03-16-court-5v5-animations-design.md`

**Scope boundary:** This plan covers court visuals, position types, body scaling, and animation polish. The 5v5 gameplay (10 players, possession switching ends, AI behavior by position, 5v5 formations, camera full-court panning, defensive switching) is deferred to Plan 2.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/game/full-court.ts` | Full 28m court with two hoops, all markings, cartoon-style backboards/rims/nets, plank floor |
| `src/game/hoop.ts` | Reusable oversized cartoon hoop (backboard + rim + net + pole), used by both court files |

### Modified Files
| File | Changes |
|------|---------|
| `src/game/court.ts` | Refactor to use shared `createHoop()` from hoop.ts, update COURT_DIMENSIONS to include full-court variant |
| `src/core/types.ts` | Add `Position` type, add `position` field to `PlayerData` |
| `src/game/player.ts` | Add position-based body scaling in constructor, add squash-stretch + anticipation + secondary motion to `animate()` |
| `src/game/shot-detector.ts` | Support two hoops (take hoop position as parameter instead of hardcoding) |
| `src/ui/menus.ts` | Update main menu: "Quick Play" (3v3) and "Main Game" (5v5) buttons |
| `src/main.ts` | Wire Quick Play vs Main Game, use full court for 5v5 |

---

## Chunk 1: Cartoon Hoop + Full Court

### Task 1: Reusable Cartoon Hoop

**Files:**
- Create: `src/game/hoop.ts`
- Test: `tests/game/hoop.test.ts`

- [ ] **Step 1: Write hoop tests**

Create `tests/game/hoop.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createHoop } from '@/game/hoop';
import * as THREE from 'three';

describe('Cartoon Hoop', () => {
  it('creates a group with pole, backboard, rim, net, and frame', () => {
    const hoop = createHoop(new THREE.Vector3(0, 3.05, -13), 0xe94560);
    expect(hoop).toBeInstanceOf(THREE.Group);
    const names = hoop.children.map(c => c.name).filter(n => n);
    expect(names).toContain('pole');
    expect(names).toContain('backboard');
    expect(names).toContain('rim');
    expect(names).toContain('net');
  });

  it('positions rim at correct height', () => {
    const hoop = createHoop(new THREE.Vector3(0, 3.05, -13), 0xff0000);
    const rim = hoop.getObjectByName('rim')!;
    expect(rim.position.y).toBeCloseTo(3.05, 1);
  });

  it('has oversized rim radius', () => {
    const hoop = createHoop(new THREE.Vector3(0, 3.05, -13), 0xff0000);
    const rim = hoop.getObjectByName('rim')!;
    const geo = (rim as THREE.Mesh).geometry as THREE.TorusGeometry;
    expect(geo.parameters.radius).toBeCloseTo(0.35, 1);
  });

  it('backboard is 1.5x normal size', () => {
    const hoop = createHoop(new THREE.Vector3(0, 3.05, -13), 0xff0000);
    const bb = hoop.getObjectByName('backboard')!;
    const geo = (bb as THREE.Mesh).geometry as THREE.BoxGeometry;
    expect(geo.parameters.width).toBeCloseTo(2.7, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/game/hoop.test.ts`

- [ ] **Step 3: Implement cartoon hoop**

Create `src/game/hoop.ts`:
```typescript
import * as THREE from 'three';

export function createHoop(position: THREE.Vector3, teamColor: number): THREE.Group {
  const group = new THREE.Group();

  // Chunky pole
  const poleGeo = new THREE.CylinderGeometry(0.15, 0.18, position.y + 0.5, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: teamColor });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(position.x, (position.y + 0.5) / 2, position.z - 0.6);
  pole.name = 'pole';
  group.add(pole);

  // Wide base disc
  const baseGeo = new THREE.CylinderGeometry(0.6, 0.65, 0.1, 12);
  const base = new THREE.Mesh(baseGeo, poleMat);
  base.position.set(position.x, 0.05, position.z - 0.6);
  base.name = 'pole-base';
  group.add(base);

  // Oversized backboard (1.5x: 2.7 × 1.58)
  const bbGeo = new THREE.BoxGeometry(2.7, 1.58, 0.06);
  const bbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
  const backboard = new THREE.Mesh(bbGeo, bbMat);
  backboard.position.set(position.x, position.y + 0.45, position.z - 0.2);
  backboard.name = 'backboard';
  group.add(backboard);

  // Backboard frame (4 colored edges)
  const frameMat = new THREE.MeshStandardMaterial({ color: teamColor });
  const frameThick = 0.08;
  // Top
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(2.7 + frameThick * 2, frameThick, frameThick), frameMat);
  frameTop.position.set(position.x, position.y + 0.45 + 1.58 / 2, position.z - 0.2);
  frameTop.name = 'frame-top';
  group.add(frameTop);
  // Bottom
  const frameBot = frameTop.clone();
  frameBot.position.y = position.y + 0.45 - 1.58 / 2;
  frameBot.name = 'frame-bottom';
  group.add(frameBot);
  // Left
  const frameSide = new THREE.Mesh(new THREE.BoxGeometry(frameThick, 1.58, frameThick), frameMat);
  frameSide.position.set(position.x - 2.7 / 2, position.y + 0.45, position.z - 0.2);
  frameSide.name = 'frame-left';
  group.add(frameSide);
  // Right
  const frameRight = frameSide.clone();
  frameRight.position.x = position.x + 2.7 / 2;
  frameRight.name = 'frame-right';
  group.add(frameRight);

  // Oversized rim (radius 0.35)
  const rimGeo = new THREE.TorusGeometry(0.35, 0.04, 8, 16);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xff4500 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.copy(position);
  rim.name = 'rim';
  group.add(rim);

  // Net (inverted cone)
  const netGeo = new THREE.ConeGeometry(0.35, 0.45, 12, 1, true);
  const netMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.4,
    side: THREE.DoubleSide, wireframe: true,
  });
  const net = new THREE.Mesh(netGeo, netMat);
  net.position.set(position.x, position.y - 0.25, position.z);
  net.rotation.x = Math.PI; // flip cone upside down
  net.name = 'net';
  group.add(net);

  return group;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/game/hoop.test.ts` — All 4 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: add reusable oversized cartoon hoop with backboard frame and net"`

---

### Task 2: Full Court with Markings

**Files:**
- Create: `src/game/full-court.ts`
- Test: `tests/game/full-court.test.ts`

- [ ] **Step 1: Write full court tests**

Create `tests/game/full-court.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createFullCourt, FULL_COURT_DIMENSIONS } from '@/game/full-court';
import * as THREE from 'three';

describe('Full Court', () => {
  it('exports correct full-court dimensions', () => {
    expect(FULL_COURT_DIMENSIONS.width).toBe(15);
    expect(FULL_COURT_DIMENSIONS.length).toBe(28);
    expect(FULL_COURT_DIMENSIONS.hoopHome.z).toBeLessThan(0);
    expect(FULL_COURT_DIMENSIONS.hoopAway.z).toBeGreaterThan(0);
  });

  it('creates a group with floor, markings, and two hoops', () => {
    const court = createFullCourt(0xe94560, 0x3498db);
    expect(court).toBeInstanceOf(THREE.Group);
    const names: string[] = [];
    court.traverse(obj => { if (obj.name) names.push(obj.name); });
    expect(names).toContain('floor');
    expect(names).toContain('center-line');
    expect(names).toContain('center-circle');
    expect(names).toContain('hoop-home');
    expect(names).toContain('hoop-away');
    expect(names).toContain('three-point-arc-home');
    expect(names).toContain('three-point-arc-away');
    expect(names).toContain('paint-home');
    expect(names).toContain('paint-away');
  });

  it('has floor covering the full court area', () => {
    const court = createFullCourt(0xff0000, 0x0000ff);
    const floor = court.getObjectByName('floor')! as THREE.Mesh;
    const geo = floor.geometry as THREE.PlaneGeometry;
    expect(geo.parameters.width).toBe(15);
    expect(geo.parameters.height).toBe(28);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/game/full-court.test.ts`

- [ ] **Step 3: Implement full court**

Create `src/game/full-court.ts`:
```typescript
import * as THREE from 'three';
import { createHoop } from './hoop';

export const FULL_COURT_DIMENSIONS = {
  width: 15,
  length: 28,
  threePointRadius: 6.75,
  hoopHome: new THREE.Vector3(0, 3.05, -13),
  hoopAway: new THREE.Vector3(0, 3.05, 13),
  paintWidth: 3.6,
  paintLength: 5.8,
  centerCircleRadius: 1.8,
  checkBallLine: 5,
};

export function createFullCourt(homeColor: number, awayColor: number): THREE.Group {
  const group = new THREE.Group();
  const D = FULL_COURT_DIMENSIONS;
  const lineHeight = 0.02;
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });

  // ---- FLOOR ----
  const floorGeo = new THREE.PlaneGeometry(D.width, D.length);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xe8b960, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  group.add(floor);

  // Plank lines (subtle darker stripes every 0.5m)
  for (let x = -D.width / 2; x <= D.width / 2; x += 0.5) {
    const plankGeo = new THREE.BoxGeometry(0.01, 0.001, D.length);
    const plankMat = new THREE.MeshStandardMaterial({ color: 0xd4a84b });
    const plank = new THREE.Mesh(plankGeo, plankMat);
    plank.position.set(x, 0.001, 0);
    group.add(plank);
  }

  // ---- CENTER LINE ----
  const clGeo = new THREE.BoxGeometry(D.width, lineHeight, 0.08);
  const centerLine = new THREE.Mesh(clGeo, lineMat);
  centerLine.position.set(0, lineHeight / 2, 0);
  centerLine.name = 'center-line';
  group.add(centerLine);

  // ---- CENTER CIRCLE ----
  const ccPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const angle = (Math.PI * 2 * i) / 64;
    ccPoints.push(new THREE.Vector3(
      Math.cos(angle) * D.centerCircleRadius,
      lineHeight,
      Math.sin(angle) * D.centerCircleRadius
    ));
  }
  const ccGeo = new THREE.BufferGeometry().setFromPoints(ccPoints);
  const ccLine = new THREE.Line(ccGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
  ccLine.name = 'center-circle';
  group.add(ccLine);

  // ---- CENTER LOGO (colored circle) ----
  const logoGeo = new THREE.CircleGeometry(1.2, 24);
  const logoMat = new THREE.MeshStandardMaterial({ color: homeColor, transparent: true, opacity: 0.4 });
  const logo = new THREE.Mesh(logoGeo, logoMat);
  logo.rotation.x = -Math.PI / 2;
  logo.position.set(0, 0.003, 0);
  logo.name = 'center-logo';
  group.add(logo);

  // ---- SIDELINES & BASELINES ----
  const addLine = (name: string, x1: number, z1: number, x2: number, z2: number) => {
    const dx = x2 - x1; const dz = z2 - z1;
    const geo = new THREE.BoxGeometry(Math.abs(dx) || 0.08, lineHeight, Math.abs(dz) || 0.08);
    const line = new THREE.Mesh(geo, lineMat);
    line.position.set((x1 + x2) / 2, lineHeight / 2, (z1 + z2) / 2);
    line.name = name;
    group.add(line);
  };

  addLine('sideline-left', -D.width / 2, -D.length / 2, -D.width / 2, D.length / 2);
  addLine('sideline-right', D.width / 2, -D.length / 2, D.width / 2, D.length / 2);
  addLine('baseline-home', -D.width / 2, -D.length / 2, D.width / 2, -D.length / 2);
  addLine('baseline-away', -D.width / 2, D.length / 2, D.width / 2, D.length / 2);

  // ---- THREE-POINT ARCS + PAINT for each end ----
  const ends: { suffix: string; hoopZ: number; dir: number; color: number }[] = [
    { suffix: 'home', hoopZ: D.hoopHome.z, dir: 1, color: homeColor },
    { suffix: 'away', hoopZ: D.hoopAway.z, dir: -1, color: awayColor },
  ];

  for (const end of ends) {
    // Three-point arc
    const arcPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const angle = (Math.PI * i) / 32;
      arcPoints.push(new THREE.Vector3(
        Math.cos(angle) * D.threePointRadius,
        lineHeight,
        end.hoopZ + Math.sin(angle) * D.threePointRadius * end.dir
      ));
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
    arc.name = `three-point-arc-${end.suffix}`;
    group.add(arc);

    // Paint area
    const paintGeo = new THREE.PlaneGeometry(D.paintWidth, D.paintLength);
    const paintMat = new THREE.MeshStandardMaterial({
      color: end.color, transparent: true, opacity: 0.3,
    });
    const paint = new THREE.Mesh(paintGeo, paintMat);
    paint.rotation.x = -Math.PI / 2;
    paint.position.set(0, 0.005, end.hoopZ + (D.paintLength / 2) * end.dir);
    paint.name = `paint-${end.suffix}`;
    group.add(paint);

    // Free throw line
    const ftGeo = new THREE.BoxGeometry(D.paintWidth, lineHeight, 0.08);
    const ft = new THREE.Mesh(ftGeo, lineMat);
    ft.position.set(0, lineHeight / 2, end.hoopZ + D.paintLength * end.dir);
    ft.name = `free-throw-${end.suffix}`;
    group.add(ft);

    // Free throw circle
    const ftCirclePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (Math.PI * 2 * i) / 64;
      ftCirclePoints.push(new THREE.Vector3(
        Math.cos(angle) * D.centerCircleRadius,
        lineHeight,
        end.hoopZ + D.paintLength * end.dir + Math.sin(angle) * D.centerCircleRadius
      ));
    }
    const ftCircleGeo = new THREE.BufferGeometry().setFromPoints(ftCirclePoints);
    const ftCircle = new THREE.Line(ftCircleGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
    ftCircle.name = `free-throw-circle-${end.suffix}`;
    group.add(ftCircle);

    // Hoop
    const hoop = createHoop(
      new THREE.Vector3(0, D.hoopHome.y, end.hoopZ),
      end.color
    );
    hoop.name = `hoop-${end.suffix}`;
    group.add(hoop);
  }

  // ---- LIGHTING ----
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  ambient.name = 'ambient-light';
  group.add(ambient);
  const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
  mainLight.position.set(5, 20, 0);
  mainLight.name = 'main-light';
  group.add(mainLight);

  return group;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/game/full-court.test.ts` — All 3 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: add full 28m cartoon court with two hoops, markings, paint, plank floor"`

---

### Task 3: Update Half Court to Use Shared Hoop

**Files:**
- Modify: `src/game/court.ts`
- Test: `tests/game/court.test.ts` (verify existing tests still pass)

- [ ] **Step 1: Refactor court.ts** — Replace the inline backboard/hoop code with `createHoop()` from `./hoop`. Keep the same `COURT_DIMENSIONS` export. Add the hoop group to the court group.

- [ ] **Step 2: Update court tests** — The existing test checks for 'hoop' and 'backboard' as child names. Since they're now nested inside the hoop group, update to use `getObjectByName` (which searches recursively):
```typescript
it('creates a group with floor, lines, hoop, and backboard', () => {
  const court = createCourt();
  expect(court).toBeInstanceOf(THREE.Group);
  expect(court.getObjectByName('floor')).toBeTruthy();
  expect(court.getObjectByName('three-point-arc')).toBeTruthy();
  expect(court.getObjectByName('rim')).toBeTruthy();
  expect(court.getObjectByName('backboard')).toBeTruthy();
});
```

- [ ] **Step 3: Run tests** — `npx vitest run tests/game/court.test.ts` — All PASS
- [ ] **Step 4: Commit** — `git commit -m "refactor: half court now uses shared cartoon hoop component"`

---

## Chunk 2: Position Types + Body Scaling + Animation Polish

### Task 4: Add Position Type to Core Types

**Files:**
- Modify: `src/core/types.ts`
- Test: `tests/core/types.test.ts`

- [ ] **Step 1: Add Position type and update PlayerData**

Add to `src/core/types.ts`:
```typescript
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export const POSITION_STATS: Record<Position, PlayerStats> = {
  PG: { speed: 9, shooting: 7, defense: 5, passing: 8, dunkPower: 4 },
  SG: { speed: 7, shooting: 9, defense: 5, passing: 6, dunkPower: 5 },
  SF: { speed: 7, shooting: 7, defense: 7, passing: 6, dunkPower: 7 },
  PF: { speed: 5, shooting: 5, defense: 8, passing: 5, dunkPower: 8 },
  C:  { speed: 3, shooting: 3, defense: 9, passing: 4, dunkPower: 9 },
};

export const POSITION_SCALES: Record<Position, { height: number; body: number; head: number }> = {
  PG: { height: 0.85, body: 0.85, head: 1.0 },
  SG: { height: 0.95, body: 0.90, head: 1.0 },
  SF: { height: 1.0,  body: 1.0,  head: 1.05 },
  PF: { height: 1.1,  body: 1.15, head: 1.08 },
  C:  { height: 1.2,  body: 1.3,  head: 1.12 },
};
```

Add `position?: Position` to `PlayerData` interface (optional so existing 3v3 code still works without it).

- [ ] **Step 2: Add test**
```typescript
it('has position scales for all 5 positions', () => {
  expect(Object.keys(POSITION_SCALES)).toHaveLength(5);
  expect(POSITION_SCALES['C'].height).toBeGreaterThan(POSITION_SCALES['PG'].height);
});
```

- [ ] **Step 3: Run tests** — `npx vitest run tests/core/types.test.ts` — PASS
- [ ] **Step 4: Commit** — `git commit -m "feat: add Position type with stats and body scales for 5v5"`

---

### Task 5: Position-Based Body Scaling in Player

**Files:**
- Modify: `src/game/player.ts`
- Test: `tests/game/player.test.ts`

- [ ] **Step 1: Add scaling to constructor**

In the `GamePlayer` constructor, after creating the mesh, apply position-based scaling if `data.position` is set:
```typescript
import { POSITION_SCALES } from '@/core/types';

// In constructor, after this.group = this.createMesh(teamColor):
if (data.position) {
  const scales = POSITION_SCALES[data.position];
  this.group.scale.set(scales.body, scales.height, scales.body);
  // Extra head scaling for bigger bobblehead effect
  const head = this.group.getObjectByName('head');
  if (head) head.scale.multiplyScalar(scales.head);
}
```

- [ ] **Step 2: Add test**
```typescript
it('applies position scaling for Center', () => {
  const player = new GamePlayer({
    id: 'c1', name: 'Big Man', stats: createDefaultPlayerStats(),
    personality: 'Lockdown', isCustom: false, position: 'C',
  }, new THREE.Vector3(0, 0, 0), 0xff0000);
  expect(player.group.scale.y).toBeCloseTo(1.2, 1);
});
```

- [ ] **Step 3: Run tests** — `npx vitest run tests/game/player.test.ts` — PASS
- [ ] **Step 4: Commit** — `git commit -m "feat: apply position-based body scaling (PG small, C large)"`

---

### Task 6: Animation Polish — Squash-Stretch + Transitions

**Files:**
- Modify: `src/game/player.ts`

- [ ] **Step 1: Add squash-stretch to the bounce**

In the `animate()` method's `walk` and `dribble` cases, after computing `bouncePhase`, apply scale to body-pivot:

```typescript
// Squash-stretch on body-pivot (applies to entire upper body)
const squashStretch = bouncePhase; // 0 = ground, 1 = peak
bodyPivot.scale.set(
  1 + (1 - squashStretch) * 0.08,  // wider at ground
  1 - (1 - squashStretch) * 0.08 + squashStretch * 0.08, // shorter at ground, taller at peak
  1 + (1 - squashStretch) * 0.08   // wider at ground
);
```

Reset scale in idle: `bodyPivot.scale.set(1, 1, 1);`

- [ ] **Step 2: Add state transition blending + anticipation**

Add properties to GamePlayer:
```typescript
private prevAnimState: string = 'idle';
private stateTransitionTimer = 0;
private readonly STATE_BLEND_DURATION = 0.12;
private lastShoulderL = 0; // track arm positions for follow-through
private lastShoulderR = 0;
```

At the top of `animate()`, detect state changes:
```typescript
if (this.animState !== this.prevAnimState) {
  // Save arm positions for follow-through
  this.lastShoulderL = shoulderL.rotation.x;
  this.lastShoulderR = shoulderR.rotation.x;
  this.stateTransitionTimer = this.STATE_BLEND_DURATION;
  this.prevAnimState = this.animState;
}
if (this.stateTransitionTimer > 0) {
  this.stateTransitionTimer -= dt;
}
```

Add a smoothstep helper to the file:
```typescript
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}
```

After the main animation switch block, apply transition blending:
```typescript
// Blend from previous pose during state transitions
if (this.stateTransitionTimer > 0) {
  const blend = smoothstep(1 - this.stateTransitionTimer / this.STATE_BLEND_DURATION);
  // Arms follow-through: blend from last position to current
  shoulderL.rotation.x = this.lastShoulderL + (shoulderL.rotation.x - this.lastShoulderL) * blend;
  shoulderR.rotation.x = this.lastShoulderR + (shoulderR.rotation.x - this.lastShoulderR) * blend;
}
```

This creates smooth 0.12s transitions between all animation states — arms don't snap, they ease into the new pose. The "anticipation" effect comes naturally from the blend: walking starts with arms still in idle position and smoothly transitions to full swing.

- [ ] **Step 3: Add secondary motion — head lag, hair bounce, arm follow-through**

After the main animation switch block, add:
```typescript
// Secondary motion: head bobs with slight delay
const neckGroup = this.group.getObjectByName('neck-group');
if (neckGroup && isMoving) {
  neckGroup.rotation.x = -bodyPivot.rotation.x * 0.3; // counter-rotate slightly
}

// Hair bounce lag
const hair = this.group.getObjectByName('hair');
if (hair && isMoving) {
  const hairBounce = Math.sin(this.animTime * 4 - 0.3) * 0.05; // delayed from body
  hair.position.y += hairBounce;
}
```

- [ ] **Step 4: Run all tests** — `npx vitest run` — PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: add squash-stretch, state transition blending, head lag, hair bounce"`

---

## Chunk 3: Menu Update + Wiring

### Task 7: Update Menu with Quick Play vs Main Game

**Files:**
- Modify: `src/ui/menus.ts`

- [ ] **Step 1: Update main menu**

Replace the single "PLAY" button with two options:
- "QUICK PLAY" (action='quick-play') — smaller, secondary style — "3v3 Half Court"
- "MAIN GAME" (action='main-game') — larger, primary style — "5v5 Full Court"
- Keep "Settings" button

- [ ] **Step 2: Verify build** — `npx vite build` — exit 0
- [ ] **Step 3: Commit** — `git commit -m "feat: update menu with Quick Play (3v3) and Main Game (5v5) options"`

---

### Task 8: Wire Full Court into Main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update main.ts**

1. Import `createFullCourt` and `FULL_COURT_DIMENSIONS`
2. Update `handleMenuAction`:
   - `'quick-play'` → calls existing `startQuickGame()` (3v3 half court)
   - `'main-game'` → calls new `startMainGame()` (5v5 full court)
3. Add `startMainGame()` function:
   - Remove old court from scene, add full court
   - Generate teams with 5 players each (assign positions PG/SG/SF/PF/C)
   - Create GameSession with 5v5 config
   - Set clock to 300 seconds (5 minutes)
4. Track which court is active: `let currentCourt: THREE.Group`

Note: The 5v5 GameSession changes (10 players, two hoops, possession switching ends) will be implemented in Plan 2. For now, `startMainGame()` can use the existing 3v3 GameSession on one half of the full court as a stepping stone — the full court just visually renders.

Also update `moveByInput` court bounds in player.ts: make them configurable or use wider bounds (-14 to 14 for z on full court). Add a static `GamePlayer.courtBounds` property that defaults to half-court but can be set to full-court dimensions.

- [ ] **Step 2: Verify build** — `npx vite build` — exit 0
- [ ] **Step 3: Run all tests** — `npx vitest run` — PASS
- [ ] **Step 4: Commit** — `git commit -m "feat: wire full court and Quick Play vs Main Game menu flow"`

---

### Task 9: Update Shot Detector for Configurable Hoop

**Files:**
- Modify: `src/game/shot-detector.ts`
- Modify: `tests/game/shot-detector.test.ts`

- [ ] **Step 1: Make hoop position configurable**

Change `ShotDetector` to accept hoop position in constructor or `check()` method instead of hardcoding `COURT_DIMENSIONS.hoopPosition`:

```typescript
export class ShotDetector {
  private hoopPosition: THREE.Vector3;

  constructor(hoopPosition?: THREE.Vector3) {
    this.hoopPosition = hoopPosition ?? COURT_DIMENSIONS.hoopPosition;
  }

  setHoopPosition(pos: THREE.Vector3): void {
    this.hoopPosition = pos;
  }

  // Update check() and classifyShot() to use this.hoopPosition instead of COURT_DIMENSIONS.hoopPosition
}
```

- [ ] **Step 2: Update tests** — Verify existing tests still pass with default hoop position, add test with custom position.

- [ ] **Step 3: Commit** — `git commit -m "feat: shot detector supports configurable hoop position for full court"`

---
