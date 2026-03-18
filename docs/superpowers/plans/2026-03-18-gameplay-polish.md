# Gameplay Polish — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 gameplay issues: immediate attack after possession, proper inbound, zone defense, aggressive AI shooting, visible HUD, points display fix, backwards walk animation, dunk range with contest.

**Architecture:** Most changes are in game-session.ts (AI behavior, inbound, dunk contest), hud.ts (visibility), player.ts (backwards walk), and post-game.ts (points fix). Each task is independent and can be done in parallel.

**Tech Stack:** Three.js, existing game systems

**Spec:** `docs/superpowers/specs/2026-03-18-gameplay-polish.md`

---

## Chunk 1: AI Behavior + Inbound + HUD (Tasks 1-4)

### Task 1: Immediate Attack + Aggressive Shooting + Zone Defense

**Files:**
- Modify: `src/game/game-session.ts`

This task modifies three parts of the AI in game-session.ts:

- [ ] **Step 1: Fix ball handler — immediate sprint, no movement delay**

In `runAI()`, change the ball handler section. Remove the `distToHoop > 6` threshold. The ball handler should ALWAYS drive toward the attacking hoop, sprinting:

```typescript
if (player.hasBall) {
  player.isSprinting = true;
  const distToHoop = player.distanceTo(attackHoop);
  if (distToHoop > 4) {
    // Drive toward hoop
    target = attackHoop.clone();
  } else {
    // In range — make a decision
    this.handleBallHandlerAI(player, attackHoop, dt);
    continue;
  }
}
```

In `handleBallHandlerAI`, change the wait timer from 0.5 to 0.3, and make it only block SHOOTING, not movement:

```typescript
private handleBallHandlerAI(player: GamePlayer, attackHoop: THREE.Vector3, dt: number): void {
  this.aiShootTimer += dt;
  const dist = player.distanceTo(attackHoop);
  const nearestDef = this.getNearestOpponentDist(player);

  // Always keep driving toward hoop while deciding
  player.aiTarget = attackHoop.clone();
  player.moveToward(player.aiTarget, dt);

  // Wait 0.3s before shooting decisions
  if (this.aiShootTimer < 0.3) return;

  // Close + open → dunk/layup (100%)
  if (dist < 3 && nearestDef > 2) {
    player.loseBall(); player.triggerShoot();
    this.lastShooterId = player.data.id;
    this.ball.shootAt(attackHoop, 1.0);
    this.aiShootTimer = 0;
    return;
  }

  // Mid-range + open → shoot (70%)
  if (dist < 7 && nearestDef > 2.5 && Math.random() < 0.7) {
    player.loseBall(); player.triggerShoot();
    this.lastShooterId = player.data.id;
    this.ball.shootAt(attackHoop, 0.5 + Math.random() * 0.3);
    this.aiShootTimer = 0;
    return;
  }

  // Three-point range + very open → shoot (50%)
  if (dist < 10 && nearestDef > 3 && Math.random() < 0.5) {
    player.loseBall(); player.triggerShoot();
    this.lastShooterId = player.data.id;
    this.ball.shootAt(attackHoop, 0.4 + Math.random() * 0.3);
    this.aiShootTimer = 0;
    return;
  }

  // Contested → 20% shoot anyway, else pass
  if (nearestDef < 2) {
    if (dist < 6 && Math.random() < 0.2) {
      player.loseBall(); player.triggerShoot();
      this.lastShooterId = player.data.id;
      this.ball.shootAt(attackHoop, 0.3 + Math.random() * 0.3);
      this.aiShootTimer = 0;
      return;
    }
    // Pass to open teammate
    const teammates = this.getTeammates(player);
    const openMate = teammates.find(t => this.getNearestOpponentDist(t) > 2.5);
    if (openMate) {
      player.loseBall();
      this.ball.passTo(openMate.position);
      this.pendingPassTarget = openMate.data.id;
      this.aiShootTimer = 0;
    }
    // If no one open, keep driving (already set target above)
    return;
  }
}
```

- [ ] **Step 2: Replace defense with zone-based positioning**

Replace `getDefensivePosition` with zone defense. Remove `getDefensiveAssignment` calls from `runAI`. Instead:

```typescript
// In runAI, the defense section:
} else {
  // DEFENSE: zone-based positioning near defending hoop
  target = this.getZoneDefensePosition(player, defendHoop);
}
```

New method:
```typescript
private getZoneDefensePosition(player: GamePlayer, defendHoop: THREE.Vector3): THREE.Vector3 {
  const team = this.isHomePlayer(player) ? this.homePlayers : this.awayPlayers;
  const idx = team.indexOf(player);

  const zones: [number, number][] = [
    [0, 7],   // PG: top of key
    [-4, 5],  // SG: left wing
    [4, 5],   // SF: right wing
    [-2, 3],  // PF: left block
    [0, 2],   // C: paint
  ];

  const [baseX, baseZ] = zones[idx] ?? [0, 4];
  const zDir = defendHoop.z > 0 ? -1 : 1;

  let targetX = baseX;
  let targetZ = defendHoop.z + baseZ * zDir;

  // Drift 30% toward ball for help defense
  const ballPos = this.ball.heldBy
    ? this.getPlayerById(this.ball.heldBy)?.position ?? this.ball.mesh.position
    : this.ball.mesh.position;
  targetX = targetX * 0.7 + ballPos.x * 0.3;
  targetZ = targetZ * 0.7 + ballPos.z * 0.3;

  return new THREE.Vector3(targetX, 0, targetZ);
}
```

- [ ] **Step 3: Verify, commit**

Run: `npx vitest run` — fix failures, `npx vite build`
Commit: `git commit -m "feat: immediate attack, aggressive shooting, zone defense"`

---

### Task 2: Proper Inbound After Score

**Files:**
- Modify: `src/game/game-session.ts`

- [ ] **Step 1: Add inbound timer property**

```typescript
private inboundTimer = 0;
private inbounderId: string | null = null;
private inboundTargetId: string | null = null;
```

- [ ] **Step 2: Rewrite enterDeadBall for baseline inbound**

```typescript
private enterDeadBall(receivingTeam: 'home' | 'away'): void {
  const receivingPlayers = receivingTeam === 'home' ? this.homePlayers : this.awayPlayers;
  const inbounder = receivingPlayers[receivingPlayers.length - 1]; // center inbounds
  const pg = receivingPlayers[0]; // PG receives

  // Position inbounder OUTSIDE baseline
  const defendHoop = this.getTeamDefendHoop(receivingTeam);
  const outsideZ = defendHoop.z + (defendHoop.z < 0 ? -1.5 : 1.5);
  inbounder.group.position.set(0, 0, outsideZ);

  // PG near baseline on court
  const pgZ = defendHoop.z + (defendHoop.z < 0 ? 2 : -2);
  pg.group.position.set(2, 0, pgZ);

  // Give ball to inbounder
  this.setBallHolder(inbounder.data.id);
  this.ball.mesh.visible = true;

  // Set inbound timer — auto-pass after 0.5s
  this.inboundTimer = 0.5;
  this.inbounderId = inbounder.data.id;
  this.inboundTargetId = pg.data.id;

  // Resume play immediately — other players move naturally
  this.matchEngine.checkBallComplete(receivingTeam);
  this.matchEngine.resetShotClock();
  this.matchEngine.state.phase = 'playing';
  this.aiShootTimer = 0;
}
```

- [ ] **Step 3: Handle inbound timer in update()**

At the top of `update()`, add:
```typescript
// Inbound auto-pass
if (this.inboundTimer > 0) {
  this.inboundTimer -= dt;
  if (this.inboundTimer <= 0 && this.inbounderId && this.inboundTargetId) {
    const inbounder = this.getPlayerById(this.inbounderId);
    const target = this.getPlayerById(this.inboundTargetId);
    if (inbounder && target && inbounder.hasBall) {
      inbounder.loseBall();
      this.ball.passTo(target.position);
      this.pendingPassTarget = this.inboundTargetId;
    }
    this.inbounderId = null;
    this.inboundTargetId = null;
  }
}
```

- [ ] **Step 4: Verify, commit**

Commit: `git commit -m "feat: proper baseline inbound after score — 0.5s pass-in"`

---

### Task 3: HUD Visibility Fix

**Files:**
- Modify: `src/ui/hud.ts`

- [ ] **Step 1: Add inline styles to score, clock, and shot clock elements**

In the HUD constructor, after creating each element, add styles:

Score element:
```typescript
Object.assign(this.scoreEl.style, {
  position: 'absolute', top: '10px', left: '50%',
  transform: 'translateX(-50%)', fontSize: '32px',
  fontWeight: 'bold', color: 'white',
  textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
  fontFamily: 'sans-serif', zIndex: '10',
});
```

Clock element:
```typescript
Object.assign(this.clockEl.style, {
  position: 'absolute', top: '50px', left: '50%',
  transform: 'translateX(-50%)', fontSize: '20px',
  color: 'white', textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
  fontFamily: 'sans-serif', zIndex: '10',
});
```

Shot clock element:
```typescript
Object.assign(this.shotClockEl.style, {
  position: 'absolute', top: '10px', right: '20px',
  fontSize: '24px', fontWeight: 'bold', color: 'white',
  textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
  fontFamily: 'sans-serif', zIndex: '10',
});
```

- [ ] **Step 2: Verify, commit**

Commit: `git commit -m "fix: HUD elements have inline styles — score, clock, shot clock always visible"`

---

### Task 4: Points Display Fix

**Files:**
- Modify: `src/game/game-session.ts` (getGameOverData)

- [ ] **Step 1: Fix humanStats.points to use match score, not performanceScore**

In `getGameOverData()`, change:
```typescript
humanStats: {
  points: humanTeam === 'home' ? this.matchEngine.state.homeScore : this.matchEngine.state.awayScore,
  assists: 0,
  steals: 0,
},
xpEarned: Math.max(0, xp),  // clamp to minimum 0
coinsEarned: humanWon ? 50 : 10,
```

- [ ] **Step 2: Verify, commit**

Commit: `git commit -m "fix: post-game shows match score not performanceScore, XP clamped to 0"`

---

## Chunk 2: Backwards Walk + Dunk Contest (Tasks 5-6)

### Task 5: Backwards Walking Animation

**Files:**
- Modify: `src/game/player.ts`

- [ ] **Step 1: Add backwards walk detection in animate()**

In the state determination section, BEFORE the `isMoving` check, compute the dot product between facing direction and movement direction:

```typescript
const isMoving = this.velocity.lengthSq() > 0.01;
let isMovingBackwards = false;
if (isMoving) {
  const facingDir = new THREE.Vector3(0, 0, 1);
  facingDir.applyQuaternion(this.group.quaternion);
  facingDir.y = 0;
  facingDir.normalize();
  const moveDir = this.velocity.clone();
  moveDir.y = 0;
  moveDir.normalize();
  isMovingBackwards = facingDir.dot(moveDir) < -0.3;
}
```

In the state determination, add backwards walk as a variant:
```typescript
} else if (isMoving && isMovingBackwards) {
  this.animState = 'walk'; // use same walk anim but with modified params
  // (we'll adjust inside the walk case based on isMovingBackwards)
}
```

Actually, simpler — just modify the walk case to check `isMovingBackwards`:

Inside `case 'walk'`:
```typescript
case 'walk': {
  if (isMovingBackwards) {
    // BACKWARDS SHUFFLE: slower stride, shorter steps, no forward lean
    const t = this.animTime * 3; // slower than forward walk (5)
    const bounceT = this.animTime * 6;
    const bouncePhase = (Math.sin(bounceT) + 1) / 2;
    this.group.position.y = Math.pow(bouncePhase, 0.6) * 0.08; // minimal bounce

    bodyPivot.rotation.x = 0; // no forward lean
    bodyPivot.scale.set(1, 1, 1); // no squash-stretch

    const strideRaw = Math.sin(t);
    const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * 0.3; // shorter stride

    hipL.rotation.x = -stride;
    hipR.rotation.x = stride;
    kneeL.rotation.x = 0.15 + Math.max(0, stride) * 0.3;
    kneeR.rotation.x = 0.15 + Math.max(0, -stride) * 0.3;

    // Arms in defensive ready position
    shoulderL.rotation.x = -0.3;
    shoulderL.rotation.z = -0.4;
    shoulderR.rotation.x = -0.3;
    shoulderR.rotation.z = 0.4;
    elbowL.rotation.x = -0.3;
    elbowR.rotation.x = -0.3;
    break;
  }

  // ... existing forward walk code ...
}
```

The `isMovingBackwards` variable needs to be accessible inside the switch. Store it as a class property or compute it before the switch.

- [ ] **Step 2: Verify in animation viewer and game**

Run: `npx vitest run`, `npx vite build`
Commit: `git commit -m "feat: backwards walking shuffle animation when moving away from facing direction"`

---

### Task 6: Dunk Range Expansion + Contest

**Files:**
- Modify: `src/game/game-session.ts`

- [ ] **Step 1: Expand dunk range and add success probability**

In `handleGesture`, replace the dunk section:

```typescript
case 'swipe-down': {
  const humanTeam = this.getPlayerTeam(this.humanPlayerId);
  const targetHoop = this.getTeamAttackHoop(humanTeam);
  const dist = human.distanceTo(targetHoop);

  if (hasBall && dist < 8) {
    // Calculate dunk success based on distance + stats
    let successRate: number;
    if (dist < 3) successRate = 0.9;
    else if (dist < 5) successRate = 0.7;
    else successRate = 0.4;

    // Modify by dunkPower stat (±15%)
    successRate += (human.data.stats.dunkPower - 5) * 0.03;
    successRate = Math.max(0.1, Math.min(0.95, successRate));

    // Check for contest — defender between player and hoop, jumping
    const opponents = humanTeam === 'home' ? this.awayPlayers : this.homePlayers;
    let contested = false;
    for (const def of opponents) {
      const defDist = def.distanceTo(targetHoop);
      const playerDist = human.distanceTo(targetHoop);
      const isInPath = defDist < playerDist && def.distanceTo(human.position) < 3;
      if (isInPath && def.isJumping) {
        contested = true;
        break;
      }
    }

    if (contested && Math.random() < 0.6) {
      // BLOCKED! Ball knocked loose, dunker falls
      human.loseBall();
      human.triggerFall();
      this.ball.release();
      this.ball.velocity.set((Math.random() - 0.5) * 5, 3, (Math.random() - 0.5) * 5);
      break;
    }

    if (Math.random() < successRate) {
      // Dunk succeeds
      human.loseBall();
      human.triggerDunk();
      this.lastShooterId = human.data.id;
      this.ball.shootAt(targetHoop, 1.0);
    } else {
      // Dunk fails (missed) — ball bounces off rim
      human.loseBall();
      this.lastShooterId = human.data.id;
      this.ball.shootAt(targetHoop, 0.8);
      // Shot accuracy will handle the miss
    }
  }
  break;
}
```

Also update the AI dunk range in `handleBallHandlerAI`:
```typescript
if (dist < 4 && nearestDef > 2) {
  // Close + open → dunk/layup
```
Change `< 3` to `< 4`.

- [ ] **Step 2: Verify, commit**

Commit: `git commit -m "feat: dunk from 8 units, success varies by distance, contest blocks with fall"`

---
