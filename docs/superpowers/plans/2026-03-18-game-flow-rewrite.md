# Game Flow Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite game-session.ts so that each team always attacks the same basket, AI positions are phase-driven (offense/defense/dead-ball), and players actually move to correct basketball positions every frame without hold timers or V-cut systems.

**Architecture:** Replace the single attackingHoop/defendingHoop that swaps with per-team fixed hoops. Replace the hold-timer/V-cut/formation AI with a simple per-frame position calculator. Replace resetAfterScore hoop-swapping with a dead-ball phase where players jog to positions. Keep all existing rendering, controls, ball physics, and shot detection.

**Tech Stack:** Three.js, existing game systems

**Spec:** `docs/superpowers/specs/2026-03-18-game-flow-rewrite.md`

---

## Chunk 1: Rewrite GameSession AI and Game Flow

This is a single large task because the hoop system, AI logic, and game flow are all entangled in game-session.ts. Splitting would create broken intermediate states.

### Task 1: Rewrite GameSession

**Files:**
- Rewrite major sections of: `src/game/game-session.ts`
- Modify: `src/game/shot-detector.ts` (make hoop position dynamic per shot)
- Update: `tests/game/game-session.test.ts`

The implementer should read the ENTIRE current `game-session.ts` first, then apply these changes:

- [ ] **Step 1: Replace hoop properties**

Remove:
```typescript
attackingHoop: THREE.Vector3;
defendingHoop: THREE.Vector3;
```

Add:
```typescript
// Fixed per-team hoops — NEVER swap
private homeAttackHoop: THREE.Vector3;  // hoopAway z=+13 (home SCORES here)
private homeDefendHoop: THREE.Vector3;  // hoopHome z=-13 (home DEFENDS here)
private awayAttackHoop: THREE.Vector3;  // hoopHome z=-13 (away SCORES here)
private awayDefendHoop: THREE.Vector3;  // hoopAway z=+13 (away DEFENDS here)

// Dead ball state
private deadBallTimer = 0;
private deadBallReceivingTeam: 'home' | 'away' | null = null;
```

In constructor, set these ONCE:
```typescript
this.homeAttackHoop = FULL_COURT_DIMENSIONS.hoopAway.clone();  // z=+13
this.homeDefendHoop = FULL_COURT_DIMENSIONS.hoopHome.clone();  // z=-13
this.awayAttackHoop = FULL_COURT_DIMENSIONS.hoopHome.clone();  // z=-13
this.awayDefendHoop = FULL_COURT_DIMENSIONS.hoopAway.clone();  // z=+13
```

Add helper:
```typescript
getTeamAttackHoop(team: 'home' | 'away'): THREE.Vector3 {
  return team === 'home' ? this.homeAttackHoop : this.awayAttackHoop;
}
getTeamDefendHoop(team: 'home' | 'away'): THREE.Vector3 {
  return team === 'home' ? this.homeDefendHoop : this.awayDefendHoop;
}
```

- [ ] **Step 2: Remove aiMovementState, aiHoldTimer, isSprinting from AI logic**

The player.ts still has these properties (they're used by animations), but the game-session AI logic should NOT use hold timers anymore. Instead, every frame, compute the target and call `moveToward`.

Remove from game-session:
- All references to `player.aiMovementState`
- All references to `player.aiHoldTimer`
- The entire `moveAIPlayers()` method
- The entire `moveToFormation()` method
- The `cachedPlays` system
- `TeamAI` usage in the AI decision logic

- [ ] **Step 3: Rewrite update() method**

The new update() has three sections based on game phase:

```typescript
update(dt: number): void {
  // === DEAD BALL PHASE (after score) ===
  if (this.matchEngine.state.phase === 'transitioning') {
    this.deadBallTimer -= dt;
    // All players move toward reset positions
    for (const p of this.getAllPlayers()) {
      if (p.data.id === this.humanPlayerId) continue;
      if (p.aiTarget) p.moveToward(p.aiTarget, dt);
      p.animate(dt);
    }
    // When timer expires, give ball and resume
    if (this.deadBallTimer <= 0) {
      this.resumeAfterDeadBall();
    }
    return;
  }

  // === LIVE PLAY ===
  // Ball position
  if (this.ball.heldBy) {
    const holder = this.getPlayerById(this.ball.heldBy);
    if (holder) this.ball.followHolder(holder.group, holder.hasBall && !holder.isJumping, holder.dribblePhase);
  } else {
    this.ball.update(dt);
  }

  // Shot detection
  this.shotDetector.tick(dt);
  if (this.ball.isInFlight) {
    // Determine which hoop the shooter was aiming at
    const shooterTeam = this.getPlayerTeam(this.lastShooterId);
    const targetHoop = this.getTeamAttackHoop(shooterTeam);
    this.shotDetector.setHoopPosition(targetHoop);

    const result = this.shotDetector.check(this.ball.mesh.position, this.ball.velocity, this.ball.isInFlight);
    if (result.made) {
      // ... shot accuracy check, handleMadeShot ...
    }
  }

  // Ball out of bounds check
  this.checkBallOutOfBounds();

  // Loose ball — everyone chases
  if (!this.ball.heldBy && !this.ball.isInFlight) {
    this.checkBallPickup();
    // AI chases loose ball
    for (const p of this.getAllPlayers()) {
      if (p.data.id === this.humanPlayerId) continue;
      p.aiTarget = this.ball.mesh.position.clone();
      p.moveToward(p.aiTarget, dt);
    }
  } else {
    // Normal AI positioning
    this.runAI(dt);
  }

  // Animate all players
  for (const p of this.getAllPlayers()) {
    p.animate(dt);
  }

  // AI facing
  this.updateAIFacing();

  // Auto-switch on defense
  this.updateDefensiveAutoSwitch(dt);

  // Match clock
  if (this.matchEngine.state.phase === 'playing') {
    this.matchEngine.tickClock(dt);
  }

  // Powerup system
  this.updatePowerups(dt);
}
```

- [ ] **Step 4: Write the new runAI() method**

This replaces `runAIDecisions()`, `moveAIPlayers()`, `moveToFormation()`:

```typescript
private runAI(dt: number): void {
  const possession = this.matchEngine.state.possession;

  for (const player of this.getAllPlayers()) {
    if (player.data.id === this.humanPlayerId) continue;

    const isHome = this.isHomePlayer(player);
    const myTeam: 'home' | 'away' = isHome ? 'home' : 'away';
    const onOffense = possession === myTeam;
    const attackHoop = this.getTeamAttackHoop(myTeam);
    const defendHoop = this.getTeamDefendHoop(myTeam);

    let target: THREE.Vector3;

    if (onOffense) {
      if (player.hasBall) {
        // BALL HANDLER: advance toward attacking hoop
        const distToHoop = player.distanceTo(attackHoop);
        if (distToHoop > 6) {
          // Too far — drive toward hoop
          target = attackHoop.clone();
        } else {
          // In range — AI decides (shoot/pass/drive)
          this.handleBallHandlerAI(player, attackHoop, dt);
          continue; // decision handled inside
        }
      } else {
        // OFF-BALL OFFENSE: go to offensive spot
        target = this.getOffensivePosition(player, attackHoop);
      }
    } else {
      // DEFENSE: position between assignment and defending hoop
      const assignment = this.getDefensiveAssignment(player);
      if (assignment) {
        target = this.getDefensivePosition(player, assignment, defendHoop);
      } else {
        target = defendHoop.clone();
      }
    }

    player.aiTarget = target;
    player.moveToward(target, dt);
  }
}
```

- [ ] **Step 5: Write getOffensivePosition()**

```typescript
private getOffensivePosition(player: GamePlayer, attackHoop: THREE.Vector3): THREE.Vector3 {
  const team = this.isHomePlayer(player) ? this.homePlayers : this.awayPlayers;
  const idx = team.indexOf(player);

  // Standard basketball offensive spots
  // [xOffset, zOffsetFromHoop (toward center court)]
  const offsets: [number, number][] = [
    [0, 8],    // PG: top of key
    [-5, 6],   // SG: left wing
    [4, 5],    // SF: right wing
    [-2, 3],   // PF: left elbow
    [0, 2],    // C: paint
  ];

  const [xOff, zOff] = offsets[idx] ?? [0, 5];

  // Z direction: toward center court from the hoop
  const zDir = attackHoop.z > 0 ? -1 : 1;

  return new THREE.Vector3(xOff, 0, attackHoop.z + zOff * zDir);
}
```

- [ ] **Step 6: Write getDefensivePosition()**

```typescript
private getDefensivePosition(player: GamePlayer, assignment: GamePlayer, defendHoop: THREE.Vector3): THREE.Vector3 {
  const isBallHandler = assignment.hasBall;
  // Ball defender: stay close (80% toward man). Off-ball: help side (65%)
  const blend = isBallHandler ? 0.8 : 0.65;

  return new THREE.Vector3(
    assignment.position.x * blend + defendHoop.x * (1 - blend),
    0,
    assignment.position.z * blend + defendHoop.z * (1 - blend)
  );
}
```

- [ ] **Step 7: Write handleBallHandlerAI()**

Simple decision making for AI with the ball:

```typescript
private aiShootTimer = 0;

private handleBallHandlerAI(player: GamePlayer, attackHoop: THREE.Vector3, dt: number): void {
  this.aiShootTimer += dt;

  // Wait at least 1 second before shooting
  if (this.aiShootTimer < 1) {
    // Advance toward hoop while surveying
    player.aiTarget = attackHoop.clone();
    player.moveToward(player.aiTarget, dt);
    return;
  }

  const dist = player.distanceTo(attackHoop);
  const ai = this.playerAIs.get(player.data.id);
  if (!ai) return;

  const nearestDef = this.getNearestOpponentDist(player);

  // Simple decision: shoot if open and in range, pass if covered, drive if lane open
  if (dist < 3 && nearestDef > 2) {
    // Close and open — dunk
    player.loseBall();
    player.triggerShoot();
    this.lastShooterId = player.data.id;
    this.ball.shootAt(attackHoop, 1.0);
    this.aiShootTimer = 0;
  } else if (dist < 7 && nearestDef > 2.5 && Math.random() < 0.3) {
    // Mid range, open — shoot
    player.loseBall();
    player.triggerShoot();
    this.lastShooterId = player.data.id;
    this.ball.shootAt(attackHoop, 0.5 + Math.random() * 0.3);
    this.aiShootTimer = 0;
  } else if (nearestDef < 2) {
    // Covered — pass to open teammate
    const teammates = this.getTeammates(player);
    const openTeammate = teammates.find(t =>
      this.getNearestOpponentDist(t) > 2.5
    );
    if (openTeammate) {
      player.loseBall();
      this.ball.passTo(openTeammate.position);
      this.pendingPassTarget = openTeammate.data.id;
      this.switchHumanControl(openTeammate.data.id); // if needed
      this.aiShootTimer = 0;
    } else {
      // No one open — keep driving
      player.aiTarget = attackHoop.clone();
      player.moveToward(player.aiTarget, dt);
    }
  } else {
    // Drive closer
    player.aiTarget = attackHoop.clone();
    player.moveToward(player.aiTarget, dt);
  }
}
```

- [ ] **Step 8: Rewrite handleMadeShot() — no hoop swap**

```typescript
handleMadeShot(team: 'home' | 'away', shotType: ShotType): void {
  // Slam cam
  const scoringHoop = this.getTeamAttackHoop(team);
  if (shotType === 'dunk' || shotType === 'alley-oop' || shotType === 'powerup-dunk') {
    this.slamCamRequested = true;
    this.slamCamPosition = scoringHoop.clone();
  }

  this.matchEngine.score(team, shotType);
  this.ball.isInFlight = false;

  // Enter dead ball phase — NO HOOP SWAP
  const receivingTeam: 'home' | 'away' = team === 'home' ? 'away' : 'home';
  this.enterDeadBall(receivingTeam);
}
```

- [ ] **Step 9: Write enterDeadBall() and resumeAfterDeadBall()**

```typescript
private enterDeadBall(receivingTeam: 'home' | 'away'): void {
  this.matchEngine.state.phase = 'transitioning';
  this.deadBallTimer = 1.5;
  this.deadBallReceivingTeam = receivingTeam;

  // Hide ball during transition
  this.ball.release();
  this.ball.mesh.visible = false;

  // Set target positions: scoring team retreats to DEFENSE, receiving team goes to OFFENSE
  const scoringTeam: 'home' | 'away' = receivingTeam === 'home' ? 'away' : 'home';

  // Scoring team → retreat to their defensive end
  const scoringDefendHoop = this.getTeamDefendHoop(scoringTeam);
  const scoringPlayers = scoringTeam === 'home' ? this.homePlayers : this.awayPlayers;
  const defenseSpots: [number, number][] = [[0, 3], [-4, 5], [4, 5], [-2, 7], [2, 7]];
  const defDir = scoringDefendHoop.z > 0 ? -1 : 1;
  scoringPlayers.forEach((p, i) => {
    const [x, z] = defenseSpots[i] ?? [0, 5];
    p.aiTarget = new THREE.Vector3(x, 0, scoringDefendHoop.z + z * defDir);
  });

  // Receiving team → go to their offensive end
  const receivingAttackHoop = this.getTeamAttackHoop(receivingTeam);
  const receivingPlayers = receivingTeam === 'home' ? this.homePlayers : this.awayPlayers;
  const offenseSpots: [number, number][] = [[0, 8], [-5, 6], [4, 5], [-2, 3], [0, 2]];
  const offDir = receivingAttackHoop.z > 0 ? -1 : 1;
  receivingPlayers.forEach((p, i) => {
    const [x, z] = offenseSpots[i] ?? [0, 5];
    p.aiTarget = new THREE.Vector3(x, 0, receivingAttackHoop.z + z * offDir);
  });
}

private resumeAfterDeadBall(): void {
  if (!this.deadBallReceivingTeam) return;

  const receiver = this.deadBallReceivingTeam === 'home' ? this.homePlayers[0] : this.awayPlayers[0];
  const attackHoop = this.getTeamAttackHoop(this.deadBallReceivingTeam);

  // Ball at the receiving team's BASELINE (far from their attacking hoop)
  const baselineZ = this.deadBallReceivingTeam === 'home'
    ? this.homeDefendHoop.z + (this.homeDefendHoop.z < 0 ? 1 : -1)  // just inside baseline
    : this.awayDefendHoop.z + (this.awayDefendHoop.z < 0 ? 1 : -1);

  this.ball.mesh.position.set(0, 1, baselineZ);
  this.ball.velocity.set(0, 0, 0);
  this.ball.mesh.visible = true;
  this.setBallHolder(receiver.data.id);
  this.matchEngine.checkBallComplete(this.deadBallReceivingTeam);
  this.matchEngine.resetShotClock();

  this.deadBallReceivingTeam = null;
  this.aiShootTimer = 0;
}
```

- [ ] **Step 10: Update getCameraInfo()**

Track the ball position (whoever has it). The broadcast camera handles the rest:

```typescript
getCameraInfo(): CameraInfo {
  if (this.slamCamRequested) {
    this.slamCamRequested = false;
    return { mode: 'slam' as CameraMode, trackPosition: this.slamCamPosition!, lookAt: this.slamCamPosition! };
  }

  const ballPos = this.ball.heldBy
    ? this.getPlayerById(this.ball.heldBy)?.position ?? this.ball.mesh.position
    : this.ball.mesh.position;

  return {
    mode: 'broadcast' as CameraMode,
    trackPosition: ballPos.clone(),
    lookAt: new THREE.Vector3(0, 1.5, ballPos.z),
  };
}
```

- [ ] **Step 11: Update processInput for shooting direction**

When the human shoots, the ball should go toward THEIR team's attacking hoop:

```typescript
// In handleGesture, swipe-up:
const humanTeam = this.getPlayerTeam(this.humanPlayerId);
const targetHoop = this.getTeamAttackHoop(humanTeam);
this.ball.shootAt(targetHoop, gesture.power);

// In handleGesture, swipe-down (dunk):
const humanTeam = this.getPlayerTeam(this.humanPlayerId);
const targetHoop = this.getTeamAttackHoop(humanTeam);
if (hasBall && human.distanceTo(targetHoop) < 4.5) {
  this.ball.shootAt(targetHoop, 1.0);
}
```

- [ ] **Step 12: Update tests**

Update `tests/game/game-session.test.ts`:
- Remove tests that reference `attackingHoop` / `defendingHoop`
- Add test: home team always attacks hoopAway (z=+13)
- Add test: after score, hoops DON'T swap
- Add test: offensive position is near attacking hoop
- Add test: defensive position is between assignment and defending hoop
- Update any tests that check for `aiMovementState`

- [ ] **Step 13: Clean up removed code**

Remove all references to:
- `attackingHoop` / `defendingHoop` (replaced by per-team hoops)
- `moveAIPlayers()` method
- `moveToFormation()` method
- `cachedPlays` / `playRefreshInterval` / `lastPossession`
- `TeamAI` import and usage in game-session
- `getFormation5v5` import
- `aiMovementState` usage in game-session (keep the property on player.ts for animations)
- V-cut logic
- Hold timer management in game-session

- [ ] **Step 14: Run all tests and build**

Run: `npx vitest run`
Expected: All tests pass (some may need updating)

Run: `npx vite build`
Expected: Exit 0

- [ ] **Step 15: Commit**

```bash
git add src/game/game-session.ts tests/game/game-session.test.ts
git commit -m "feat: game flow rewrite — fixed team direction, phase-driven AI, no hoop swapping"
```

---
