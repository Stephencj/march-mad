# Dunk & Shooting Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix dunking (expand zone, 100% success, knockdown), fix shooting accuracy (only active guard penalizes, bumped base rates).

**Architecture:** Changes to `shot-range.ts` (dunk zone), `shot-accuracy.ts` (accuracy formula), `game-session.ts` (dunk logic, contest calculation, knockdown).

**Tech Stack:** TypeScript, Three.js, Vitest

---

### Task 1: Expand Dunk Zone to Full Paint

**Files:**
- Modify: `src/game/shot-range.ts`
- Modify: `tests/game/dunk-zone.test.ts`

- [ ] **Step 1: Update dunk zone to use full paint depth**

In `src/game/shot-range.ts`, change:

```typescript
const DUNK_ZONE_DEPTH = PAINT_LENGTH / 3; // ~1.93 units from hoop
```

To:

```typescript
const DUNK_ZONE_DEPTH = PAINT_LENGTH; // full paint depth (5.8 units from hoop)
```

Also widen to full paint width. Change the check in `isInDunkZone`:

```typescript
export function isInDunkZone(
  playerPos: THREE.Vector3,
  attackHoop: THREE.Vector3
): boolean {
  if (Math.abs(playerPos.x) > PAINT_HALF_WIDTH) return false;
  const distFromHoop = Math.abs(playerPos.z - attackHoop.z);
  return distFromHoop < DUNK_ZONE_DEPTH;
}
```

No change to the function body — just the constant.

- [ ] **Step 2: Update tests**

In `tests/game/dunk-zone.test.ts`, update tests that relied on the old small zone:

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

  it('should return true at paint edge near hoop (full paint depth)', () => {
    // 5.8 units from hoop: z = -13 + 5.8 = -7.2
    expect(isInDunkZone(new THREE.Vector3(0, 0, -7.5), hoopHome)).toBe(true);
  });

  it('should return false at mid-court', () => {
    expect(isInDunkZone(new THREE.Vector3(0, 0, 0), hoopHome)).toBe(false);
  });

  it('should return false outside paint width', () => {
    expect(isInDunkZone(new THREE.Vector3(3, 0, -12), hoopHome)).toBe(false);
  });

  it('should return false just outside paint depth', () => {
    // hoop at -13, paint depth 5.8, so boundary at -13+5.8 = -7.2
    expect(isInDunkZone(new THREE.Vector3(0, 0, -6), hoopHome)).toBe(false);
  });

  it('should return true at edge of paint width', () => {
    expect(isInDunkZone(new THREE.Vector3(1.7, 0, -11), hoopHome)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/game/dunk-zone.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/game/shot-range.ts tests/game/dunk-zone.test.ts
git commit -m "fix: expand dunk zone to full paint area (5.8u depth)"
```

---

### Task 2: Fix Shot Accuracy — Remove Passive Defender Penalty, Bump Base Rates

**Files:**
- Modify: `src/game/shot-accuracy.ts`
- Test: `tests/game/shot-accuracy.test.ts`

- [ ] **Step 1: Write failing tests for new accuracy**

Create `tests/game/shot-accuracy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calculateShotSuccess, type ShotContext } from '@/game/shot-accuracy';

// Helper: run many trials and return success rate
function measureAccuracy(ctx: ShotContext, trials = 5000): number {
  let hits = 0;
  for (let i = 0; i < trials; i++) {
    if (calculateShotSuccess(ctx)) hits++;
  }
  return hits / trials;
}

describe('calculateShotSuccess', () => {
  it('should have ~85% base accuracy for layups', () => {
    const rate = measureAccuracy({
      distance: 1.5,
      shootingStat: 5,
      defenderDistance: 10,
      shotType: 'layup',
      isDefenderGuarding: false,
    });
    expect(rate).toBeGreaterThan(0.75);
    expect(rate).toBeLessThan(0.95);
  });

  it('should have ~55% base accuracy for mid-range', () => {
    const rate = measureAccuracy({
      distance: 5,
      shootingStat: 5,
      defenderDistance: 10,
      shotType: 'mid-range',
      isDefenderGuarding: false,
    });
    expect(rate).toBeGreaterThan(0.45);
    expect(rate).toBeLessThan(0.65);
  });

  it('should have ~40% base accuracy for three-pointers', () => {
    const rate = measureAccuracy({
      distance: 7,
      shootingStat: 5,
      defenderDistance: 10,
      shotType: 'three-pointer',
      isDefenderGuarding: false,
    });
    expect(rate).toBeGreaterThan(0.30);
    expect(rate).toBeLessThan(0.50);
  });

  it('should NOT penalize when defender is close but not guarding', () => {
    const unguarded = measureAccuracy({
      distance: 5,
      shootingStat: 5,
      defenderDistance: 1,
      shotType: 'mid-range',
      isDefenderGuarding: false,
    });
    const farAway = measureAccuracy({
      distance: 5,
      shootingStat: 5,
      defenderDistance: 10,
      shotType: 'mid-range',
      isDefenderGuarding: false,
    });
    // Should be roughly equal — no passive penalty
    expect(Math.abs(unguarded - farAway)).toBeLessThan(0.10);
  });

  it('should penalize when defender is close AND guarding', () => {
    const guarded = measureAccuracy({
      distance: 5,
      shootingStat: 5,
      defenderDistance: 1,
      shotType: 'mid-range',
      isDefenderGuarding: true,
    });
    const unguarded = measureAccuracy({
      distance: 5,
      shootingStat: 5,
      defenderDistance: 10,
      shotType: 'mid-range',
      isDefenderGuarding: false,
    });
    expect(guarded).toBeLessThan(unguarded - 0.05);
  });

  it('dunks should always succeed (100%)', () => {
    const rate = measureAccuracy({
      distance: 2,
      shootingStat: 5,
      defenderDistance: 1,
      shotType: 'dunk',
      isDefenderGuarding: false,
    });
    expect(rate).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/shot-accuracy.test.ts`
Expected: FAIL — `isDefenderGuarding` not in ShotContext, dunk not 100%

- [ ] **Step 3: Rewrite shot-accuracy.ts**

Replace `src/game/shot-accuracy.ts` entirely:

```typescript
export interface ShotContext {
  distance: number;
  shootingStat: number;
  defenderDistance: number;
  shotType: string;
  chargeMultiplier?: number;
  contestBonus?: number;
  isDefenderGuarding?: boolean;
}

export function calculateShotSuccess(ctx: ShotContext): boolean {
  // Dunks always succeed — contest is handled separately in game-session
  if (ctx.shotType === 'dunk' || ctx.shotType === 'alley-oop' || ctx.shotType === 'powerup-dunk') {
    return true;
  }

  let baseAccuracy: number;
  switch (ctx.shotType) {
    case 'layup':
      baseAccuracy = 0.85;
      break;
    case 'mid-range':
      baseAccuracy = 0.55;
      break;
    case 'three-pointer':
      baseAccuracy = 0.40;
      break;
    default:
      baseAccuracy = 0.50;
  }

  // Distance penalty: beyond normal range, accuracy drops
  const normalRange = 8;
  if (ctx.distance > normalRange) {
    const overshoot = (ctx.distance - normalRange) / normalRange;
    baseAccuracy *= Math.max(0.05, 1 - overshoot * 1.2);
  }

  // Stat modifier: shooting stat 1-10 scales ±30%
  const statModifier = 1 + (ctx.shootingStat - 5) * 0.06;
  baseAccuracy *= statModifier;

  // Contest penalty: ONLY when defender is actively guarding AND close
  if (ctx.isDefenderGuarding && ctx.defenderDistance < 2) {
    baseAccuracy *= 0.80; // -20% for active guard within 2u
  }

  // Charge multiplier (default 1.0 for AI, variable for human)
  const charge = ctx.chargeMultiplier ?? 1.0;
  baseAccuracy *= charge;

  // Active contest bonus (jump-block)
  const bonus = ctx.contestBonus ?? 0;
  baseAccuracy *= (1 - bonus);

  baseAccuracy = Math.max(0.02, Math.min(0.98, baseAccuracy));
  return Math.random() < baseAccuracy;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/game/shot-accuracy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/shot-accuracy.ts tests/game/shot-accuracy.test.ts
git commit -m "fix: shooting accuracy — remove passive defender penalty, bump base rates, dunks 100%"
```

---

### Task 3: Fix Dunk Logic — 100% Success, Knockdown, Contest Only on Jump-Block

**Files:**
- Modify: `src/game/game-session.ts` (swipe-up handler ~lines 740-775)

- [ ] **Step 1: Rewrite the dunk block in handleGesture**

In `src/game/game-session.ts`, find the DUNK PATH block (starts with `if (isInDunkZone(human.position, targetHoop) && human.stamina >= 0.3)`). Replace the ENTIRE dunk if-block with:

```typescript
          if (isInDunkZone(human.position, targetHoop) && human.stamina >= 0.3) {
            const opponents = humanTeam === 'home' ? this.awayPlayers : this.homePlayers;

            // Only a jump-block can contest a dunk
            let jumpBlocked = false;
            for (const def of opponents) {
              if (def.isJumping && def.isBlocking && def.distanceTo(targetHoop) < 3) {
                jumpBlocked = true;
                break;
              }
            }

            if (jumpBlocked) {
              // Blocked dunk — turnover
              human.loseBall();
              human.triggerFall();
              this.ball.release();
              this.ball.velocity.set((Math.random() - 0.5) * 5, 3, (Math.random() - 0.5) * 5);
              this.events.emit('splash', { text: 'BLOCKED!', color: '#e74c3c' });
              break;
            }

            // Knock down any standing defender in the paint near the hoop
            for (const def of opponents) {
              if (!def.isJumping && def.distanceTo(human.position) < 2) {
                def.triggerFall();
              }
            }

            // Dunk always succeeds when uncontested
            human.loseBall();
            human.triggerDunk();
            this.lastShooterId = human.data.id;
            this.ball.shootAt(targetHoop, 1.0);
            this.events.emit('splash', { text: 'SLAM DUNK!', color: '#2ecc71' });
          } else {
```

The `else` block (SHOT PATH) stays as-is.

- [ ] **Step 2: Update contest bonus calculation to require active guard**

Find the shot detection area where `contestBonus` is calculated (around line 296-308). The current code checks `def.isGuarding && d < 2` for guard contest. This is correct — but we also need to pass `isDefenderGuarding` to `calculateShotSuccess`.

Find where `calculateShotSuccess` is called (~line 310) and update:

```typescript
        // Check if nearest defender is actively guarding
        let isDefenderGuarding = false;
        for (const def of defTeam) {
          const d = def.distanceTo(shooterPos);
          if (def.isGuarding && d < 2) {
            isDefenderGuarding = true;
            break;
          }
        }

        const goesIn = calculateShotSuccess({
          distance,
          shootingStat: shooter?.data.stats.shooting ?? 5,
          defenderDistance: defDist,
          shotType,
          chargeMultiplier: this.lastChargeMultiplier,
          contestBonus,
          isDefenderGuarding,
        });
```

Replace the existing `contestBonus` calculation block AND the `calculateShotSuccess` call with this code. Keep the existing `contestBonus` calculation for the jump-block check but remove the old guard check from it since that's now handled by `isDefenderGuarding`:

Actually, simplify: the contestBonus should ONLY be for jump-blocks now. Change the contestBonus calculation:

```typescript
        let contestBonus = 0;
        const shooterPos = shooter?.position ?? this.ball.mesh.position;
        const defTeam = this.getPlayerTeam(this.lastShooterId) === 'home' ? this.awayPlayers : this.homePlayers;
        let isDefenderGuarding = false;
        for (const def of defTeam) {
          const d = def.distanceTo(shooterPos);
          if (def.isGuarding && d < 2) {
            isDefenderGuarding = true;
          }
          if (def.isJumping && def.isBlocking && d < 3) {
            contestBonus = Math.max(contestBonus, 0.3);
          }
        }

        const goesIn = calculateShotSuccess({
          distance,
          shootingStat: shooter?.data.stats.shooting ?? 5,
          defenderDistance: defDist,
          shotType,
          chargeMultiplier: this.lastChargeMultiplier,
          contestBonus,
          isDefenderGuarding,
        });
```

- [ ] **Step 3: Remove the stamina check for dunks or lower it further**

The current check is `human.stamina >= 0.3`. Since dunks should be easy and fun, lower to `0.1` so only truly exhausted players can't dunk:

```typescript
if (isInDunkZone(human.position, targetHoop) && human.stamina >= 0.1) {
```

- [ ] **Step 4: Verify game compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add src/game/game-session.ts
git commit -m "fix: dunks always succeed, knockdown standing defenders, only jump-block contests"
```

---

### Task 4: Run Full Test Suite

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 2: Fix any failures, commit**

- [ ] **Step 3: Push**

```bash
git push
```
