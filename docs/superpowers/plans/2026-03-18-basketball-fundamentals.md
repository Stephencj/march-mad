# Basketball Fundamentals: Camera, Shot Clock, Transitions, Shot Accuracy — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game feel like a real basketball video game — broadcast camera, shot clock, proper transitions after scoring, and distance/stat-based shot accuracy.

**Architecture:** Replace the behind-the-back camera with a fixed broadcast-style side view that follows the ball along the court axis. Add a 24-second shot clock to MatchEngine. After scoring, pause briefly, then have players run to positions instead of teleporting. Add a shot accuracy algorithm that factors distance, player stats, and defender proximity.

**Tech Stack:** Three.js, existing game systems

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/game/shot-accuracy.ts` | Algorithm to determine if a shot goes in based on distance, stats, defender proximity |

### Modified Files
| File | Changes |
|------|---------|
| `src/game/camera.ts` | Replace with broadcast-style camera: fixed side-view at midcourt, follows ball along Z axis |
| `src/game/match.ts` | Add shot clock (24s), add `shotClockSeconds` to MatchState, reset on possession change |
| `src/core/types.ts` | Add `shotClockSeconds` to MatchState interface |
| `src/game/game-session.ts` | Use shot accuracy for made/miss determination, add transition phase after score, update camera info for broadcast style |
| `src/ui/hud.ts` | Display shot clock on HUD |
| `src/main.ts` | Update camera setup for broadcast view |

---

## Chunk 1: Broadcast Camera

### Task 1: Replace Camera with Broadcast Style

**Files:**
- Rewrite: `src/game/camera.ts`
- Modify: `src/game/game-session.ts` (getCameraInfo)
- Modify: `src/main.ts` (camera setup)

The broadcast camera in basketball games:
- Camera sits on ONE SIDE of the court (positive X), at midcourt height
- Camera looks ACROSS the court (toward negative X)
- Camera FOLLOWS the ball/action along the Z axis (court length) by panning
- Camera is at a FIXED distance from the court (doesn't move in/out)
- When play moves toward one basket, camera pans that way
- Height and distance stay constant

- [ ] **Step 1: Rewrite camera.ts**

Replace the entire camera system with a broadcast camera:

```typescript
import * as THREE from 'three';

export type CameraMode = 'broadcast' | 'slam' | 'spectator';

const BROADCAST_CONFIG = {
  sideDistance: 18,    // X distance from court center (how far the camera sits to the side)
  height: 10,          // Y height
  lookAheadZ: 2,       // how far ahead of the tracked position the camera looks
};

const BROADCAST_CONFIG_FULL = {
  sideDistance: 22,
  height: 12,
  lookAheadZ: 3,
};

const SLAM_DURATION = 2.5;
const LERP_SPEED = 3.0;

export class CameraSystem {
  private camera: THREE.PerspectiveCamera;
  private _currentMode: CameraMode = 'broadcast';
  private _previousMode: CameraMode = 'broadcast';
  private slamTimer = 0;
  private slamTarget = new THREE.Vector3();
  private targetPosition = new THREE.Vector3();
  private targetLookAt = new THREE.Vector3();
  fullCourt = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  get currentMode(): CameraMode {
    return this._currentMode;
  }

  setMode(mode: CameraMode): void {
    if (mode !== this._currentMode) {
      this._previousMode = this._currentMode;
      this._currentMode = mode;
    }
  }

  triggerSlamCam(position: THREE.Vector3): void {
    this._previousMode = this._currentMode;
    this._currentMode = 'slam';
    this.slamTimer = SLAM_DURATION;
    this.slamTarget.copy(position);
  }

  update(trackPosition: THREE.Vector3, lookAtTarget: THREE.Vector3, dt: number): void {
    // Handle slam cam timer
    if (this._currentMode === 'slam') {
      this.slamTimer -= dt;
      if (this.slamTimer <= 0) {
        this._currentMode = this._previousMode === 'slam' ? 'broadcast' : this._previousMode;
        this.slamTimer = 0;
      }
    }

    if (this._currentMode === 'slam') {
      // Slam cam: close-up dramatic angle
      this.targetPosition.set(
        this.slamTarget.x + 3,
        this.slamTarget.y + 1,
        this.slamTarget.z + 4
      );
      this.targetLookAt.copy(this.slamTarget);
    } else {
      // BROADCAST CAMERA: fixed side view, follows action along Z
      const config = this.fullCourt ? BROADCAST_CONFIG_FULL : BROADCAST_CONFIG;

      // Camera sits on the SIDE of the court (positive X)
      // Follows the tracked position along Z (court length)
      // Clamp Z to keep within reasonable court view
      const courtLength = this.fullCourt ? 14 : 7;
      const followZ = THREE.MathUtils.clamp(trackPosition.z, -courtLength, courtLength);

      this.targetPosition.set(
        config.sideDistance,    // fixed X distance to the side
        config.height,          // fixed height
        followZ                 // follows action along court length
      );

      // Look at the action area (slightly ahead of where the ball is)
      this.targetLookAt.set(
        0,                      // center of court
        1.5,                    // slightly above ground (waist height)
        followZ + config.lookAheadZ  // look slightly ahead
      );
    }

    // Smooth lerp
    const lerpFactor = 1 - Math.exp(-LERP_SPEED * dt);
    this.camera.position.lerp(this.targetPosition, lerpFactor);
    this.camera.lookAt(this.targetLookAt);
  }
}
```

- [ ] **Step 2: Update getCameraInfo in game-session.ts**

The camera no longer needs 'offense'/'defense' modes. Simplify:

```typescript
getCameraInfo(): CameraInfo {
  if (this.slamCamRequested) {
    this.slamCamRequested = false;
    return {
      mode: 'slam' as CameraMode,
      trackPosition: this.slamCamPosition!,
      lookAt: this.slamCamPosition!,
    };
  }

  // Broadcast camera: always track the ball position
  const ballPos = this.ball.heldBy
    ? this.getPlayerById(this.ball.heldBy)?.position ?? this.ball.mesh.position
    : this.ball.mesh.position;

  return {
    mode: 'broadcast' as CameraMode,
    trackPosition: ballPos.clone(),
    lookAt: this.attackingHoop.clone(),
  };
}
```

Update the CameraInfo interface to use the new CameraMode type.

- [ ] **Step 3: Update main.ts camera handling**

In the game loop, `cameraSystem.setMode(camInfo.mode)` stays the same. But the slam cam trigger needs updating:

```typescript
if (camInfo.mode === 'slam') {
  cameraSystem.triggerSlamCam(camInfo.trackPosition);
} else {
  cameraSystem.setMode(camInfo.mode);
}
cameraSystem.update(camInfo.trackPosition, camInfo.lookAt, dt);
```

Also set initial camera position for broadcast view:
```typescript
camera.position.set(18, 10, 0); // side view at midcourt
camera.lookAt(0, 1.5, 0);
```

- [ ] **Step 4: Update camera tests if they exist**

Run `npx vitest run tests/game/camera.test.ts` — update any tests that reference old modes ('offense'/'defense').

- [ ] **Step 5: Verify build and all tests** — `npx vitest run`, `npx vite build`
- [ ] **Step 6: Commit** — `git commit -m "feat: broadcast-style camera — fixed side view that follows action along court"`

---

## Chunk 2: Shot Clock + Shot Accuracy

### Task 2: Add Shot Clock to Match Engine

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/game/match.ts`
- Modify: `src/ui/hud.ts`
- Test: `tests/game/match.test.ts`

- [ ] **Step 1: Add shotClockSeconds to MatchState**

In `src/core/types.ts`, add to the MatchState interface:
```typescript
shotClockSeconds: number; // 24 second shot clock, resets on possession change
```

- [ ] **Step 2: Implement shot clock in match.ts**

In the constructor, initialize: `shotClockSeconds: 24`

In `tickClock(dt)`, tick the shot clock:
```typescript
// Shot clock
this.state.shotClockSeconds -= dt;
if (this.state.shotClockSeconds <= 0) {
  this.state.shotClockSeconds = 0;
  // Shot clock violation — turnover
  this.state.possession = this.state.possession === 'home' ? 'away' : 'home';
  this.state.shotClockSeconds = 24;
  this.events.emit('shot-clock-violation', { team: this.state.possession });
}
```

In `score()`, reset shot clock: `this.state.shotClockSeconds = 24;`

Add a method:
```typescript
resetShotClock(): void {
  this.state.shotClockSeconds = 24;
}
```

Call it in `checkBallComplete()` too (possession change resets clock).

- [ ] **Step 3: Display shot clock on HUD**

In `hud.ts`, add a shot clock display element. Add method:
```typescript
updateShotClock(seconds: number): void {
  // Show shot clock as integer, turn red when < 5
}
```

Call it from main.ts game loop alongside the other HUD updates.

- [ ] **Step 4: Add test**

```typescript
it('shot clock violation causes turnover', () => {
  const { match } = createMatch();
  match.state.possession = 'home';
  match.tickClock(25); // exceed 24 seconds
  expect(match.state.possession).toBe('away');
  expect(match.state.shotClockSeconds).toBe(24); // reset
});
```

- [ ] **Step 5: Commit** — `git commit -m "feat: 24-second shot clock with violation turnover and HUD display"`

---

### Task 3: Shot Accuracy Algorithm

**Files:**
- Create: `src/game/shot-accuracy.ts`
- Test: `tests/game/shot-accuracy.test.ts`
- Modify: `src/game/game-session.ts`

The algorithm determines whether a shot goes in based on:
1. **Distance from hoop** — closer = higher chance. Half court = near zero.
2. **Player shooting stat** — higher stat = better accuracy
3. **Defender proximity** — closer defender = lower accuracy (contested shot)
4. **Shot type** — dunks are nearly guaranteed, layups are high %, three-pointers are low %

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import { calculateShotSuccess } from '@/game/shot-accuracy';

describe('Shot Accuracy', () => {
  it('layup has high success rate (>70%)', () => {
    let makes = 0;
    for (let i = 0; i < 100; i++) {
      if (calculateShotSuccess({ distance: 1.5, shootingStat: 7, defenderDistance: 3, shotType: 'layup' })) makes++;
    }
    expect(makes).toBeGreaterThan(60);
  });

  it('dunk is nearly guaranteed (>90%)', () => {
    let makes = 0;
    for (let i = 0; i < 100; i++) {
      if (calculateShotSuccess({ distance: 1, shootingStat: 5, defenderDistance: 2, shotType: 'dunk' })) makes++;
    }
    expect(makes).toBeGreaterThan(85);
  });

  it('half court shot almost never goes in (<5%)', () => {
    let makes = 0;
    for (let i = 0; i < 200; i++) {
      if (calculateShotSuccess({ distance: 14, shootingStat: 10, defenderDistance: 5, shotType: 'three-pointer' })) makes++;
    }
    expect(makes).toBeLessThan(15);
  });

  it('contested shot is harder than open shot', () => {
    let openMakes = 0;
    let contestedMakes = 0;
    for (let i = 0; i < 200; i++) {
      if (calculateShotSuccess({ distance: 5, shootingStat: 7, defenderDistance: 5, shotType: 'mid-range' })) openMakes++;
      if (calculateShotSuccess({ distance: 5, shootingStat: 7, defenderDistance: 1, shotType: 'mid-range' })) contestedMakes++;
    }
    expect(openMakes).toBeGreaterThan(contestedMakes);
  });

  it('higher shooting stat means better accuracy', () => {
    let lowStatMakes = 0;
    let highStatMakes = 0;
    for (let i = 0; i < 200; i++) {
      if (calculateShotSuccess({ distance: 5, shootingStat: 3, defenderDistance: 3, shotType: 'mid-range' })) lowStatMakes++;
      if (calculateShotSuccess({ distance: 5, shootingStat: 9, defenderDistance: 3, shotType: 'mid-range' })) highStatMakes++;
    }
    expect(highStatMakes).toBeGreaterThan(lowStatMakes);
  });
});
```

- [ ] **Step 2: Implement shot accuracy**

```typescript
export interface ShotContext {
  distance: number;       // distance from hoop in court units
  shootingStat: number;   // 1-10 player shooting stat
  defenderDistance: number; // nearest defender distance
  shotType: string;       // 'layup', 'mid-range', 'three-pointer', 'dunk', etc.
}

export function calculateShotSuccess(ctx: ShotContext): boolean {
  // Base accuracy by shot type
  let baseAccuracy: number;
  switch (ctx.shotType) {
    case 'dunk':
    case 'alley-oop':
    case 'powerup-dunk':
      baseAccuracy = 0.95; // dunks almost always go in
      break;
    case 'layup':
      baseAccuracy = 0.75;
      break;
    case 'mid-range':
      baseAccuracy = 0.45;
      break;
    case 'three-pointer':
      baseAccuracy = 0.33;
      break;
    default:
      baseAccuracy = 0.40;
  }

  // Distance penalty: accuracy drops sharply beyond normal range
  // Normal three-point range is ~6.75 units. Beyond that, accuracy plummets.
  const normalRange = 8; // units
  if (ctx.distance > normalRange) {
    const overshoot = (ctx.distance - normalRange) / normalRange;
    baseAccuracy *= Math.max(0.02, 1 - overshoot * 1.5); // drops to near zero
  }

  // Stat modifier: shooting stat 1-10 scales accuracy ±30%
  // Stat 5 = neutral, 10 = +30%, 1 = -30%
  const statModifier = 1 + (ctx.shootingStat - 5) * 0.06; // 0.70 to 1.30
  baseAccuracy *= statModifier;

  // Contest penalty: closer defender = lower accuracy
  // Defender at 0 = -40%, defender at 5+ = no penalty
  const contestPenalty = Math.max(0, 1 - (5 - Math.min(ctx.defenderDistance, 5)) * 0.08);
  baseAccuracy *= contestPenalty;

  // Clamp to reasonable bounds
  baseAccuracy = Math.max(0.02, Math.min(0.98, baseAccuracy));

  return Math.random() < baseAccuracy;
}
```

- [ ] **Step 3: Wire shot accuracy into game-session**

Currently ALL shots go in if they hit the hoop proximity check. Change this:

In the shot detection section of `update()`, when a shot is detected as "made":

```typescript
if (result.made) {
  const shooterId = this.lastShooterId;
  const team = this.getPlayerTeam(shooterId);
  const shotType = this.shotDetector.classifyShot(
    shooterId ? this.getPlayerById(shooterId)!.position : this.ball.mesh.position
  );

  // Determine if the shot actually goes in based on accuracy
  const shooter = shooterId ? this.getPlayerById(shooterId) : null;
  const distance = shooter ? shooter.distanceTo(this.attackingHoop) : 10;
  const nearestDefender = shooter ? this.getNearestOpponentDist(shooter as any) : 5;

  const goesIn = calculateShotSuccess({
    distance,
    shootingStat: shooter?.data.stats.shooting ?? 5,
    defenderDistance: nearestDefender,
    shotType,
  });

  if (goesIn) {
    this.handleMadeShot(team, shotType);
  } else {
    // Miss — ball bounces off rim, becomes loose
    this.ball.isInFlight = false;
    this.ball.velocity.set(
      (Math.random() - 0.5) * 3,
      2,
      (Math.random() - 0.5) * 3
    );
    // Crowd reacts to miss
  }
}
```

Import `calculateShotSuccess` from `./shot-accuracy`.

- [ ] **Step 4: Run tests** — all pass
- [ ] **Step 5: Commit** — `git commit -m "feat: shot accuracy algorithm — distance, stats, defense affect whether shots go in"`

---

## Chunk 3: Transitions After Score

### Task 4: Animated Transitions After Score

**Files:**
- Modify: `src/game/game-session.ts`
- Modify: `src/game/match.ts`

- [ ] **Step 1: Add 'transitioning' phase to GamePhase**

In `types.ts`, add `'transitioning'` to the GamePhase type:
```typescript
export type GamePhase = 'pre-game' | 'playing' | 'check-ball' | 'foul' | 'transitioning' | 'post-game';
```

- [ ] **Step 2: Rewrite resetAfterScore for animated transitions**

Instead of instantly teleporting players, set their targets and let them run:

```typescript
private resetAfterScore(receivingTeam: Possession): void {
  this.shotDetector.reset();
  this.matchEngine.state.phase = 'transitioning';
  this.transitionTimer = 2.0; // 2 seconds to get into position

  // Store target positions for each player
  const homeTargets = this.mode === '5v5'
    ? [new THREE.Vector3(0,0,-8), new THREE.Vector3(-4,0,-5), new THREE.Vector3(4,0,-5), new THREE.Vector3(-2,0,-3), new THREE.Vector3(2,0,-3)]
    : [new THREE.Vector3(-3,0,2), new THREE.Vector3(3,0,2), new THREE.Vector3(0,0,5)];
  const awayTargets = this.mode === '5v5'
    ? [new THREE.Vector3(0,0,8), new THREE.Vector3(-4,0,5), new THREE.Vector3(4,0,5), new THREE.Vector3(-2,0,3), new THREE.Vector3(2,0,3)]
    : [new THREE.Vector3(-2,0,-2), new THREE.Vector3(2,0,-2), new THREE.Vector3(0,0,-4)];

  // Set all players to sprint to their positions
  this.homePlayers.forEach((p, i) => {
    p.aiTarget = homeTargets[i] ?? homeTargets[0];
    p.aiMovementState = 'reacting'; // fast movement
    p.isSprinting = true;
  });
  this.awayPlayers.forEach((p, i) => {
    p.aiTarget = awayTargets[i] ?? awayTargets[0];
    p.aiMovementState = 'reacting';
    p.isSprinting = true;
  });

  // Swap hoops in 5v5
  if (this.mode === '5v5') {
    const temp = this.attackingHoop.clone();
    this.attackingHoop.copy(this.defendingHoop);
    this.defendingHoop.copy(temp);
    this.shotDetector.setHoopPosition(this.attackingHoop);
  }

  // Ball goes to receiving team after transition
  this.pendingReceivingTeam = receivingTeam;
}
```

Add properties: `private transitionTimer = 0; private pendingReceivingTeam: Possession | null = null;`

- [ ] **Step 3: Handle transition in update()**

In `update()`, add transition handling:

```typescript
// Handle transition phase
if (this.matchEngine.state.phase === 'transitioning') {
  this.transitionTimer -= dt;

  // Move all players toward their target positions
  for (const p of this.getAllPlayers()) {
    if (p.aiTarget) {
      p.moveToward(p.aiTarget, dt);
    }
  }
  // Animate players
  for (const p of this.getAllPlayers()) {
    p.animate(dt);
  }

  // When transition completes, give ball to receiving team and resume
  if (this.transitionTimer <= 0) {
    if (this.pendingReceivingTeam) {
      const receiver = this.pendingReceivingTeam === 'home' ? this.homePlayers[0] : this.awayPlayers[0];

      // Position ball near receiver (inbound position)
      if (this.mode === '5v5') {
        const baselineZ = this.pendingReceivingTeam === 'home' ? -13 : 13;
        this.ball.mesh.position.set(0, 1, baselineZ * 0.8);
      } else {
        this.ball.mesh.position.set(0, 1, COURT_DIMENSIONS.checkBallLine);
      }
      this.ball.velocity.set(0, 0, 0);
      this.setBallHolder(receiver.data.id);
      this.matchEngine.checkBallComplete(this.pendingReceivingTeam);
      this.matchEngine.resetShotClock();
      this.pendingReceivingTeam = null;
    }

    // Stop sprinting
    for (const p of this.getAllPlayers()) {
      p.isSprinting = false;
      p.aiMovementState = 'holding';
      p.aiHoldTimer = 0.5;
    }
  }
  return; // Don't run normal game logic during transition
}
```

- [ ] **Step 4: Don't process input during transition**

In `processInput`, add at the top:
```typescript
if (this.matchEngine.state.phase === 'transitioning') return;
```

- [ ] **Step 5: Run all tests, build** — fix any failing tests
- [ ] **Step 6: Commit** — `git commit -m "feat: animated transitions — players sprint to positions after score, 2s transition phase"`

---
