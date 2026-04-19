# Controls & Gameplay Polish — Design Spec

## Overview

Four fixes: (1) make passing reliable — opponents must actively steal to intercept, (2) charge-up shooting mechanic with accuracy bonus and shot detection fix, (3) add Controls menu showing key mappings, (4) add FOUL! splash text.

## 1. Reliable Passing

### Problem

Passes get intercepted passively. The pass protection timer (0.3s) expires mid-flight, and any opponent within 1.0 unit of the ball auto-picks it up. Pass speed (12 units/sec) is slow enough that defenders wander into the path. Result: passing almost never works.

### Fix

**Faster passes:** Increase `passSpeed` in `ball.ts` from 12 to 20. Also increase the arrival detection threshold from 0.5 to 1.0 in the pass update logic (`ball.ts` ~line 186) to prevent overshoot at low framerates (at 20 units/sec and 30fps, ball moves 0.66 units/frame).

**Full-flight protection:** `checkBallPickup()` (game-session.ts ~line 319) only runs when `!ball.isInFlight`, so opponents already can't passively pick up during flight. The real interception window is AFTER the ball arrives and becomes loose. Fix: while `pendingPassTarget` is set, skip ALL opponents in `checkBallPickup()` — not just during a timer. Only same-team players can pick up. Remove the `passProtectionTimer` field entirely — protection is governed by the existence of `pendingPassTarget`. Clear `pendingPassTarget` only when the intended receiver picks it up OR the ball goes out of bounds.

**Active steal interception:** An opponent can intercept a pass ONLY by actively pressing Steal (Q/tap). In `attemptSteal()`, the current code starts with `const ballHolder = find(p => p.hasBall); if (!ballHolder) return;` — this early-returns when no one holds the ball (i.e., during a pass). Restructure:

```typescript
private attemptSteal(stealer: GamePlayer): void {
  // BRANCH 1: Deflect an in-flight pass
  if (!this.ball.heldBy && this.pendingPassTarget && this.ball.isInFlight) {
    if (stealer.distanceTo(this.ball.mesh.position) > 1.5) return;
    stealer.triggerSteal();
    if (Math.random() < 0.4) {
      // Deflected — ball becomes loose
      this.ball.isInFlight = false;
      this.ball.passTarget = null;
      this.ball.velocity.set((Math.random()-0.5)*4, 2, (Math.random()-0.5)*4);
      this.pendingPassTarget = null;
      this.events.emit('splash', { text: 'DEFLECTED!', color: '#f39c12' });
    }
    // If roll fails, steal anim plays but pass continues
    return;
  }

  // BRANCH 2: Normal steal from ball holder (existing logic)
  const ballHolder = this.getAllPlayers().find(p => p.hasBall);
  if (!ballHolder) return;
  // ... rest of existing steal code ...
}
```

## 2. Charge-Up Shooting

### Problem

Shooting feels random. Space releases instantly with power based on hold time, but there's no visual feedback. The shot detector isn't triggering properly — SCORE/MISS splash text rarely appears. The user wants a deliberate charge-up mechanic where holding Space locks the player and charges a bar.

### Part A: Charge-Up Mechanic

**State location:** Add `isCharging: boolean` and `chargeTimer: number` properties to `GamePlayer` in `player.ts`. These are read by game-session.ts and HUD.

**Keyboard flow in `keyboard-controls.ts`:**
- Space keydown: emit a new gesture type `'charge-start'` (no power). Do NOT fire a shot.
- Space keyup: emit `'swipe-up'` gesture with `power = clamp(holdTime / 1500, 0, 1)` (1.5s to full charge). This fires the shot.
- The existing `spaceDownTime` tracking already handles this — just change the divisor from 500 to 1500 and add the keydown gesture.

**Charge state in `game-session.ts` `handleGesture()`:**
- On `'charge-start'`: if player has ball, set `human.isCharging = true`, `human.chargeTimer = 0`
- On `'swipe-up'` (release): if `human.isCharging`, fire the shot, set `human.isCharging = false`, `human.chargeTimer = 0`

**Per-frame in `processInput()` or `update()`:**
- If human player `isCharging`: increment `chargeTimer += dt`, zero out movement velocity (player locked in place)
- Cap at 1.5 seconds

**Charge accuracy multiplier:** Calculate from chargeLevel (0 to 1):
- chargeLevel 0.0 → multiplier 0.5 (quick tap, inaccurate)
- chargeLevel 0.5 → multiplier 1.0 (normal)
- chargeLevel 0.8-1.0 → multiplier 1.5 (green zone, accurate)
- Linear interpolation between these breakpoints

**Charge bar HUD element:** A horizontal bar in `hud.ts`. Bottom-center of screen. Shows charge level 0-100%. The 80-100% range highlighted green. Only visible while `isCharging` is true. The GameSession exposes the charge state for HUD to read.

**Touch controls:** Swipe-up still fires instantly with no charge (no change to `controls.ts`). Charge-up is keyboard-only.

**AI reaction:** In `runAI()`, when an opponent (the human) `isCharging` and charge is past 50%, any defender within 5 units calls `jump()` to block. The 50% threshold prevents defenders from jumping before the charge is meaningful, so they're still airborne when the shot releases.

### Part B: Fix Shot Detection — Root Cause

The actual root cause of shots not registering: during arc-based flight (`ball.ts` ~lines 169-179), the ball follows pre-computed arc positions but `ball.velocity` is never updated — it stays at (0,0,0). The shot detector at `shot-detector.ts` line 43 requires `ballVelocity.y < 0` (ball descending). Since velocity is zero, this condition never passes.

**Fix 1 — Compute synthetic velocity during arc flight.** In `ball.ts`, during the arc update, compute velocity from consecutive positions:

```typescript
// Inside the arc update block, after advancing arcIndex:
if (this.arcIndex > 0 && this.arcIndex < this.arc.length) {
  const prev = this.arc[this.arcIndex - 1];
  const curr = this.arc[this.arcIndex];
  this.velocity.subVectors(curr, prev).divideScalar(1/60); // approximate per-frame velocity
}
```

This gives the shot detector a real velocity vector with a negative Y component on the descending half of the arc.

**Fix 2 — Increase arc resolution.** Change arc steps from 30 to 60 in `calculateArc()`. At 30 steps with `arcSpeed = 60`, the ball advances ~1 step per frame at 60fps. At lower framerates it skips steps, potentially jumping over the detection zone. 60 steps gives finer granularity.

**Fix 3 — Widen detection tolerances.** In `shot-detector.ts`:
- `horizontalDist` threshold: 0.4 → 0.8 (cartoon-sized hoop)
- `verticalDist` threshold: 0.5 → 1.0 (more forgiving)

**Fix 4 — Diagnostic logging.** In `shotDetector.check()`, when ball is within 3 units of hoop, log: horizontalDist, verticalDist, velocity.y, all three conditions. This stays in for debugging.

### Part C: Accuracy with Charge Multiplier

In `shot-accuracy.ts`, add an optional `chargeMultiplier` parameter to `calculateShotSuccess()`:

```typescript
interface ShotContext {
  distance: number;
  shootingStat: number;
  defenderDistance: number;
  shotType: ShotType;
  chargeMultiplier?: number; // default 1.0
}
```

Apply the multiplier to `baseAccuracy` after all other modifiers, before the final clamp. When the human player shoots after charging, pass the charge multiplier. AI shots use the default 1.0.

## 3. Controls Menu

### Problem

The Settings menu only has volume sliders. There's no way to see what the controls are. The main menu currently has no button that navigates to Settings — it needs one.

### Fix

**Add button to main menu.** Add a "Controls" button to the main menu in `menus.ts` (after the game mode buttons). This navigates to the settings/controls screen.

**Redesign settings screen.** Replace the current "Settings" screen with a combined controls + settings screen:

```
CONTROLS

Movement ........... WASD / Left Stick
Shoot (charge) ..... SPACE (hold & release)
Pass ............... E / Horizontal Swipe
Steal / Block ...... Q / Tap
Jump ............... F
Dunk ............... G / Swipe Down
Sprint ............. SHIFT (hold)

---
SFX Volume [====----] 75
Music Volume [====----] 75

[Back]
```

Each control line is a styled div with left-aligned label and right-aligned key. Same dark overlay style as existing menus.

## 4. Foul Splash Text

### Problem

`callFoul()` emits a `'foul'` event but nothing listens for it. No visual feedback when a foul occurs.

### Fix

In `game-session.ts` constructor (where other event listeners are set up), add:

```typescript
this.events.on('foul', () => {
  this.events.emit('splash', { text: 'FOUL!', color: '#ffaa00' });
});
```

Yellow-orange color (#ffaa00) to distinguish from other splash text. Uses the existing splash system.

## Files to Modify

- `src/game/ball.ts` — increase passSpeed to 20, increase arrival threshold to 1.0, increase arc steps to 60, compute synthetic velocity during arc flight
- `src/game/game-session.ts` — pass protection via pendingPassTarget (remove passProtectionTimer), charge-up state in update/processInput, attemptSteal restructure for deflection, foul splash listener, AI block reaction
- `src/game/keyboard-controls.ts` — Space keydown emits 'charge-start', keyup fires with power based on 1500ms charge
- `src/game/shot-detector.ts` — increase detection tolerances, add diagnostic logging
- `src/game/shot-accuracy.ts` — add chargeMultiplier parameter
- `src/game/player.ts` — add `isCharging` and `chargeTimer` properties
- `src/ui/hud.ts` — add charge bar element
- `src/ui/menus.ts` — add Controls button to main menu, redesign settings screen with controls reference
- `src/game/controls.ts` — no changes needed (touch swipe-up still works as-is)
