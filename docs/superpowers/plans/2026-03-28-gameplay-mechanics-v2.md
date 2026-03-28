# Gameplay Mechanics V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix passing (direction-based, reliable, no dead-stop), limit shot range (12u max), rework dunk zone (paint-based, lower stamina), add controller-friendly menu navigation.

**Architecture:** Gameplay fixes are localized to `game-session.ts` and `ball.ts`. Menu navigation is a new independent `MenuNavigator` class wired into all UI screens.

**Tech Stack:** TypeScript, Three.js, Browser Gamepad API, Vitest

**Spec:** `docs/superpowers/specs/2026-03-28-gameplay-mechanics-v2-design.md`

---

### Task 1: Direction-Based Pass Target Selection

**Files:**
- Modify: `src/game/game-session.ts:1215-1227`
- Test: `tests/game/pass-targeting.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/game/pass-targeting.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { findBestPassTarget } from '@/game/pass-targeting';

describe('findBestPassTarget', () => {
  it('should prefer teammate in facing direction', () => {
    const passer = { x: 0, z: 0, facingAngle: 0 }; // facing +Z
    const teammates = [
      { id: 'behind', x: 0, z: -5 },  // behind
      { id: 'front', x: 0, z: 5 },    // in front
    ];
    const result = findBestPassTarget(passer, teammates);
    expect(result?.id).toBe('front');
  });

  it('should prefer closer teammate when direction is similar', () => {
    const passer = { x: 0, z: 0, facingAngle: 0 }; // facing +Z
    const teammates = [
      { id: 'close', x: 1, z: 3 },
      { id: 'far', x: 1, z: 15 },
    ];
    const result = findBestPassTarget(passer, teammates);
    expect(result?.id).toBe('close');
  });

  it('should still return a teammate even if all are behind', () => {
    const passer = { x: 0, z: 0, facingAngle: 0 }; // facing +Z
    const teammates = [
      { id: 'behind1', x: -2, z: -3 },
      { id: 'behind2', x: 2, z: -5 },
    ];
    const result = findBestPassTarget(passer, teammates);
    expect(result).not.toBeNull();
  });

  it('should return null with no teammates', () => {
    const passer = { x: 0, z: 0, facingAngle: 0 };
    const result = findBestPassTarget(passer, []);
    expect(result).toBeNull();
  });

  it('should handle diagonal facing correctly', () => {
    const passer = { x: 0, z: 0, facingAngle: Math.PI / 4 }; // facing +X,+Z diagonal
    const teammates = [
      { id: 'diagonal', x: 5, z: 5 },   // perfectly aligned
      { id: 'sideways', x: -5, z: 5 },   // off to the side
    ];
    const result = findBestPassTarget(passer, teammates);
    expect(result?.id).toBe('diagonal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/pass-targeting.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement findBestPassTarget**

Create `src/game/pass-targeting.ts`:

```typescript
interface PasserInfo {
  x: number;
  z: number;
  facingAngle: number; // rotation.y from player group
}

interface PassCandidate {
  id: string;
  x: number;
  z: number;
}

export function findBestPassTarget(
  passer: PasserInfo,
  teammates: PassCandidate[]
): PassCandidate | null {
  if (teammates.length === 0) return null;

  // Passer's facing direction from rotation.y
  const facingX = Math.sin(passer.facingAngle);
  const facingZ = Math.cos(passer.facingAngle);

  let best: PassCandidate | null = null;
  let bestScore = -Infinity;

  for (const tm of teammates) {
    const dx = tm.x - passer.x;
    const dz = tm.z - passer.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.01) continue; // skip if on top of passer

    // Direction alignment: dot product of facing and direction-to-teammate
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const dot = facingX * dirX + facingZ * dirZ;
    const alignment = Math.max(0, dot); // clamp negative to 0

    const distanceFactor = 1 / dist;
    const score = alignment * 0.7 + distanceFactor * 0.3;

    if (score > bestScore) {
      bestScore = score;
      best = tm;
    }
  }

  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game/pass-targeting.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into game-session.ts**

In `src/game/game-session.ts`, add import:
```typescript
import { findBestPassTarget } from './pass-targeting';
```

Replace `findNearestTeammate` usage in the `'pass'` gesture handler (~line 761):

```typescript
// OLD:
const teammate = this.findNearestTeammate(human);

// NEW:
const teammates = this.getTeammates(human);
const candidates = teammates.map(t => ({ id: t.data.id, x: t.position.x, z: t.position.z }));
const target = findBestPassTarget(
  { x: human.position.x, z: human.position.z, facingAngle: human.group.rotation.y },
  candidates
);
const teammate = target ? teammates.find(t => t.data.id === target.id) ?? null : null;
```

- [ ] **Step 6: Commit**

```bash
git add src/game/pass-targeting.ts tests/game/pass-targeting.test.ts src/game/game-session.ts
git commit -m "feat: direction-based pass targeting — prefer teammates in facing direction"
```

---

### Task 2: Fix Pass Ball Physics (No Dead Stop)

**Files:**
- Modify: `src/game/ball.ts:194-211`
- Modify: `src/game/game-session.ts:1134-1172` (checkBallPickup)
- Modify: `src/game/game-session.ts:375-392` (remove jump-catch)
- Test: `tests/game/ball.test.ts`

- [ ] **Step 1: Write failing test for pass-through behavior**

Create or add to `tests/game/ball.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Ball } from '@/game/ball';

describe('Ball pass physics', () => {
  it('should not zero velocity when reaching pass target', () => {
    const ball = new Ball(new THREE.Vector3(0, 1, 0));
    ball.passTo(new THREE.Vector3(5, 1, 0));

    // Simulate frames until ball reaches near target
    for (let i = 0; i < 100; i++) {
      ball.update(1 / 60);
      if (!ball.isInFlight && ball.passTarget === null) break;
    }

    // Ball should have some velocity (decaying, not zero)
    const speed = ball.velocity.length();
    expect(speed).toBeGreaterThan(0);
  });

  it('should keep isInFlight true past the target point', () => {
    const ball = new Ball(new THREE.Vector3(0, 1, 0));
    ball.passTo(new THREE.Vector3(2, 1, 0));

    let wasInFlightPastTarget = false;
    for (let i = 0; i < 60; i++) {
      ball.update(1 / 60);
      if (ball.mesh.position.x > 2 && ball.isInFlight) {
        wasInFlightPastTarget = true;
        break;
      }
    }
    expect(wasInFlightPastTarget).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/ball.test.ts`
Expected: FAIL — velocity is zeroed on arrival

- [ ] **Step 3: Modify ball.ts pass arrival logic**

In `src/game/ball.ts`, replace State 3 (lines 194-211):

```typescript
// State 3: chest-height pass (no gravity)
if (this.passTarget) {
  const toTarget = new THREE.Vector3().subVectors(this.passTarget, this.mesh.position);
  const dist = toTarget.length();
  if (dist < 1.0) {
    // Past target — enter decay mode (keep flying, slow down)
    this.passTarget = null;
    // Don't zero velocity or clear isInFlight — ball continues
    this.updateTrail(dt);
    return;
  }
  // Move toward target at passSpeed, no gravity
  const direction = toTarget.normalize();
  this.velocity.copy(direction.multiplyScalar(this.passSpeed));
  this.mesh.position.addScaledVector(this.velocity, dt);
  this.updateTrail(dt);
  return;
}

// State 3b: pass overshot target — decay velocity until pickup or out of bounds
if (this.isInFlight && this.arc.length === 0 && !this.passTarget) {
  this.velocity.multiplyScalar(0.95); // decay each frame
  this.mesh.position.addScaledVector(this.velocity, dt);
  if (this.velocity.length() < 0.5) {
    this.isInFlight = false;
  }
  this.updateTrail(dt);
  return;
}
```

Note: the `passTarget` field needs to be exposed as public readonly for the test. Change `private passTarget` to just `passTarget` in the class:

```typescript
passTarget: THREE.Vector3 | null = null;
```

- [ ] **Step 4: Enable ball pickup during flight for pending passes**

In `src/game/game-session.ts`, modify the ball pickup check. Currently it only runs `if (!this.ball.heldBy && !this.ball.isInFlight)` (~line 343). Add a second check for in-flight passes:

After the existing `checkBallPickup()` call (~line 344), add:

```typescript
// Also check pickup during in-flight passes (receiver catches in stride)
if (!this.ball.heldBy && this.ball.isInFlight && this.pendingPassTarget) {
  this.checkBallPickup();
}
```

- [ ] **Step 5: Remove random jump-catch interception**

In `src/game/game-session.ts`, delete the entire jump-catch block (~lines 375-392):

```typescript
// DELETE THIS BLOCK:
// Jump catch: airborne player (not blocking) can catch ball passing nearby
if (this.ball.isInFlight && !this.pendingPassTarget) {
  for (const p of this.getAllPlayers()) {
    if (p.isJumping && !p.isBlocking && p.distanceTo(this.ball.mesh.position) < 1.0) {
      if (Math.random() < 0.15) {
        // ... all of this
      }
    }
  }
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/game/ball.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/game/ball.ts src/game/game-session.ts tests/game/ball.test.ts
git commit -m "fix: passes no longer stop dead — ball continues past target with decay"
```

---

### Task 3: Pass Lane Interception

**Files:**
- Modify: `src/game/game-session.ts` (update method, ~line 250 area)
- Test: `tests/game/pass-lane.test.ts`

- [ ] **Step 1: Write failing tests for pass lane check**

Create `tests/game/pass-lane.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isInPassLane } from '@/game/pass-targeting';

describe('isInPassLane', () => {
  it('should detect defender directly in pass path', () => {
    const ballPos = { x: 0, z: 0 };
    const targetPos = { x: 10, z: 0 };
    const defenderPos = { x: 5, z: 0 }; // directly on the line
    expect(isInPassLane(ballPos, targetPos, defenderPos, 1.0)).toBe(true);
  });

  it('should detect defender near pass path', () => {
    const ballPos = { x: 0, z: 0 };
    const targetPos = { x: 10, z: 0 };
    const defenderPos = { x: 5, z: 0.8 }; // 0.8 units off the line, within 1.0 threshold
    expect(isInPassLane(ballPos, targetPos, defenderPos, 1.0)).toBe(true);
  });

  it('should not detect defender far from pass path', () => {
    const ballPos = { x: 0, z: 0 };
    const targetPos = { x: 10, z: 0 };
    const defenderPos = { x: 5, z: 3 }; // 3 units off the line
    expect(isInPassLane(ballPos, targetPos, defenderPos, 1.0)).toBe(false);
  });

  it('should not detect defender behind the ball', () => {
    const ballPos = { x: 0, z: 0 };
    const targetPos = { x: 10, z: 0 };
    const defenderPos = { x: -3, z: 0 }; // behind ball
    expect(isInPassLane(ballPos, targetPos, defenderPos, 1.0)).toBe(false);
  });

  it('should not detect defender past the target', () => {
    const ballPos = { x: 0, z: 0 };
    const targetPos = { x: 10, z: 0 };
    const defenderPos = { x: 15, z: 0 }; // past target
    expect(isInPassLane(ballPos, targetPos, defenderPos, 1.0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/pass-lane.test.ts`
Expected: FAIL — `isInPassLane` not found

- [ ] **Step 3: Implement isInPassLane**

Add to `src/game/pass-targeting.ts`:

```typescript
export function isInPassLane(
  ballPos: { x: number; z: number },
  targetPos: { x: number; z: number },
  defenderPos: { x: number; z: number },
  laneWidth: number
): boolean {
  const dx = targetPos.x - ballPos.x;
  const dz = targetPos.z - ballPos.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.01) return false;

  // Project defender onto the ball→target line segment
  const t = ((defenderPos.x - ballPos.x) * dx + (defenderPos.z - ballPos.z) * dz) / lenSq;

  // Must be between ball and target (not behind or past)
  if (t < 0 || t > 1) return false;

  // Closest point on line
  const closestX = ballPos.x + t * dx;
  const closestZ = ballPos.z + t * dz;

  // Perpendicular distance
  const perpDx = defenderPos.x - closestX;
  const perpDz = defenderPos.z - closestZ;
  const perpDist = Math.sqrt(perpDx * perpDx + perpDz * perpDz);

  return perpDist < laneWidth;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/game/pass-lane.test.ts`
Expected: PASS

- [ ] **Step 5: Wire pass lane auto-deflection into game-session.ts**

In `src/game/game-session.ts`, add import:
```typescript
import { findBestPassTarget, isInPassLane } from './pass-targeting';
```

In the `update()` method, after the ball update and before the out-of-bounds check (~line 330 area), add a pass lane interception check:

```typescript
// Pass lane interception: defenders in the path auto-deflect
if (this.ball.isInFlight && this.pendingPassTarget && this.ball.passTarget) {
  const opponents = this.matchEngine.state.possession === 'home' ? this.awayPlayers : this.homePlayers;
  const ballPos = { x: this.ball.mesh.position.x, z: this.ball.mesh.position.z };
  const targetPos = { x: this.ball.passTarget.x, z: this.ball.passTarget.z };

  for (const def of opponents) {
    if (def.distanceTo(this.ball.mesh.position) > 1.5) continue; // must be near ball
    if (isInPassLane(ballPos, targetPos, { x: def.position.x, z: def.position.z }, 1.0)) {
      if (Math.random() < 0.30) { // 30% per frame in lane
        this.ball.isInFlight = false;
        this.ball.clearPassTarget();
        this.ball.velocity.set((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4);
        this.pendingPassTarget = null;
        this.events.emit('splash', { text: 'DEFLECTED!', color: '#f39c12' });
        break;
      }
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/game/pass-targeting.ts tests/game/pass-lane.test.ts src/game/game-session.ts
git commit -m "feat: pass lane interception — defenders in path can auto-deflect"
```

---

### Task 4: Shot Range Limiting

**Files:**
- Modify: `src/game/game-session.ts:692-757` (swipe-up handler)
- Test: `tests/game/shot-range.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/game/shot-range.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { clampShotTarget } from '@/game/shot-range';
import * as THREE from 'three';

describe('clampShotTarget', () => {
  it('should not clamp shots within 12 units', () => {
    const shooter = new THREE.Vector3(0, 1, 0);
    const hoop = new THREE.Vector3(0, 3.05, 10);
    const result = clampShotTarget(shooter, hoop, 12);
    expect(result.clamped).toBe(false);
    expect(result.target.x).toBeCloseTo(hoop.x);
    expect(result.target.z).toBeCloseTo(hoop.z);
  });

  it('should clamp shots beyond 12 units', () => {
    const shooter = new THREE.Vector3(0, 1, -10);
    const hoop = new THREE.Vector3(0, 3.05, 13); // 23 units away
    const result = clampShotTarget(shooter, hoop, 12);
    expect(result.clamped).toBe(true);
    const dist = shooter.distanceTo(result.target);
    expect(dist).toBeCloseTo(12, 0);
  });

  it('should preserve direction when clamping', () => {
    const shooter = new THREE.Vector3(5, 1, -10);
    const hoop = new THREE.Vector3(0, 3.05, 13);
    const result = clampShotTarget(shooter, hoop, 12);
    // Clamped target should be on the shooter→hoop line
    const dirToHoop = new THREE.Vector3().subVectors(hoop, shooter).normalize();
    const dirToTarget = new THREE.Vector3().subVectors(result.target, shooter).normalize();
    expect(dirToHoop.dot(dirToTarget)).toBeCloseTo(1.0, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/shot-range.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement clampShotTarget**

Create `src/game/shot-range.ts`:

```typescript
import * as THREE from 'three';

export interface ShotClampResult {
  target: THREE.Vector3;
  clamped: boolean;
}

export function clampShotTarget(
  shooterPos: THREE.Vector3,
  hoopPos: THREE.Vector3,
  maxRange: number
): ShotClampResult {
  const dist = shooterPos.distanceTo(hoopPos);
  if (dist <= maxRange) {
    return { target: hoopPos.clone(), clamped: false };
  }

  // Clamp: target is maxRange units from shooter toward hoop
  const direction = new THREE.Vector3().subVectors(hoopPos, shooterPos).normalize();
  const clampedTarget = shooterPos.clone().addScaledVector(direction, maxRange);
  // Set Y to a reasonable arc endpoint height (not ground level)
  clampedTarget.y = THREE.MathUtils.lerp(shooterPos.y, hoopPos.y, maxRange / dist);
  return { target: clampedTarget, clamped: true };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/game/shot-range.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into game-session.ts swipe-up handler**

In `src/game/game-session.ts`, add import:
```typescript
import { clampShotTarget } from './shot-range';
```

In the `'swipe-up'` case, replace the SHOT PATH section (~lines 748-755):

```typescript
// SHOT PATH: normal charge-up shot
human.loseBall();
human.triggerShoot();
this.lastShooterId = human.data.id;
this.lastChargeMultiplier = chargeMultiplier;

const { target: shotTarget, clamped } = clampShotTarget(
  human.position, targetHoop, 12
);
this.ball.shootAt(shotTarget, gesture.power);

if (clamped) {
  this.events.emit('splash', { text: 'AIR BALL!', color: '#95a5a6' });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/game/shot-range.ts tests/game/shot-range.test.ts src/game/game-session.ts
git commit -m "feat: shot range limit — shots beyond 12u fall short as air balls"
```

---

### Task 5: Dunk Zone Rework

**Files:**
- Modify: `src/game/game-session.ts:714-747`
- Test: `tests/game/dunk-zone.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/game/dunk-zone.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { isInDunkZone } from '@/game/shot-range';

describe('isInDunkZone', () => {
  const hoopHome = new THREE.Vector3(0, 3.05, -13);
  const hoopAway = new THREE.Vector3(0, 3.05, 13);

  it('should return true directly under home hoop', () => {
    expect(isInDunkZone(new THREE.Vector3(0, 0, -12), hoopHome)).toBe(true);
  });

  it('should return true directly under away hoop', () => {
    expect(isInDunkZone(new THREE.Vector3(0, 0, 12), hoopAway)).toBe(true);
  });

  it('should return false at mid-court', () => {
    expect(isInDunkZone(new THREE.Vector3(0, 0, 0), hoopHome)).toBe(false);
  });

  it('should return false outside paint width', () => {
    expect(isInDunkZone(new THREE.Vector3(3, 0, -12), hoopHome)).toBe(false);
  });

  it('should return false at paint edge far from hoop', () => {
    // In the paint but not the inner third
    expect(isInDunkZone(new THREE.Vector3(0, 0, -9), hoopHome)).toBe(false);
  });

  it('should return true at edge of dunk zone', () => {
    // paintLength/3 ≈ 1.93 from hoop z. Hoop at -13, so dunk zone starts at -13+1.93=-11.07
    expect(isInDunkZone(new THREE.Vector3(1.5, 0, -11.5), hoopHome)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/dunk-zone.test.ts`
Expected: FAIL — `isInDunkZone` not found

- [ ] **Step 3: Implement isInDunkZone**

Add to `src/game/shot-range.ts`:

```typescript
const PAINT_HALF_WIDTH = 1.8;   // paintWidth / 2
const PAINT_LENGTH = 5.8;
const DUNK_ZONE_DEPTH = PAINT_LENGTH / 3; // ~1.93 units from hoop

export function isInDunkZone(
  playerPos: THREE.Vector3,
  attackHoop: THREE.Vector3
): boolean {
  // Must be within paint width
  if (Math.abs(playerPos.x) > PAINT_HALF_WIDTH) return false;

  // Must be within innermost third of paint (closest to hoop)
  const distFromHoop = Math.abs(playerPos.z - attackHoop.z);
  return distFromHoop < DUNK_ZONE_DEPTH;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/game/dunk-zone.test.ts`
Expected: PASS

- [ ] **Step 5: Rework dunk logic in game-session.ts**

In `src/game/game-session.ts`, add import (extend existing):
```typescript
import { clampShotTarget, isInDunkZone } from './shot-range';
```

Replace the dunk check (~lines 713-747):

```typescript
// OLD: if (dist < 5 && human.stamina >= 0.8) {

// NEW:
const humanTeamForDunk = this.getPlayerTeam(this.humanPlayerId);
const dunkHoop = this.getTeamAttackHoop(humanTeamForDunk);
if (isInDunkZone(human.position, dunkHoop) && human.stamina >= 0.3) {
  const distToHoop = human.distanceTo(dunkHoop);
  let successRate: number;
  if (distToHoop < 1.5) successRate = 0.9;
  else successRate = 0.7;
  successRate += (human.data.stats.dunkPower - 5) * 0.03;
  successRate = Math.max(0.1, Math.min(0.95, successRate));

  const opponents = humanTeamForDunk === 'home' ? this.awayPlayers : this.homePlayers;
  let contested = false;
  for (const def of opponents) {
    const defDist = def.distanceTo(dunkHoop);
    const isInPath = defDist < distToHoop && def.distanceTo(human.position) < 3;
    if (isInPath && def.isJumping) { contested = true; break; }
  }

  if (contested && Math.random() < 0.6) {
    human.loseBall();
    human.triggerFall();
    this.ball.release();
    this.ball.velocity.set((Math.random() - 0.5) * 5, 3, (Math.random() - 0.5) * 5);
    break;
  }

  if (Math.random() < successRate) {
    human.loseBall();
    human.triggerDunk();
    this.lastShooterId = human.data.id;
    this.ball.shootAt(targetHoop, 1.0);
  } else {
    human.loseBall();
    this.lastShooterId = human.data.id;
    this.ball.shootAt(targetHoop, 0.8);
  }
} else {
```

The `else` clause remains the existing SHOT PATH code (now with range clamping from Task 4).

- [ ] **Step 6: Commit**

```bash
git add src/game/shot-range.ts tests/game/dunk-zone.test.ts src/game/game-session.ts
git commit -m "feat: dunk zone rework — paint-based trigger, stamina 0.3 threshold"
```

---

### Task 6: MenuNavigator Class

**Files:**
- Create: `src/ui/menu-navigator.ts`
- Test: `tests/ui/menu-navigator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/ui/menu-navigator.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MenuNavigator } from '@/ui/menu-navigator';

function createButtons(count: number): HTMLButtonElement[] {
  return Array.from({ length: count }, (_, i) => {
    const btn = document.createElement('button');
    btn.textContent = `Button ${i}`;
    return btn;
  });
}

describe('MenuNavigator', () => {
  let nav: MenuNavigator;

  beforeEach(() => {
    nav = new MenuNavigator();
  });

  describe('focus cycling', () => {
    it('should focus first item on register', () => {
      const btns = createButtons(3);
      nav.register(btns);
      expect(nav.focusedIndex).toBe(0);
      expect(btns[0].classList.contains('menu-focused')).toBe(true);
    });

    it('should move focus down', () => {
      const btns = createButtons(3);
      nav.register(btns);
      nav.navigate('down');
      expect(nav.focusedIndex).toBe(1);
      expect(btns[1].classList.contains('menu-focused')).toBe(true);
      expect(btns[0].classList.contains('menu-focused')).toBe(false);
    });

    it('should wrap around at bottom', () => {
      const btns = createButtons(3);
      nav.register(btns);
      nav.navigate('down');
      nav.navigate('down');
      nav.navigate('down'); // wrap
      expect(nav.focusedIndex).toBe(0);
    });

    it('should wrap around at top', () => {
      const btns = createButtons(3);
      nav.register(btns);
      nav.navigate('up'); // wrap from 0
      expect(nav.focusedIndex).toBe(2);
    });
  });

  describe('grid navigation', () => {
    it('should move right in grid mode', () => {
      const btns = createButtons(6);
      nav.register(btns, 3); // 3 columns, 2 rows
      nav.navigate('right');
      expect(nav.focusedIndex).toBe(1);
    });

    it('should move down a row in grid mode', () => {
      const btns = createButtons(6);
      nav.register(btns, 3);
      nav.navigate('down');
      expect(nav.focusedIndex).toBe(3);
    });
  });

  describe('selection', () => {
    it('should trigger click on focused item', () => {
      const btns = createButtons(3);
      const clickHandler = vi.fn();
      btns[0].addEventListener('click', clickHandler);
      nav.register(btns);
      nav.select();
      expect(clickHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('back handler', () => {
    it('should call back handler', () => {
      const backFn = vi.fn();
      nav.register(createButtons(2));
      nav.setBackHandler(backFn);
      nav.back();
      expect(backFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('should deactivate on clear', () => {
      nav.register(createButtons(3));
      expect(nav.active).toBe(true);
      nav.clear();
      expect(nav.active).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/menu-navigator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MenuNavigator**

Create `src/ui/menu-navigator.ts`:

```typescript
export class MenuNavigator {
  focusedIndex = 0;
  active = false;

  private items: HTMLElement[] = [];
  private columns = 1;
  private backHandler: (() => void) | null = null;

  // Gamepad debounce state
  private prevDpadUp = false;
  private prevDpadDown = false;
  private prevDpadLeft = false;
  private prevDpadRight = false;
  private prevA = false;
  private prevB = false;
  private stickRepeatTimer = 0;

  // Keyboard state
  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  register(items: HTMLElement[], columns = 1): void {
    this.clear();
    this.items = items;
    this.columns = columns;
    this.focusedIndex = 0;
    this.active = true;
    this.applyFocus();
    this.attachKeyboard();
  }

  clear(): void {
    this.removeFocus();
    this.items = [];
    this.active = false;
    this.backHandler = null;
    this.detachKeyboard();
  }

  setBackHandler(fn: () => void): void {
    this.backHandler = fn;
  }

  navigate(direction: 'up' | 'down' | 'left' | 'right'): void {
    if (!this.active || this.items.length === 0) return;

    this.removeFocus();
    const rows = Math.ceil(this.items.length / this.columns);
    const row = Math.floor(this.focusedIndex / this.columns);
    const col = this.focusedIndex % this.columns;

    switch (direction) {
      case 'up': {
        const newRow = (row - 1 + rows) % rows;
        this.focusedIndex = Math.min(newRow * this.columns + col, this.items.length - 1);
        break;
      }
      case 'down': {
        const newRow = (row + 1) % rows;
        this.focusedIndex = Math.min(newRow * this.columns + col, this.items.length - 1);
        break;
      }
      case 'left': {
        this.focusedIndex = (this.focusedIndex - 1 + this.items.length) % this.items.length;
        break;
      }
      case 'right': {
        this.focusedIndex = (this.focusedIndex + 1) % this.items.length;
        break;
      }
    }

    this.applyFocus();
  }

  select(): void {
    if (!this.active || !this.items[this.focusedIndex]) return;
    this.items[this.focusedIndex].click();
  }

  back(): void {
    this.backHandler?.();
  }

  update(pad: Gamepad | null): void {
    if (!this.active || !pad) return;

    // D-pad buttons (standard mapping: 12=up, 13=down, 14=left, 15=right)
    const dpadUp = pad.buttons[12]?.pressed ?? false;
    const dpadDown = pad.buttons[13]?.pressed ?? false;
    const dpadLeft = pad.buttons[14]?.pressed ?? false;
    const dpadRight = pad.buttons[15]?.pressed ?? false;
    const aBtn = pad.buttons[0]?.pressed ?? false;
    const bBtn = pad.buttons[1]?.pressed ?? false;

    if (dpadUp && !this.prevDpadUp) this.navigate('up');
    if (dpadDown && !this.prevDpadDown) this.navigate('down');
    if (dpadLeft && !this.prevDpadLeft) this.navigate('left');
    if (dpadRight && !this.prevDpadRight) this.navigate('right');
    if (aBtn && !this.prevA) this.select();
    if (bBtn && !this.prevB) this.back();

    this.prevDpadUp = dpadUp;
    this.prevDpadDown = dpadDown;
    this.prevDpadLeft = dpadLeft;
    this.prevDpadRight = dpadRight;
    this.prevA = aBtn;
    this.prevB = bBtn;

    // Left stick Y-axis with repeat delay
    const stickY = pad.axes[1] ?? 0;
    const stickX = pad.axes[0] ?? 0;
    if (Math.abs(stickY) > 0.5 || Math.abs(stickX) > 0.5) {
      this.stickRepeatTimer -= 1 / 60;
      if (this.stickRepeatTimer <= 0) {
        if (stickY < -0.5) this.navigate('up');
        else if (stickY > 0.5) this.navigate('down');
        else if (stickX < -0.5) this.navigate('left');
        else if (stickX > 0.5) this.navigate('right');
        this.stickRepeatTimer = 0.2; // 200ms repeat delay
      }
    } else {
      this.stickRepeatTimer = 0;
    }
  }

  private applyFocus(): void {
    const el = this.items[this.focusedIndex];
    if (el) {
      el.classList.add('menu-focused');
      el.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private removeFocus(): void {
    for (const item of this.items) {
      item.classList.remove('menu-focused');
    }
  }

  private attachKeyboard(): void {
    this.keyListener = (e: KeyboardEvent) => {
      if (!this.active) return;
      switch (e.code) {
        case 'ArrowUp': e.preventDefault(); this.navigate('up'); break;
        case 'ArrowDown': e.preventDefault(); this.navigate('down'); break;
        case 'ArrowLeft': e.preventDefault(); this.navigate('left'); break;
        case 'ArrowRight': e.preventDefault(); this.navigate('right'); break;
        case 'Enter': e.preventDefault(); this.select(); break;
        case 'Escape': e.preventDefault(); this.back(); break;
      }
    };
    document.addEventListener('keydown', this.keyListener);
  }

  private detachKeyboard(): void {
    if (this.keyListener) {
      document.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
  }
}
```

- [ ] **Step 4: Add CSS for focus style**

In `index.html` (or wherever styles live), add a global style. If using Vite, add to a `<style>` tag or import a CSS file. Simplest approach — add to `src/main.ts` at top level:

```typescript
// Add focus style for menu navigation
const style = document.createElement('style');
style.textContent = `.menu-focused { outline: 2px solid #e94560 !important; outline-offset: 4px; box-shadow: 0 0 10px rgba(233, 69, 96, 0.5); }`;
document.head.appendChild(style);
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/ui/menu-navigator.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/menu-navigator.ts tests/ui/menu-navigator.test.ts src/main.ts
git commit -m "feat: MenuNavigator — gamepad/keyboard navigation for menus"
```

---

### Task 7: Wire MenuNavigator Into All Menus

**Files:**
- Modify: `src/main.ts`
- Modify: `src/ui/menus.ts`
- Modify: `src/ui/pause-menu.ts`
- Modify: `src/ui/post-game.ts`
- Modify: `src/ui/draft-ui.ts`
- Modify: `src/ui/bracket-view.ts`
- Modify: `src/ui/betting-ui.ts`

- [ ] **Step 1: Instantiate MenuNavigator in main.ts**

In `src/main.ts`, add import:
```typescript
import { MenuNavigator } from './ui/menu-navigator';
```

After the `inputManager` line:
```typescript
const menuNavigator = new MenuNavigator();
```

Pass `menuNavigator` to each UI constructor. Each menu class needs a `setNavigator(nav: MenuNavigator)` method or accepts it in constructor. Since adding constructor params changes existing call sites, use a setter approach:

```typescript
menuUI.setNavigator(menuNavigator);
pauseMenu.setNavigator(menuNavigator);
postGameUI.setNavigator(menuNavigator);
draftUI.setNavigator(menuNavigator);
bracketViewUI.setNavigator(menuNavigator);
bettingUI.setNavigator(menuNavigator);
```

- [ ] **Step 2: Add gamepad polling for menu navigation in game loop**

In the `update()` function in `src/main.ts`, add before the gameplay guard:

```typescript
// Menu navigation (runs when any menu is visible)
if (menuNavigator.active) {
  const pad = navigator.getGamepads?.()[inputManager.gamepadControls.gamepadIndex ?? -1] ?? null;
  menuNavigator.update(pad);
}
```

Note: Need to expose `gamepadIndex` from `InputManager`. In `src/game/input-manager.ts`, change `private gamepadIndex` to `gamepadIndex`:
```typescript
gamepadIndex: number | null = null;
```

- [ ] **Step 3: Wire MenuUI (main menu, settings, tournament select)**

In `src/ui/menus.ts`, add:

```typescript
import { MenuNavigator } from './menu-navigator';
```

Add field and setter to `MenuUI`:
```typescript
private navigator: MenuNavigator | null = null;

setNavigator(nav: MenuNavigator): void {
  this.navigator = nav;
}
```

At the end of each `render*()` method, after all buttons are appended, collect the buttons and register:

In `renderMainMenu()` — collect the 4 buttons into an array and call:
```typescript
this.navigator?.register(buttons);
```

In `renderSettings()` — collect the back button:
```typescript
this.navigator?.register([backBtn]);
this.navigator?.setBackHandler(() => this.show('main'));
```

In `renderTournamentSelect()` and `renderFullGameSelect()` — collect buttons:
```typescript
this.navigator?.register(buttons);
this.navigator?.setBackHandler(() => this.show('main'));
```

In the `hide()` method:
```typescript
this.navigator?.clear();
```

- [ ] **Step 4: Wire PauseMenu**

In `src/ui/pause-menu.ts`, add the same pattern:

```typescript
import { MenuNavigator } from './menu-navigator';

// Add field + setter
private navigator: MenuNavigator | null = null;
setNavigator(nav: MenuNavigator): void { this.navigator = nav; }
```

In `renderPauseView()`: register the 3 buttons (Resume, Controls, Quit), set back handler to resume.
In `renderControlsView()`: register the Back button, set back handler to pause view.
In `renderConfirmQuit()`: register Yes/No buttons, set back handler to pause view.
In `hide()`: `this.navigator?.clear()`.

- [ ] **Step 5: Wire PostGameUI**

In `src/ui/post-game.ts`, same pattern:
- Import MenuNavigator, add field + setter
- In `show()`: after creating Play Again and Main Menu buttons, register them
- In `hide()`: clear

- [ ] **Step 6: Wire DraftUI**

In `src/ui/draft-ui.ts`:
- Import MenuNavigator, add field + setter
- In render method: collect card buttons into array, register with `columns` matching the grid layout (e.g., 3 or 4)
- In `hide()`: clear

- [ ] **Step 7: Wire BracketViewUI and BettingUI**

Same pattern for both — import, setter, register buttons on render, clear on hide.

- [ ] **Step 8: Verify menus work**

Run: `npm run dev`
Test: navigate main menu with arrow keys, enter to select, escape to go back. Connect gamepad — D-pad and A/B buttons should work.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts src/game/input-manager.ts src/ui/menus.ts src/ui/pause-menu.ts src/ui/post-game.ts src/ui/draft-ui.ts src/ui/bracket-view.ts src/ui/betting-ui.ts
git commit -m "feat: controller-friendly menus — gamepad/keyboard navigation across all screens"
```

---

### Task 8: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Fix any failures**

If any test fails, diagnose and fix.

- [ ] **Step 3: Commit if fixes needed**

```bash
git add -A
git commit -m "fix: test suite cleanup after gameplay mechanics v2"
```
