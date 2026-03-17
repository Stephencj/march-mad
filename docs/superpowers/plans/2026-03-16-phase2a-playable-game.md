# Phase 2A: Playable Game Loop — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a single 3v3 basketball game fully playable — human controls one player, AI controls the other 5, ball moves between players, shots score points, possession flows correctly, camera switches automatically.

**Architecture:** A new `GameSession` class orchestrates a single match. It owns the 6 players (3v3), the ball, and coordinates input → movement → AI decisions → ball handling → shot detection → scoring → possession changes. The existing `MatchEngine`, `PlayerAI`, `TeamAI`, `CameraSystem`, and `Ball` classes are used as-is. The session translates between the abstract game logic and the 3D scene.

**Tech Stack:** Three.js (rendering), existing game systems (match engine, AI, camera, controls)

**Spec:** `docs/superpowers/specs/2026-03-16-march-madness-3v3-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/game/shot-detector.ts` | Checks if ball passes through hoop area, determines shot type (inside/outside arc), reports made/missed |
| `src/game/game-session.ts` | Orchestrates a single 3v3 match: spawns 6 players on court, runs AI each frame, processes human input, manages ball possession/passing/shooting, triggers scoring via match engine, switches camera modes |

### Modified Files
| File | Changes |
|------|---------|
| `src/game/ball.ts` | Add flight state (`isInFlight`), `followHolder(position)` to track holder, `shootAt(target, power)` to animate along arc, `passto(target)` for passes |
| `src/game/player.ts` | Add `hasBall` flag, ball attachment offset, `shootBall(ball, target, power)` and `passBall(ball, targetPlayer)` convenience methods |
| `src/main.ts` | Replace test player with GameSession, wire control input to session, add "quick play" button to skip menus for testing |

---

## Chunk 1: Ball & Player Enhancements + Shot Detection

### Task 1: Enhance Ball with Flight and Holder Tracking

**Files:**
- Modify: `src/game/ball.ts`
- Test: `tests/game/ball.test.ts` (add new tests)

- [ ] **Step 1: Write new ball tests**

Add to `tests/game/ball.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { Ball } from '@/game/ball';
import * as THREE from 'three';

describe('Ball - enhanced', () => {
  it('follows holder position with offset when held', () => {
    const ball = new Ball();
    ball.pickup('p1');
    const holderPos = new THREE.Vector3(3, 0, 5);
    ball.followHolder(holderPos);
    expect(ball.mesh.position.x).toBeCloseTo(3, 0);
    expect(ball.mesh.position.z).toBeCloseTo(5, 0);
    expect(ball.mesh.position.y).toBeGreaterThan(0.5); // held at hand height
  });

  it('enters flight state when shot', () => {
    const ball = new Ball(new THREE.Vector3(0, 1, 5));
    ball.pickup('p1');
    ball.shootAt(new THREE.Vector3(0, 3.05, -6), 0.7);
    expect(ball.isInFlight).toBe(true);
    expect(ball.heldBy).toBeNull();
  });

  it('follows arc during flight', () => {
    const ball = new Ball(new THREE.Vector3(0, 1, 5));
    ball.pickup('p1');
    ball.shootAt(new THREE.Vector3(0, 3.05, -6), 0.7);
    const startZ = ball.mesh.position.z;
    // Simulate a few frames
    for (let i = 0; i < 10; i++) ball.update(1 / 60);
    expect(ball.mesh.position.z).not.toBeCloseTo(startZ, 0);
    expect(ball.isInFlight).toBe(true);
  });

  it('exits flight state after arc completes', () => {
    const ball = new Ball(new THREE.Vector3(0, 1, 5));
    ball.pickup('p1');
    ball.shootAt(new THREE.Vector3(0, 3.05, -6), 0.7);
    // Simulate enough frames for arc to complete (30 steps at 1/60 = 0.5s)
    for (let i = 0; i < 60; i++) ball.update(1 / 60);
    expect(ball.isInFlight).toBe(false);
  });

  it('passes toward a target position', () => {
    const ball = new Ball(new THREE.Vector3(0, 1, 0));
    ball.pickup('p1');
    ball.passTo(new THREE.Vector3(5, 1, 3));
    expect(ball.isInFlight).toBe(true);
    expect(ball.heldBy).toBeNull();
    // After some frames, should move toward target
    for (let i = 0; i < 10; i++) ball.update(1 / 60);
    expect(ball.mesh.position.x).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `npx vitest run tests/game/ball.test.ts`
Expected: Original 4 tests PASS, new 5 tests FAIL

- [ ] **Step 3: Implement ball enhancements**

Modify `src/game/ball.ts` — add these properties and methods to the Ball class:

```typescript
// New properties (add to class body)
isInFlight = false;
private arc: THREE.Vector3[] = [];
private arcIndex = 0;
private arcSpeed = 60; // steps per second
private passTarget: THREE.Vector3 | null = null;
private passSpeed = 12; // meters per second

// New method: follow the holder's position
followHolder(holderPosition: THREE.Vector3): void {
  if (this.heldBy === null) return;
  this.mesh.position.set(
    holderPosition.x + 0.3,
    holderPosition.y + 1.0, // hand height
    holderPosition.z + 0.3
  );
}

// New method: launch a shot toward target
shootAt(target: THREE.Vector3, power: number): void {
  this.arc = this.calculateArc(this.mesh.position.clone(), target, power);
  this.arcIndex = 0;
  this.isInFlight = true;
  this.passTarget = null;
  this.release();
}

// New method: pass toward a target position
passTo(target: THREE.Vector3): void {
  this.passTarget = target.clone();
  this.passTarget.y = 1.0; // chest height pass
  this.isInFlight = true;
  this.release();
  // Give the ball velocity toward target
  const dir = new THREE.Vector3().subVectors(this.passTarget, this.mesh.position).normalize();
  this.velocity.copy(dir.multiplyScalar(this.passSpeed));
}
```

Also modify the existing `update(dt)` method to handle flight:

```typescript
update(dt: number): void {
  if (this.heldBy !== null) return;

  if (this.arc.length > 0 && this.arcIndex < this.arc.length) {
    // Following a shooting arc
    const step = Math.min(Math.floor(this.arcSpeed * dt) + 1, this.arc.length - this.arcIndex);
    this.arcIndex += step;
    if (this.arcIndex >= this.arc.length) {
      this.arcIndex = this.arc.length - 1;
      this.isInFlight = false;
      this.arc = [];
      // Give downward velocity after arc ends
      this.velocity.set(0, -2, 0);
    }
    const pos = this.arc[Math.min(this.arcIndex, this.arc.length - 1)];
    this.mesh.position.copy(pos);
    return;
  }

  if (this.passTarget) {
    // Flying toward pass target — no gravity for passes (chest-height line drive)
    const toTarget = new THREE.Vector3().subVectors(this.passTarget, this.mesh.position);
    if (toTarget.length() < 0.5) {
      this.isInFlight = false;
      this.passTarget = null;
      this.velocity.set(0, 0, 0);
    }
    // Move toward target without gravity
    this.mesh.position.addScaledVector(this.velocity, dt);
    return;
  }

  // Physics (gravity + bounce) — only for loose/bouncing ball
  this.velocity.y -= 9.81 * dt;
  this.mesh.position.addScaledVector(this.velocity, dt);
  if (this.mesh.position.y < 0.12) {
    this.mesh.position.y = 0.12;
    this.velocity.y = -this.velocity.y * 0.6;
    if (Math.abs(this.velocity.y) < 0.5) {
      this.velocity.y = 0;
      this.isInFlight = false;
      this.passTarget = null;
    }
  }
}
```

- [ ] **Step 4: Run all ball tests**

Run: `npx vitest run tests/game/ball.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/ball.ts tests/game/ball.test.ts
git commit -m "feat: add ball flight state, arc animation, holder tracking, and passing"
```

---

### Task 2: Shot Detector

**Files:**
- Create: `src/game/shot-detector.ts`
- Test: `tests/game/shot-detector.test.ts`

- [ ] **Step 1: Write shot detector tests**

Create `tests/game/shot-detector.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { ShotDetector } from '@/game/shot-detector';
import * as THREE from 'three';
import { COURT_DIMENSIONS } from '@/game/court';

describe('ShotDetector', () => {
  const hoopPos = COURT_DIMENSIONS.hoopPosition;
  const detector = new ShotDetector();

  it('detects made shot when ball passes through hoop', () => {
    // Ball position very close to hoop, descending
    const result = detector.check(
      new THREE.Vector3(hoopPos.x, hoopPos.y + 0.1, hoopPos.z),
      new THREE.Vector3(0, -2, 0), // downward velocity
      true // in flight
    );
    expect(result.made).toBe(true);
  });

  it('does not detect when ball is far from hoop', () => {
    const result = detector.check(
      new THREE.Vector3(5, 2, 5),
      new THREE.Vector3(0, -1, 0),
      true
    );
    expect(result.made).toBe(false);
  });

  it('does not detect when ball is not in flight', () => {
    const result = detector.check(
      new THREE.Vector3(hoopPos.x, hoopPos.y, hoopPos.z),
      new THREE.Vector3(0, -1, 0),
      false // not in flight
    );
    expect(result.made).toBe(false);
  });

  it('classifies inside arc as layup/mid-range', () => {
    const result = detector.classifyShot(new THREE.Vector3(0, 1, -2)); // close to hoop
    expect(['layup', 'mid-range']).toContain(result);
  });

  it('classifies outside arc as three-pointer', () => {
    const result = detector.classifyShot(new THREE.Vector3(0, 1, 5)); // far from hoop
    expect(result).toBe('three-pointer');
  });

  it('classifies very close as dunk when flagged', () => {
    const result = detector.classifyShot(new THREE.Vector3(0, 1, -5), true);
    expect(result).toBe('dunk');
  });

  it('prevents double-detection with cooldown', () => {
    const d = new ShotDetector();
    const r1 = d.check(
      new THREE.Vector3(hoopPos.x, hoopPos.y + 0.1, hoopPos.z),
      new THREE.Vector3(0, -2, 0), true
    );
    expect(r1.made).toBe(true);
    // Immediately check again — should be on cooldown
    const r2 = d.check(
      new THREE.Vector3(hoopPos.x, hoopPos.y + 0.1, hoopPos.z),
      new THREE.Vector3(0, -2, 0), true
    );
    expect(r2.made).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/game/shot-detector.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement shot detector**

Create `src/game/shot-detector.ts`:
```typescript
import * as THREE from 'three';
import { COURT_DIMENSIONS } from './court';
import type { ShotType } from '@/core/types';

export interface ShotCheckResult {
  made: boolean;
  shotType?: ShotType;
}

export class ShotDetector {
  private cooldown = 0;
  private readonly HOOP_RADIUS = 0.4; // detection radius around hoop
  private readonly HOOP_Y_TOLERANCE = 0.5; // vertical tolerance

  check(ballPosition: THREE.Vector3, ballVelocity: THREE.Vector3, inFlight: boolean): ShotCheckResult {
    if (!inFlight || this.cooldown > 0) {
      return { made: false };
    }

    const hoop = COURT_DIMENSIONS.hoopPosition;
    const dx = ballPosition.x - hoop.x;
    const dz = ballPosition.z - hoop.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const verticalDist = Math.abs(ballPosition.y - hoop.y);

    // Ball must be close to hoop horizontally and vertically, and descending
    if (horizontalDist < this.HOOP_RADIUS && verticalDist < this.HOOP_Y_TOLERANCE && ballVelocity.y < 0) {
      this.cooldown = 1; // 1 second cooldown
      return { made: true };
    }

    return { made: false };
  }

  classifyShot(shooterPosition: THREE.Vector3, isDunk = false): ShotType {
    if (isDunk) return 'dunk';

    const hoop = COURT_DIMENSIONS.hoopPosition;
    const dx = shooterPosition.x - hoop.x;
    const dz = shooterPosition.z - hoop.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 2) return 'layup';
    if (dist < COURT_DIMENSIONS.threePointRadius) return 'mid-range';
    return 'three-pointer';
  }

  tick(dt: number): void {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
    }
  }

  reset(): void {
    this.cooldown = 0;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/game/shot-detector.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/shot-detector.ts tests/game/shot-detector.test.ts
git commit -m "feat: add shot detector with hoop proximity check, shot classification, and cooldown"
```

---

### Task 3: Enhance GamePlayer for Ball Handling

**Files:**
- Modify: `src/game/player.ts`
- Test: `tests/game/player.test.ts` (add new tests)

- [ ] **Step 1: Write new player tests**

Add to `tests/game/player.test.ts`:
```typescript
describe('GamePlayer - ball handling', () => {
  it('tracks hasBall state', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test', stats: createDefaultPlayerStats(), personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);
    expect(player.hasBall).toBe(false);
    player.giveBall();
    expect(player.hasBall).toBe(true);
    player.loseBall();
    expect(player.hasBall).toBe(false);
  });

  it('moveByInput moves player directly from joystick input', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test', stats: createDefaultPlayerStats(), personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);
    player.moveByInput(0.5, -0.5, 1 / 60); // right and forward
    expect(player.group.position.x).toBeGreaterThan(0);
    expect(player.group.position.z).toBeLessThan(0);
  });

  it('computes distance to point', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test', stats: createDefaultPlayerStats(), personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(3, 0, 4), 0x3498db);
    const dist = player.distanceTo(new THREE.Vector3(0, 0, 0));
    expect(dist).toBeCloseTo(5, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

Run: `npx vitest run tests/game/player.test.ts`
Expected: Original 4 PASS, new 3 FAIL

- [ ] **Step 3: Implement player enhancements**

Add to `src/game/player.ts` class body:

```typescript
hasBall = false;
aiTarget: THREE.Vector3 | null = null; // used by AI to set movement targets

giveBall(): void {
  this.hasBall = true;
}

loseBall(): void {
  this.hasBall = false;
}

moveByInput(inputX: number, inputZ: number, dt: number): void {
  if (inputX === 0 && inputZ === 0) return;
  const direction = new THREE.Vector3(inputX, 0, inputZ).normalize();
  const step = this.moveSpeed * dt;
  this.group.position.addScaledVector(direction, step);

  // Clamp to court bounds
  this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -7, 7);
  this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -6.5, 6.5);

  // Face movement direction
  const angle = Math.atan2(-direction.x, -direction.z);
  this.group.rotation.y = angle;
}

distanceTo(point: THREE.Vector3): number {
  const dx = this.group.position.x - point.x;
  const dz = this.group.position.z - point.z;
  return Math.sqrt(dx * dx + dz * dz);
}

get position(): THREE.Vector3 {
  return this.group.position;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/game/player.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/player.ts tests/game/player.test.ts
git commit -m "feat: add ball handling, input-driven movement, and distance utility to player"
```

---

## Chunk 2: Game Session — The Orchestrator

### Task 4: Game Session Core

**Files:**
- Create: `src/game/game-session.ts`
- Test: `tests/game/game-session.test.ts`

This is the central new file. It manages an entire 3v3 match.

- [ ] **Step 1: Write game session tests**

Create `tests/game/game-session.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { GameSession } from '@/game/game-session';
import { EventBus } from '@/core/events';
import { createDefaultPlayerStats } from '@/core/types';
import type { TeamData, PlayerData } from '@/core/types';
import * as THREE from 'three';

function makePlayer(id: string, personality: string = 'Team Player'): PlayerData {
  return { id, name: `Player ${id}`, stats: createDefaultPlayerStats(), personality: personality as any, isCustom: false };
}

function makeTeam(id: string, name: string, archetype: string = 'Balanced'): TeamData {
  return {
    id, name, mascot: 'Test', colors: { primary: '#ff0000', secondary: '#0000ff' },
    archetype: archetype as any, seed: 8,
    players: [makePlayer(`${id}-1`), makePlayer(`${id}-2`), makePlayer(`${id}-3`)],
  };
}

describe('GameSession', () => {
  it('initializes with 6 players on court', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    expect(session.homePlayers).toHaveLength(3);
    expect(session.awayPlayers).toHaveLength(3);
  });

  it('gives ball to a home player at start', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    const holders = [...session.homePlayers, ...session.awayPlayers].filter(p => p.hasBall);
    expect(holders).toHaveLength(1);
  });

  it('human player moves with input', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    const humanPlayer = session.getHumanPlayer();
    const startX = humanPlayer.position.x;
    session.processInput({ joystick: { x: 1, y: 0 }, gesture: null }, 1 / 60);
    expect(humanPlayer.position.x).toBeGreaterThan(startX);
  });

  it('ball follows the holder each frame', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    const holder = session.getAllPlayers().find(p => p.hasBall)!;
    session.update(1 / 60);
    // Ball should be near the holder
    const dist = session.ball.mesh.position.distanceTo(holder.position);
    expect(dist).toBeLessThan(2);
  });

  it('AI players move each frame', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    const aiPlayer = session.homePlayers.find(p => p.data.id !== 'h-1')!;
    const startPos = aiPlayer.position.clone();
    // Run several frames for AI to make decisions and move
    for (let i = 0; i < 30; i++) session.update(1 / 60);
    const moved = startPos.distanceTo(aiPlayer.position) > 0.01;
    expect(moved).toBe(true);
  });

  it('swipe-up gesture triggers a shot when human has ball', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    // Give ball to human
    session.setBallHolder('h-1');
    session.processInput({
      joystick: { x: 0, y: 0 },
      gesture: { type: 'swipe-up', power: 0.8, direction: { x: 0, y: -1 } },
    }, 1 / 60);
    expect(session.ball.isInFlight).toBe(true);
  });

  it('returns current camera target based on possession', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    const target = session.getCameraInfo();
    expect(target.mode).toBeDefined();
    expect(target.trackPosition).toBeDefined();
  });

  it('detects made shot and updates score', () => {
    const events = new EventBus();
    const scoreHandler = vi.fn();
    events.on('score', scoreHandler);
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    // Manually trigger a made shot scenario
    session.handleMadeShot('home', 'three-pointer');
    expect(scoreHandler).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/game/game-session.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement GameSession**

Create `src/game/game-session.ts`:

```typescript
import * as THREE from 'three';
import type { TeamData, Possession, ShotType } from '@/core/types';
import type { EventBus } from '@/core/events';
import type { ControlInput, GestureResult } from './controls';
import type { CameraMode } from './camera';
import { GamePlayer } from './player';
import { Ball } from './ball';
import { MatchEngine } from './match';
import { ShotDetector } from './shot-detector';
import { PlayerAI, type AIContext } from '@/ai/player-ai';
import { TeamAI } from '@/ai/team-ai';
import { COURT_DIMENSIONS } from './court';

interface CameraInfo {
  mode: CameraMode;
  trackPosition: THREE.Vector3;
  lookAt: THREE.Vector3;
}

export class GameSession {
  homePlayers: GamePlayer[] = [];
  awayPlayers: GamePlayer[] = [];
  ball: Ball;
  matchEngine: MatchEngine;

  private events: EventBus;
  private humanPlayerId: string;
  private shotDetector = new ShotDetector();
  private playerAIs = new Map<string, PlayerAI>();
  private homeTeamAI: TeamAI;
  private awayTeamAI: TeamAI;
  private scene: THREE.Scene | null = null;
  private aiDecisionTimer = 0;
  private readonly AI_DECISION_INTERVAL = 0.5; // seconds between AI decisions

  constructor(events: EventBus, homeTeam: TeamData, awayTeam: TeamData, humanPlayerId: string) {
    this.events = events;
    this.humanPlayerId = humanPlayerId;
    this.ball = new Ball(new THREE.Vector3(0, 1, 2));
    this.matchEngine = new MatchEngine(events, homeTeam, awayTeam);
    this.homeTeamAI = new TeamAI(homeTeam.archetype);
    this.awayTeamAI = new TeamAI(awayTeam.archetype);

    // Spawn home team players
    const homeColor = parseInt(homeTeam.colors.primary.replace('#', ''), 16) || 0x3498db;
    const homePositions = [
      new THREE.Vector3(-3, 0, 2),
      new THREE.Vector3(3, 0, 2),
      new THREE.Vector3(0, 0, 5),
    ];
    homeTeam.players.forEach((pd, i) => {
      const gp = new GamePlayer(pd, homePositions[i], homeColor);
      this.homePlayers.push(gp);
      this.playerAIs.set(pd.id, new PlayerAI(pd.stats, pd.personality));
    });

    // Spawn away team players
    const awayColor = parseInt(awayTeam.colors.primary.replace('#', ''), 16) || 0xe74c3c;
    const awayPositions = [
      new THREE.Vector3(-2, 0, -2),
      new THREE.Vector3(2, 0, -2),
      new THREE.Vector3(0, 0, -4),
    ];
    awayTeam.players.forEach((pd, i) => {
      const gp = new GamePlayer(pd, awayPositions[i], awayColor);
      this.awayPlayers.push(gp);
      this.playerAIs.set(pd.id, new PlayerAI(pd.stats, pd.personality));
    });
  }

  addToScene(scene: THREE.Scene): void {
    this.scene = scene;
    scene.add(this.ball.mesh);
    for (const p of this.getAllPlayers()) {
      scene.add(p.group);
    }
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.ball.mesh);
    for (const p of this.getAllPlayers()) {
      scene.remove(p.group);
    }
    this.scene = null;
  }

  start(): void {
    // Give ball to first home player
    this.setBallHolder(this.homePlayers[0].data.id);
    this.matchEngine.state.phase = 'playing';
    this.matchEngine.state.possession = 'home';
  }

  update(dt: number): void {
    // Update ball position
    if (this.ball.heldBy) {
      const holder = this.getPlayerById(this.ball.heldBy);
      if (holder) this.ball.followHolder(holder.position);
    } else {
      this.ball.update(dt);
    }

    // Shot detection (tick cooldown every frame, check only when in flight)
    this.shotDetector.tick(dt);
    if (this.ball.isInFlight) {
      const result = this.shotDetector.check(
        this.ball.mesh.position,
        this.ball.velocity,
        this.ball.isInFlight
      );
      if (result.made) {
        const shooter = this.getLastShooter();
        const team = this.getPlayerTeam(shooter);
        const shotType = this.shotDetector.classifyShot(
          shooter ? this.getPlayerById(shooter)!.position : this.ball.mesh.position
        );
        this.handleMadeShot(team, shotType);
      }
    }

    // Check for loose ball pickup
    if (!this.ball.heldBy && !this.ball.isInFlight) {
      this.checkBallPickup();
    }

    // AI decisions
    this.aiDecisionTimer += dt;
    if (this.aiDecisionTimer >= this.AI_DECISION_INTERVAL) {
      this.aiDecisionTimer = 0;
      this.runAIDecisions(dt);
    }

    // Move AI players toward their targets
    this.moveAIPlayers(dt);

    // Update match engine clock
    if (this.matchEngine.state.phase === 'playing') {
      this.matchEngine.tickClock(dt);
    }
  }

  processInput(input: ControlInput, dt: number): void {
    const human = this.getHumanPlayer();
    if (!human) return;

    // Move with joystick
    human.moveByInput(input.joystick.x, input.joystick.y, dt);

    // Process gesture (consume it so it doesn't repeat next frame)
    if (input.gesture) {
      this.handleGesture(input.gesture, human);
      input.gesture = null;
    }
  }

  private handleGesture(gesture: GestureResult, human: GamePlayer): void {
    const hasBall = human.hasBall;

    switch (gesture.type) {
      case 'swipe-up':
        if (hasBall) {
          // Shoot
          human.loseBall();
          this.lastShooterId = human.data.id;
          this.ball.shootAt(COURT_DIMENSIONS.hoopPosition, gesture.power);
        }
        break;

      case 'swipe-down':
        if (hasBall && human.distanceTo(COURT_DIMENSIONS.hoopPosition) < 3) {
          // Dunk attempt
          human.loseBall();
          this.lastShooterId = human.data.id;
          this.ball.shootAt(COURT_DIMENSIONS.hoopPosition, 1.0);
        }
        break;

      case 'pass':
        if (hasBall) {
          const teammate = this.findNearestTeammate(human);
          if (teammate) {
            human.loseBall();
            this.ball.passTo(teammate.position);
            this.pendingPassTarget = teammate.data.id;
          }
        }
        break;

      case 'tap':
        if (!hasBall) {
          // Steal attempt
          this.attemptSteal(human);
        }
        break;

      case 'double-tap':
        // Switch controlled player or call screen
        break;
    }
  }

  private lastShooterId: string | null = null;
  private pendingPassTarget: string | null = null;

  private getLastShooter(): string | null {
    return this.lastShooterId;
  }

  handleMadeShot(team: Possession, shotType: ShotType): void {
    this.matchEngine.score(team, shotType);
    this.ball.isInFlight = false;
    // Reset for check-ball
    this.resetAfterScore(team === 'home' ? 'away' : 'home');
  }

  private resetAfterScore(receivingTeam: Possession): void {
    this.shotDetector.reset();
    // Move ball to check-ball position
    this.ball.mesh.position.set(0, 1, COURT_DIMENSIONS.checkBallLine);
    this.ball.velocity.set(0, 0, 0);
    // Give ball to receiving team's first player
    const receiver = receivingTeam === 'home' ? this.homePlayers[0] : this.awayPlayers[0];
    this.setBallHolder(receiver.data.id);
    this.matchEngine.checkBallComplete(receivingTeam);
  }

  setBallHolder(playerId: string): void {
    // Clear old holder
    for (const p of this.getAllPlayers()) {
      p.loseBall();
    }
    const player = this.getPlayerById(playerId);
    if (player) {
      player.giveBall();
      this.ball.pickup(playerId);
      this.pendingPassTarget = null;
    }
  }

  private checkBallPickup(): void {
    for (const p of this.getAllPlayers()) {
      if (p.distanceTo(this.ball.mesh.position) < 1.0) {
        this.setBallHolder(p.data.id);

        // If this was a pass completion
        if (this.pendingPassTarget === p.data.id) {
          const passer = this.lastShooterId; // reuse for assist tracking
          this.pendingPassTarget = null;
        }
        break;
      }
    }
  }

  private attemptSteal(stealer: GamePlayer): void {
    const ballHolder = this.getAllPlayers().find(p => p.hasBall);
    if (!ballHolder) return;
    if (stealer.distanceTo(ballHolder.position) > 2) return;

    // 30% chance of steal, 30% chance of foul
    const roll = Math.random();
    if (roll < 0.3) {
      // Successful steal
      ballHolder.loseBall();
      ballHolder.recordStat('turnovers', 1);
      this.setBallHolder(stealer.data.id);
      stealer.recordStat('assists', 0); // just possession change
    } else if (roll < 0.6) {
      // Foul
      const stealerTeam = this.getPlayerTeam(stealer.data.id);
      this.matchEngine.callFoul(stealerTeam);
    }
    // else: failed attempt, nothing happens
  }

  private runAIDecisions(_dt: number): void {
    const scoreDiff = this.matchEngine.state.homeScore - this.matchEngine.state.awayScore;
    const clock = this.matchEngine.state.clockSeconds;

    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue; // Skip human

      const ai = this.playerAIs.get(player.data.id);
      if (!ai) continue;

      const ctx: AIContext = {
        hasBall: player.hasBall,
        distanceToHoop: player.distanceTo(COURT_DIMENSIONS.hoopPosition),
        nearestDefenderDist: this.getNearestOpponentDist(player),
        teammateOpenness: this.getTeammateOpenness(player),
        scoreDiff: this.isHomePlayer(player) ? scoreDiff : -scoreDiff,
        clockSeconds: clock,
      };

      const decision = ai.decide(ctx);

      // Execute AI decision
      switch (decision.action) {
        case 'shoot':
          if (player.hasBall) {
            player.loseBall();
            this.lastShooterId = player.data.id;
            this.ball.shootAt(COURT_DIMENSIONS.hoopPosition, 0.5 + Math.random() * 0.3);
          }
          break;
        case 'pass':
          if (player.hasBall && decision.targetIndex !== undefined) {
            const teammates = this.getTeammates(player);
            const target = teammates[decision.targetIndex % teammates.length];
            if (target) {
              player.loseBall();
              this.ball.passTo(target.position);
              this.pendingPassTarget = target.data.id;
            }
          }
          break;
        case 'drive':
          // Move toward hoop
          player.aiTarget = COURT_DIMENSIONS.hoopPosition.clone();
          break;
        case 'dunk':
          if (player.hasBall && player.distanceTo(COURT_DIMENSIONS.hoopPosition) < 3) {
            player.loseBall();
            this.lastShooterId = player.data.id;
            this.ball.shootAt(COURT_DIMENSIONS.hoopPosition, 1.0);
          }
          break;
        case 'steal':
          this.attemptSteal(player);
          break;
        case 'guard':
        case 'block':
          // Move toward ball holder
          const holder = this.getAllPlayers().find(p => p.hasBall);
          if (holder) {
            player.aiTarget = holder.position.clone();
          }
          break;
        default:
          // idle / screen — move to formation position
          this.moveToFormation(player);
          break;
      }
    }
  }

  private findNearestTeammate(player: GamePlayer): GamePlayer | null {
    const teammates = this.getTeammates(player);
    let nearest: GamePlayer | null = null;
    let minDist = Infinity;
    for (const tm of teammates) {
      const d = player.distanceTo(tm.position);
      if (d < minDist) { minDist = d; nearest = tm; }
    }
    return nearest;
  }

  private moveAIPlayers(dt: number): void {
    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue;
      if (player.aiTarget) {
        player.moveToward(player.aiTarget, dt);
      }
    }
  }

  private moveToFormation(player: GamePlayer): void {
    const isHome = this.isHomePlayer(player);
    const teamAI = isHome ? this.homeTeamAI : this.awayTeamAI;
    const teammates = isHome ? this.homePlayers : this.awayPlayers;
    const idx = teammates.indexOf(player);
    const play = teamAI.choosePlay({
      possession: this.matchEngine.state.possession,
      scoreDiff: this.matchEngine.state.homeScore - this.matchEngine.state.awayScore,
      clockSeconds: this.matchEngine.state.clockSeconds,
    });
    const positions = TeamAI.getFormationPositions(play.formation);
    if (positions[idx]) {
      player.aiTarget = new THREE.Vector3(positions[idx].x, 0, positions[idx].z);
    }
  }

  // --- Helpers ---

  getHumanPlayer(): GamePlayer {
    return this.getAllPlayers().find(p => p.data.id === this.humanPlayerId)!;
  }

  getAllPlayers(): GamePlayer[] {
    return [...this.homePlayers, ...this.awayPlayers];
  }

  getPlayerById(id: string): GamePlayer | undefined {
    return this.getAllPlayers().find(p => p.data.id === id);
  }

  getPlayerTeam(playerId: string | null): Possession {
    if (!playerId) return 'home';
    return this.homePlayers.some(p => p.data.id === playerId) ? 'home' : 'away';
  }

  isHomePlayer(player: GamePlayer): boolean {
    return this.homePlayers.includes(player);
  }

  getTeammates(player: GamePlayer): GamePlayer[] {
    const team = this.isHomePlayer(player) ? this.homePlayers : this.awayPlayers;
    return team.filter(p => p !== player);
  }

  private getNearestOpponentDist(player: GamePlayer): number {
    const opponents = this.isHomePlayer(player) ? this.awayPlayers : this.homePlayers;
    let minDist = Infinity;
    for (const opp of opponents) {
      const d = player.distanceTo(opp.position);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  private getTeammateOpenness(player: GamePlayer): number[] {
    const teammates = this.getTeammates(player);
    const opponents = this.isHomePlayer(player) ? this.awayPlayers : this.homePlayers;
    return teammates.map(tm => {
      let minOppDist = Infinity;
      for (const opp of opponents) {
        const d = tm.distanceTo(opp.position);
        if (d < minOppDist) minOppDist = d;
      }
      return Math.min(1, minOppDist / 5); // 0-1 openness
    });
  }

  getCameraInfo(): CameraInfo {
    const possession = this.matchEngine.state.possession;
    const humanTeam = this.getPlayerTeam(this.humanPlayerId);
    const human = this.getHumanPlayer();
    const ballHolder = this.getAllPlayers().find(p => p.hasBall);
    const trackTarget = ballHolder?.position ?? human.position;

    let mode: CameraMode;
    if (this.ball.isInFlight) {
      mode = 'offense'; // follow the shot
    } else if (possession === humanTeam) {
      mode = 'offense';
    } else {
      mode = 'defense';
    }

    return {
      mode,
      trackPosition: trackTarget.clone(),
      lookAt: COURT_DIMENSIONS.hoopPosition.clone(),
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/game/game-session.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/game-session.ts tests/game/game-session.test.ts
git commit -m "feat: add GameSession orchestrator for playable 3v3 matches"
```

---

## Chunk 3: Wire Into Main & Quick Play

### Task 5: Wire GameSession into main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update main.ts**

Key changes to make:

1. **Add `MainMenu -> YourGame` transition** to the transitions array for quick play bypass
2. **Import GameSession** from `./game/game-session`
3. **Remove test player** creation (the `testPlayer` variable and its `scene.add`)
4. **Add `let session: GameSession | null = null;`** variable at module level
5. **Add `startQuickGame()` function:**
```typescript
function startQuickGame(): void {
  const teams = generateTeams();
  session = new GameSession(gameEvents, teams[0], teams[1], teams[0].players[0].id);
  session.addToScene(scene);
  session.start();
  stateMachine.transition('YourGame');
}
```
6. **Add 'quick-play' to `handleMenuAction`:**
```typescript
if (action === 'quick-play') startQuickGame();
```
7. **Update `update(dt)` to use session:**
```typescript
function update(dt: number): void {
  if (session && stateMachine.current === 'YourGame') {
    // Get combined input from touch or keyboard
    const touchInput = touchControls.getInput();
    const kbInput = keyboardControls.getInput();
    const input: ControlInput = {
      joystick: {
        x: touchInput.joystick.x || kbInput.joystick.x,
        y: touchInput.joystick.y || kbInput.joystick.y,
      },
      gesture: touchInput.gesture ?? kbInput.gesture,
    };
    session.processInput(input, dt);
    session.update(dt);

    // Camera
    const camInfo = session.getCameraInfo();
    cameraSystem.setMode(camInfo.mode);
    cameraSystem.update(camInfo.trackPosition, camInfo.lookAt, dt);

    // HUD
    hud.updateScore(session.matchEngine.state.homeScore, session.matchEngine.state.awayScore);
    hud.updateClock(session.matchEngine.state.clockSeconds);
    hud.updateCrowdLevel(crowdSystem.level);

    // Systems
    powerupSystem.tick(dt);
    crowdSystem.tick(dt);
    const diff = session.matchEngine.getScoreDifferential();
    if (diff) {
      powerupSystem.update(diff.deficit, dt);
      crowdSystem.updateScoreDiff(diff.deficit);
    }
  }
}
```
8. **Wire gesture callbacks** to pass into session via the existing `onGesture` hooks — or simply rely on `getInput()` polling which already captures the last gesture
9. **Remove standalone `matchEngine`, `ball`, `testPlayer`** variables since GameSession owns these now

- [ ] **Step 2: Verify build**

Run: `npx vite build`
Expected: Exit 0

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire GameSession into main loop with quick play for testing"
```

---

### Task 6: Manual Play Test & Polish

**Files:**
- Possibly modify: `src/game/game-session.ts`, `src/main.ts`

- [ ] **Step 1: Start dev server and test in browser**

Run: `npx vite`
Open in browser. Click Quick Play (or press a key to skip menu).

Verify:
- Court renders with 6 players (3 blue, 3 red)
- Ball is visible and attached to a player
- WASD/joystick moves your player
- Space/swipe-up shoots the ball in an arc toward the hoop
- AI players move around the court
- Camera follows the action
- Score updates on the HUD when shots go in
- After a score, ball resets for check-ball

- [ ] **Step 2: Fix any issues found during manual testing**

Common issues to watch for:
- Ball arc not reaching hoop (adjust `calculateArc` parameters)
- Shot detection too sensitive/not sensitive enough (adjust `HOOP_RADIUS`)
- AI players standing still (check `AI_DECISION_INTERVAL` and formation positions)
- Camera jumping (check lerp speed)
- Players going off-court (verify bounds clamping)

- [ ] **Step 3: Run all tests to confirm no regressions**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Phase 2A complete — playable 3v3 game with input, AI, scoring, and camera"
```

---
