# Possession Authority + Camera Zoom + Auto-Switch — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix possession desync bugs (teams driving to wrong basket), make camera zoom actually work, and auto-switch human control on rebound pickup.

**Architecture:** Three independent fixes in game-session.ts, match.ts, camera.ts, and main.ts. The possession fix centralizes all possession changes into a single `changePossession()` method. The camera fix tracks actual player X positions and adjusts zoom constants. The auto-switch adds rebound detection to `checkBallPickup()`.

**Tech Stack:** Three.js, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-18-possession-camera-autoswitch.md`

---

## Chunk 1: Possession Authority System (Tasks 1-2)

### Task 1: Central `changePossession()` + Fix All Callers

**Files:**
- Modify: `src/game/game-session.ts`
- Modify: `src/game/match.ts`
- Test: `tests/game/possession-sync.test.ts`

- [ ] **Step 1: Add `changePossession()` method and `passProtectionTimer` field to game-session.ts**

In `src/game/game-session.ts`, add a new field after `private inboundTargetId` (line 58):

```typescript
private passProtectionTimer = 0;
```

Add the new method after `getPlayerTeam()` (after line 468):

```typescript
private changePossession(newTeam: 'home' | 'away', reason: string): void {
  const oldTeam = this.matchEngine.state.possession;
  if (oldTeam !== newTeam) {
    console.log(`[POSSESSION] ${oldTeam} → ${newTeam} (${reason})`);
  }
  this.matchEngine.state.possession = newTeam;
  this.matchEngine.resetShotClock();
  this.aiShootTimer = 0;
}
```

- [ ] **Step 2: Replace all direct `matchEngine.state.possession =` writes with `changePossession()`**

There are 6 locations in game-session.ts that directly write possession. Replace each one:

**Location 1: `start()` (line 184)**

Replace:
```typescript
this.matchEngine.state.possession = 'home';
```
With:
```typescript
this.changePossession('home', 'game start');
```

**Location 2: `checkBallPickup()` (line 1031)**

Replace the entire possession-change block (lines 1027-1034):
```typescript
        // CRITICAL: Update possession to match who actually has the ball
        const pickupTeam = this.getPlayerTeam(p.data.id);
        if (this.matchEngine.state.possession !== pickupTeam) {
          console.log(`[POSSESSION CHANGE] ${this.matchEngine.state.possession} → ${pickupTeam} (ball pickup by ${p.data.id})`);
          this.matchEngine.state.possession = pickupTeam;
          this.matchEngine.resetShotClock();
          this.aiShootTimer = 0;
        }
```
With:
```typescript
        // Update possession to match who actually has the ball
        const pickupTeam = this.getPlayerTeam(p.data.id);
        if (this.matchEngine.state.possession !== pickupTeam) {
          this.changePossession(pickupTeam, `ball pickup by ${p.data.id}`);
        }
```

**Location 3: `attemptSteal()` (lines 1057-1063)**

Replace the possession block inside the steal success branch:
```typescript
      // Update possession on steal
      const stealerTeam = this.getPlayerTeam(stealer.data.id);
      if (this.matchEngine.state.possession !== stealerTeam) {
        console.log(`[POSSESSION CHANGE] ${this.matchEngine.state.possession} → ${stealerTeam} (steal by ${stealer.data.id})`);
        this.matchEngine.state.possession = stealerTeam;
        this.matchEngine.resetShotClock();
        this.aiShootTimer = 0;
      }
```
With:
```typescript
      // Update possession on steal
      const stealerTeam = this.getPlayerTeam(stealer.data.id);
      if (this.matchEngine.state.possession !== stealerTeam) {
        this.changePossession(stealerTeam, `steal by ${stealer.data.id}`);
      }
```

**Location 4: Ball out of bounds handler (line 334)**

Replace:
```typescript
        this.matchEngine.state.possession = otherTeam;
```
With:
```typescript
        this.changePossession(otherTeam, 'ball out of bounds');
```

**Location 5: Desync check in `runAI()` (lines 701-708)**

Move this block OUT of `runAI()` and into the top of `update()` (after the inbound auto-pass section, before the dead ball phase check). Replace:
```typescript
    // SANITY CHECK: possession MUST match who actually has the ball
    if (this.ball.heldBy) {
      const holderTeam = this.getPlayerTeam(this.ball.heldBy);
      if (this.matchEngine.state.possession !== holderTeam) {
        console.warn(`[POSSESSION DESYNC] state says ${this.matchEngine.state.possession} but ${holderTeam} has ball (${this.ball.heldBy}). Fixing.`);
        this.matchEngine.state.possession = holderTeam;
        this.matchEngine.resetShotClock();
        this.aiShootTimer = 0;
      }
    }
```
With (in `update()`, after the inbound auto-pass block):
```typescript
    // GLOBAL DESYNC CHECK: runs every frame, not just during runAI
    if (this.ball.heldBy) {
      const holderTeam = this.getPlayerTeam(this.ball.heldBy);
      if (this.matchEngine.state.possession !== holderTeam) {
        this.changePossession(holderTeam, `desync fix — ${this.ball.heldBy} holds ball`);
      }
    }
```
And DELETE the old desync check from inside `runAI()`.

**Location 6: `enterDeadBall()` (line 648)**

Currently calls `this.matchEngine.checkBallComplete(receivingTeam)` which sets possession inside match.ts. Replace line 648:
```typescript
    this.matchEngine.checkBallComplete(receivingTeam);
```
With:
```typescript
    this.changePossession(receivingTeam, 'dead ball inbound');
    this.matchEngine.state.phase = 'playing';
```
And remove line 650 (`this.matchEngine.state.phase = 'playing';`) since it's now included above. Also remove the duplicate `this.aiShootTimer = 0;` on line 651 since `changePossession` handles it.

- [ ] **Step 3: Fix `match.ts` — remove direct possession flip from shot clock violation**

In `src/game/match.ts`, change the shot clock violation block (lines 92-97):

Replace:
```typescript
      if (this.state.shotClockSeconds <= 0) {
        this.state.shotClockSeconds = 24;
        const violatingTeam = this.state.possession;
        this.state.possession = this.state.possession === 'home' ? 'away' : 'home';
        this.events.emit('shot-clock-violation', { violatingTeam });
      }
```
With:
```typescript
      if (this.state.shotClockSeconds <= 0) {
        this.state.shotClockSeconds = 24;
        const violatingTeam = this.state.possession;
        // Do NOT flip possession here — game-session handles it via the event
        this.events.emit('shot-clock-violation', { violatingTeam });
      }
```

Then in `src/game/game-session.ts`, update the shot-clock-violation event handler (lines 68-73):

Replace:
```typescript
    this.events.on('shot-clock-violation', () => {
      // Proper turnover — inbound to the other team
      const receivingTeam = this.matchEngine.state.possession;
      this.enterDeadBall(receivingTeam);
      this.events.emit('splash', { text: 'SHOT CLOCK!', color: '#ff6600' });
    });
```
With:
```typescript
    this.events.on('shot-clock-violation', (data: { violatingTeam: string }) => {
      // Proper turnover — inbound to the other team
      const receivingTeam: 'home' | 'away' = data.violatingTeam === 'home' ? 'away' : 'home';
      this.enterDeadBall(receivingTeam);
      this.events.emit('splash', { text: 'SHOT CLOCK!', color: '#ff6600' });
    });
```

- [ ] **Step 4: Fix `callFoul()` — enter dead ball after foul**

In `src/game/game-session.ts`, in `attemptSteal()`, after the `callFoul` call (line 1067):

Replace:
```typescript
    } else if (roll < 0.6) {
      const stealerTeam = this.getPlayerTeam(stealer.data.id);
      this.matchEngine.callFoul(stealerTeam);
    }
```
With:
```typescript
    } else if (roll < 0.6) {
      const stealerTeam = this.getPlayerTeam(stealer.data.id);
      this.matchEngine.callFoul(stealerTeam);
      // Foul results in dead ball — receiving team inbounds
      const receivingTeam: 'home' | 'away' = stealerTeam === 'home' ? 'away' : 'home';
      this.enterDeadBall(receivingTeam);
    }
```

- [ ] **Step 5: Add pass protection timer**

In `src/game/game-session.ts`, wherever `pendingPassTarget` is set (two locations: the pass gesture handler ~line 590, and `handleBallHandlerAI` ~line 939), also set `passProtectionTimer = 0.3`:

After `this.pendingPassTarget = teammate.data.id;` in the pass gesture (line 590), add:
```typescript
            this.passProtectionTimer = 0.3;
```

After `this.pendingPassTarget = openMate.data.id;` in handleBallHandlerAI (line 939), add:
```typescript
        this.passProtectionTimer = 0.3;
```

In `update()`, tick the timer (add right after the inbound timer block, before the desync check):
```typescript
    // Pass protection timer
    if (this.passProtectionTimer > 0) {
      this.passProtectionTimer -= dt;
    }
```

- [ ] **Step 6: Rewrite `checkBallPickup()` — closest player wins, pass protection, auto-switch**

Replace the entire `checkBallPickup()` method:

```typescript
  private checkBallPickup(): void {
    const ballPos = this.ball.mesh.position;
    let closest: GamePlayer | null = null;
    let closestDist = 1.0; // pickup radius

    for (const p of this.getAllPlayers()) {
      const d = p.distanceTo(ballPos);
      if (d < closestDist) {
        // During pass protection, only same-team players can pick up
        if (this.passProtectionTimer > 0 && this.pendingPassTarget) {
          const passTeam = this.getPlayerTeam(this.pendingPassTarget);
          const playerTeam = this.getPlayerTeam(p.data.id);
          if (playerTeam !== passTeam) continue; // skip opponents during protection
        }
        closestDist = d;
        closest = p;
      }
    }

    if (closest) {
      this.setBallHolder(closest.data.id);

      // Update possession to match who actually has the ball
      const pickupTeam = this.getPlayerTeam(closest.data.id);
      if (this.matchEngine.state.possession !== pickupTeam) {
        this.changePossession(pickupTeam, `ball pickup by ${closest.data.id}`);
      }

      // Auto-switch human control on rebound/loose ball pickup
      const humanTeam = this.getPlayerTeam(this.humanPlayerId);
      if (pickupTeam === humanTeam && closest.data.id !== this.humanPlayerId && !this.pendingPassTarget) {
        this.switchHumanControl(closest.data.id);
      }

      if (this.pendingPassTarget === closest.data.id) {
        this.pendingPassTarget = null;
      }
      this.passProtectionTimer = 0;
    }
  }
```

- [ ] **Step 7: Clean up dead code**

Delete `updateDefensiveAutoSwitch()` (lines 963-986) — it's never called and the new auto-switch in `checkBallPickup()` replaces its intent.

Delete `getDefensiveAssignment()` (lines 1085-1089) — it's never called.

In the pass gesture handler (lines 592-597), replace the manual control-switch with:
```typescript
            this.switchHumanControl(teammate.data.id);
```
This replaces:
```typescript
            human.isHumanControlled = false;
            this.playerAIs.set(human.data.id, new PlayerAI(human.data.stats, human.data.personality));

            this.humanPlayerId = teammate.data.id;
            teammate.isHumanControlled = true;
            this.playerAIs.delete(teammate.data.id);
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run`
Expected: All existing tests pass

- [ ] **Step 9: Write new tests for possession authority**

Replace `tests/game/possession-sync.test.ts` with comprehensive tests:

```typescript
import { describe, it, expect } from 'vitest';
import { GameSession } from '@/game/game-session';
import { EventBus } from '@/core/events';
import type { TeamData, PlayerData } from '@/core/types';

function makePlayer(id: string): PlayerData {
  return { id, name: `P${id}`, stats: { speed: 5, shooting: 5, defense: 5, passing: 5, dunkPower: 5 }, personality: 'Team Player' as any, isCustom: false };
}
function makeTeam(id: string, name: string): TeamData {
  return {
    id, name, mascot: 'T', colors: { primary: '#ff0000', secondary: '#0000ff' },
    archetype: 'Balanced' as any, seed: 8,
    players: [makePlayer(`${id}-1`), makePlayer(`${id}-2`), makePlayer(`${id}-3`), makePlayer(`${id}-4`), makePlayer(`${id}-5`)],
  };
}

describe('Possession Authority', () => {
  it('updates possession when opposing team picks up loose ball', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();
    expect(session.matchEngine.state.possession).toBe('home');

    // Ball becomes loose
    session.homePlayers[0].loseBall();
    session.ball.release();
    session.ball.mesh.position.set(0, 1, 0);
    session.ball.velocity.set(0, 0, 0);

    // Move away player close to ball
    session.awayPlayers[0].group.position.set(0, 0, 0.5);
    session.update(1 / 60);

    expect(session.matchEngine.state.possession).toBe('away');
  });

  it('auto-corrects possession desync every frame', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();

    // Create intentional desync
    session.setBallHolder('a-2');
    session.matchEngine.state.possession = 'home'; // WRONG

    session.update(1 / 60);
    expect(session.matchEngine.state.possession).toBe('away');
  });

  it('auto-switches human control on rebound pickup', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();

    // Ball becomes loose
    session.homePlayers[0].loseBall();
    session.ball.release();
    session.ball.mesh.position.set(0, 1, 0);
    session.ball.velocity.set(0, 0, 0);

    // Move h-3 (not the human h-1) close to ball
    session.homePlayers[2].group.position.set(0, 0, 0.5);
    // Move everyone else far away
    session.homePlayers[0].group.position.set(10, 0, 10);
    session.homePlayers[1].group.position.set(10, 0, -10);
    session.homePlayers[3].group.position.set(-10, 0, 10);
    session.homePlayers[4].group.position.set(-10, 0, -10);
    for (const p of session.awayPlayers) p.group.position.set(10, 0, 5);

    session.update(1 / 60);

    // Human control should have switched to h-3
    expect(session.getHumanPlayer().data.id).toBe('h-3');
  });

  it('ball handler targets correct attack hoop after possession change', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();

    session.setBallHolder('a-1');
    session.matchEngine.state.possession = 'away';
    session.awayPlayers[0].group.position.set(0, 0, 0);

    for (let i = 0; i < 60; i++) session.update(1 / 60);

    // Away attacks z=-13
    expect(session.awayPlayers[0].aiTarget!.z).toBeLessThan(0);
  });

  it('shot clock violation gives ball to correct team via event', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();

    // Force shot clock to expire
    session.matchEngine.state.shotClockSeconds = 0.01;
    session.matchEngine.state.possession = 'home';
    session.update(0.02); // tick past shot clock

    // Away should now have possession (home violated)
    expect(session.matchEngine.state.possession).toBe('away');
  });
});
```

- [ ] **Step 10: Run tests and verify**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 11: Build check**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 12: Commit**

```
git add src/game/game-session.ts src/game/match.ts tests/game/possession-sync.test.ts
git commit -m "fix: centralize possession authority — eliminate desync bugs, add auto-switch on rebound, pass protection"
```

---

## Chunk 2: Camera Dynamic Zoom (Task 2)

### Task 2: Fix Camera Zoom Constants + Track Real X Spread

**Files:**
- Modify: `src/game/camera.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Fix `main.ts` — track actual X positions instead of hardcoding**

In `src/main.ts`, replace the player spread calculation block (lines 285-292):

```typescript
    // Compute player spread for dynamic zoom
    const allPlayers = session.getAllPlayers();
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of allPlayers) {
      if (p.position.z < minZ) minZ = p.position.z;
      if (p.position.z > maxZ) maxZ = p.position.z;
    }
    cameraSystem.setPlayerBounds(minZ, maxZ, -7, 7);
```

With:

```typescript
    // Compute player spread for dynamic zoom
    const allPlayers = session.getAllPlayers();
    let minZ = Infinity, maxZ = -Infinity;
    let minX = Infinity, maxX = -Infinity;
    for (const p of allPlayers) {
      if (p.position.z < minZ) minZ = p.position.z;
      if (p.position.z > maxZ) maxZ = p.position.z;
      if (p.position.x < minX) minX = p.position.x;
      if (p.position.x > maxX) maxX = p.position.x;
    }
    cameraSystem.setPlayerBounds(minZ, maxZ, minX, maxX);
```

- [ ] **Step 2: Fix `camera.ts` — adjust zoom constants for realistic spread**

In `src/game/camera.ts`, replace the broadcast zoom calculation (lines 81-86):

```typescript
      // Dynamic zoom based on player spread
      const spreadFactor = Math.max(this.playerSpreadZ / 28, this.playerSpreadX / 15);
      const minDist = 10; // closest zoom
      const maxDist = 18; // furthest zoom
      const dynamicDist = minDist + (maxDist - minDist) * Math.max(0.2, Math.min(1, spreadFactor));
      const dynamicHeight = dynamicDist * 0.6; // proportional height
```

With:

```typescript
      // Dynamic zoom based on player spread
      const spreadFactor = Math.max(this.playerSpreadZ / 20, this.playerSpreadX / 12);
      const minDist = 8;  // closest zoom (tight on action)
      const maxDist = 16; // furthest zoom (full court spread)
      const dynamicDist = minDist + (maxDist - minDist) * Math.max(0.05, Math.min(1, spreadFactor));
      const dynamicHeight = dynamicDist * 0.6; // proportional height
```

- [ ] **Step 3: Build and verify**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```
git add src/game/camera.ts src/main.ts
git commit -m "fix: camera dynamic zoom — track real X spread, tighter zoom constants"
```

---
