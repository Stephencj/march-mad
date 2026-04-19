# Controls & Gameplay Polish — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix passing reliability, add charge-up shooting with shot detection fix, add Controls menu, add FOUL! splash text.

**Architecture:** Four independent tasks. Task 1 fixes passing in ball.ts and game-session.ts. Task 2 fixes shooting across ball.ts, keyboard-controls.ts, game-session.ts, shot-detector.ts, shot-accuracy.ts, player.ts, and hud.ts. Task 3 updates menus.ts. Task 4 adds one event listener.

**Tech Stack:** Three.js, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-18-controls-gameplay.md`

---

## Chunk 1: Passing + Foul Splash (Tasks 1, 4)

### Task 1: Reliable Passing

**Files:**
- Modify: `src/game/ball.ts`
- Modify: `src/game/game-session.ts`
- Modify: `src/game/controls.ts` (add 'charge-start' to GestureType — needed for Task 2 but the type change is here)

- [x] **Step 1: Increase pass speed and arrival threshold in ball.ts**

In `src/game/ball.ts`, change line 13:
```typescript
private passSpeed = 12;
```
To:
```typescript
private passSpeed = 20;
```

In the pass update block (~line 186), change the arrival threshold:
```typescript
      if (dist < 0.5) {
```
To:
```typescript
      if (dist < 1.0) {
```

- [x] **Step 2: Remove `passProtectionTimer` field, use `pendingPassTarget` for protection**

In `src/game/game-session.ts`:

Delete line 58:
```typescript
  private passProtectionTimer = 0;
```

Delete the pass protection timer tick in `update()` (~lines 205-208):
```typescript
    // Pass protection timer
    if (this.passProtectionTimer > 0) {
      this.passProtectionTimer -= dt;
    }
```

Remove `this.passProtectionTimer = 0.3;` from both locations where it's set:
- In the pass gesture handler (~line 614)
- In `handleBallHandlerAI()` (~line 947)

- [x] **Step 3: Rewrite `checkBallPickup()` — use `pendingPassTarget` as protection**

Replace the pass protection check inside `checkBallPickup()`. The current code checks `this.passProtectionTimer > 0 && this.pendingPassTarget`. Change it to just check `this.pendingPassTarget`:

Find the block (~lines 1014-1017):
```typescript
        if (this.passProtectionTimer > 0 && this.pendingPassTarget) {
          const passTeam = this.getPlayerTeam(this.pendingPassTarget);
          const playerTeam = this.getPlayerTeam(p.data.id);
          if (playerTeam !== passTeam) continue; // skip opponents during protection
        }
```
Replace with:
```typescript
        // While a pass is pending, only same-team players can pick up
        if (this.pendingPassTarget) {
          const passTeam = this.getPlayerTeam(this.pendingPassTarget);
          const playerTeam = this.getPlayerTeam(p.data.id);
          if (playerTeam !== passTeam) continue;
        }
```

Also remove the `this.passProtectionTimer = 0;` line at the end of `checkBallPickup()` (~line 1042).

- [x] **Step 4: Restructure `attemptSteal()` for pass deflection**

Replace the entire `attemptSteal()` method in `src/game/game-session.ts`:

```typescript
  private attemptSteal(stealer: GamePlayer): void {
    // BRANCH 1: Deflect an in-flight pass
    if (!this.ball.heldBy && this.pendingPassTarget && this.ball.isInFlight) {
      if (stealer.distanceTo(this.ball.mesh.position) > 1.5) return;
      stealer.triggerSteal();
      if (Math.random() < 0.4) {
        // Deflected — ball becomes loose
        this.ball.isInFlight = false;
        this.ball.velocity.set((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4);
        this.pendingPassTarget = null;
        this.events.emit('splash', { text: 'DEFLECTED!', color: '#f39c12' });
      }
      return;
    }

    // BRANCH 2: Normal steal from ball holder
    const ballHolder = this.getAllPlayers().find(p => p.hasBall);
    if (!ballHolder) return;
    if (stealer.distanceTo(ballHolder.position) > 2) return;

    stealer.triggerSteal();

    const roll = Math.random();
    if (roll < 0.3) {
      ballHolder.loseBall();
      ballHolder.recordStat('turnovers', 1);
      this.setBallHolder(stealer.data.id);
      const stealerTeam = this.getPlayerTeam(stealer.data.id);
      if (this.matchEngine.state.possession !== stealerTeam) {
        this.changePossession(stealerTeam, `steal by ${stealer.data.id}`);
      }
      this.events.emit('splash', { text: 'STEAL!', color: '#f39c12' });
    } else if (roll < 0.6) {
      const stealerTeam = this.getPlayerTeam(stealer.data.id);
      this.matchEngine.callFoul(stealerTeam);
      const receivingTeam: 'home' | 'away' = stealerTeam === 'home' ? 'away' : 'home';
      this.enterDeadBall(receivingTeam);
    }
  }
```

- [x] **Step 5: Add 'charge-start' to GestureType**

In `src/game/controls.ts`, line 9:
```typescript
export type GestureType = 'swipe-up' | 'pass' | 'tap' | 'swipe-down' | 'double-tap' | 'jump';
```
Change to:
```typescript
export type GestureType = 'swipe-up' | 'pass' | 'tap' | 'swipe-down' | 'double-tap' | 'jump' | 'charge-start';
```

- [x] **Step 6: Run tests + build**

Run: `npx vitest run && npx vite build`
Expected: All pass, build succeeds

- [x] **Step 7: Commit**

```
git add src/game/ball.ts src/game/game-session.ts src/game/controls.ts
git commit -m "fix: reliable passing — faster speed, full-flight protection, active steal deflection"
```

---

### Task 4: Foul Splash Text

**Files:**
- Modify: `src/game/game-session.ts`

- [x] **Step 1: Add foul event listener**

In `src/game/game-session.ts`, in the constructor, after the shot-clock-violation listener (~line 73), add:

```typescript
    this.events.on('foul', () => {
      this.events.emit('splash', { text: 'FOUL!', color: '#ffaa00' });
    });
```

- [x] **Step 2: Run tests + build**

Run: `npx vitest run && npx vite build`

- [x] **Step 3: Commit**

```
git add src/game/game-session.ts
git commit -m "feat: FOUL! splash text on foul events"
```

---

## Chunk 2: Charge-Up Shooting (Task 2)

### Task 2: Charge-Up Shooting + Shot Detection Fix

**Files:**
- Modify: `src/game/player.ts` — add `isCharging`, `chargeTimer`
- Modify: `src/game/keyboard-controls.ts` — Space keydown emits charge-start, keyup power based on 1500ms
- Modify: `src/game/game-session.ts` — handle charge-start gesture, lock player while charging, pass charge multiplier, AI block reaction
- Modify: `src/game/ball.ts` — increase arc steps to 60, compute synthetic velocity during arc
- Modify: `src/game/shot-detector.ts` — widen tolerances, add logging
- Modify: `src/game/shot-accuracy.ts` — add chargeMultiplier parameter
- Modify: `src/ui/hud.ts` — add charge bar element
- Modify: `src/main.ts` — pass charge state to HUD

- [x] **Step 1: Add `isCharging` and `chargeTimer` to player.ts**

In `src/game/player.ts`, find the public properties section (near the top, with `hasBall`, `isHumanControlled`, `isSprinting`, etc.) and add:

```typescript
  isCharging = false;
  chargeTimer = 0;
```

- [x] **Step 2: Update keyboard-controls.ts — charge-start on keydown, longer charge on keyup**

In `src/game/keyboard-controls.ts`, replace the Space handling in `handleKeyDown` (line 15-16):

```typescript
    if (code === 'Space') {
      this.spaceDownTime = performance.now();
    }
```
With:
```typescript
    if (code === 'Space') {
      this.spaceDownTime = performance.now();
      this.emitGesture({ type: 'charge-start', power: 0, direction: { x: 0, y: 0 } });
    }
```

In `handleKeyUp` (lines 32-36), change the power divisor from 500 to 1500:

```typescript
      const power = Math.min(holdTime / 500, 1);
```
To:
```typescript
      const power = Math.min(holdTime / 1500, 1);
```

- [x] **Step 3: Handle charge-start in game-session.ts handleGesture()**

In `src/game/game-session.ts`, in `handleGesture()`, add a new case before `case 'swipe-up'`:

```typescript
      case 'charge-start':
        if (hasBall) {
          human.isCharging = true;
          human.chargeTimer = 0;
        }
        break;
```

In the existing `case 'swipe-up':` block (~lines 543-551), wrap the shot logic so it also clears charging state:

Replace:
```typescript
      case 'swipe-up':
        if (hasBall) {
          const humanTeam = this.getPlayerTeam(this.humanPlayerId);
          const targetHoop = this.getTeamAttackHoop(humanTeam);
          human.loseBall();
          human.triggerShoot();
          this.lastShooterId = human.data.id;
          this.ball.shootAt(targetHoop, gesture.power);
        }
        break;
```
With:
```typescript
      case 'swipe-up':
        if (hasBall) {
          const humanTeam = this.getPlayerTeam(this.humanPlayerId);
          const targetHoop = this.getTeamAttackHoop(humanTeam);
          // Calculate charge multiplier
          const chargeLevel = human.chargeTimer / 1.5;
          let chargeMultiplier = 1.0;
          if (chargeLevel < 0.5) {
            chargeMultiplier = 0.5 + chargeLevel; // 0→0.5, 0.5→1.0
          } else if (chargeLevel >= 0.8) {
            chargeMultiplier = 1.5; // green zone
          } else {
            chargeMultiplier = 1.0 + (chargeLevel - 0.5) / 0.3 * 0.5; // 0.5→1.0, 0.8→1.5
          }
          human.isCharging = false;
          human.chargeTimer = 0;
          human.loseBall();
          human.triggerShoot();
          this.lastShooterId = human.data.id;
          this.lastChargeMultiplier = chargeMultiplier;
          this.ball.shootAt(targetHoop, gesture.power);
        }
        break;
```

Add a new field to the class properties (~line 55):
```typescript
  private lastChargeMultiplier = 1.0;
```

- [x] **Step 4: Lock player movement while charging**

In `src/game/game-session.ts`, in `processInput()` (~line 380), after getting the human player, add a charging update block BEFORE the movement code:

```typescript
    // Charge-up: lock in place while charging
    if (human.isCharging) {
      human.chargeTimer = Math.min(human.chargeTimer + dt, 1.5);
      // Still process gesture (for release), but zero movement
      if (input.gesture) {
        this.handleGesture(input.gesture, human);
        input.gesture = null;
      }
      return; // skip all movement
    }
```

Insert this right after line 383 (`if (!human) return;`) and before the joystick transform code.

- [x] **Step 5: Pass chargeMultiplier to shot accuracy**

In `src/game/game-session.ts`, where `calculateShotSuccess` is called (~line 269), change:

```typescript
        const goesIn = calculateShotSuccess({
          distance,
          shootingStat: shooter?.data.stats.shooting ?? 5,
          defenderDistance: defDist,
          shotType,
        });
```
To:
```typescript
        const goesIn = calculateShotSuccess({
          distance,
          shootingStat: shooter?.data.stats.shooting ?? 5,
          defenderDistance: defDist,
          shotType,
          chargeMultiplier: this.lastChargeMultiplier,
        });
        this.lastChargeMultiplier = 1.0; // reset after use
```

- [x] **Step 6: Add chargeMultiplier to shot-accuracy.ts**

In `src/game/shot-accuracy.ts`, add the field to ShotContext (line 5):

```typescript
export interface ShotContext {
  distance: number;
  shootingStat: number;
  defenderDistance: number;
  shotType: string;
  chargeMultiplier?: number;
}
```

Apply the multiplier after the contest penalty, before the final clamp (~line 43):

```typescript
  // Charge multiplier (default 1.0 for AI, variable for human)
  const charge = ctx.chargeMultiplier ?? 1.0;
  baseAccuracy *= charge;

  baseAccuracy = Math.max(0.02, Math.min(0.98, baseAccuracy));
```

- [x] **Step 7: Fix shot detection — synthetic velocity in ball.ts**

In `src/game/ball.ts`, change arc steps from 30 to 60 in `calculateArc()` (~line 58):

```typescript
    const steps = 30;
```
To:
```typescript
    const steps = 60;
```

In the arc update block (~lines 169-179), add synthetic velocity computation after updating position:

Replace:
```typescript
    if (this.arc.length > 0 && this.arcIndex < this.arc.length) {
      const stepsThisFrame = Math.max(1, Math.round(this.arcSpeed * dt));
      this.arcIndex = Math.min(this.arcIndex + stepsThisFrame, this.arc.length - 1);
      this.mesh.position.copy(this.arc[this.arcIndex]);
      if (this.arcIndex >= this.arc.length - 1) {
        this.isInFlight = false;
        this.arc = [];
        this.arcIndex = 0;
      }
      this.updateTrail(dt);
      return;
    }
```
With:
```typescript
    if (this.arc.length > 0 && this.arcIndex < this.arc.length) {
      const prevIndex = this.arcIndex;
      const stepsThisFrame = Math.max(1, Math.round(this.arcSpeed * dt));
      this.arcIndex = Math.min(this.arcIndex + stepsThisFrame, this.arc.length - 1);
      this.mesh.position.copy(this.arc[this.arcIndex]);

      // Compute synthetic velocity from arc movement (needed for shot detection)
      if (this.arcIndex > 0) {
        const prev = this.arc[Math.max(0, this.arcIndex - 1)];
        const curr = this.arc[this.arcIndex];
        this.velocity.subVectors(curr, prev).multiplyScalar(60); // per-second velocity
      }

      if (this.arcIndex >= this.arc.length - 1) {
        this.isInFlight = false;
        this.arc = [];
        this.arcIndex = 0;
      }
      this.updateTrail(dt);
      return;
    }
```

- [x] **Step 8: Widen shot detector tolerances + logging**

In `src/game/shot-detector.ts`, replace the detection check (~line 43):

```typescript
    if (horizontalDist <= 0.4 && verticalDist <= 0.5 && ballVelocity.y < 0) {
```
With:
```typescript
    // Log when ball is near hoop for debugging
    if (horizontalDist < 3) {
      console.log(`[SHOT] hDist=${horizontalDist.toFixed(2)} vDist=${verticalDist.toFixed(2)} velY=${ballVelocity.y.toFixed(2)} descending=${ballVelocity.y < 0}`);
    }

    if (horizontalDist <= 0.8 && verticalDist <= 1.0 && ballVelocity.y < 0) {
```

- [x] **Step 9: AI defenders jump when human is charging**

In `src/game/game-session.ts`, in `runAI()`, inside the defense branch (after `target = this.getZoneDefensePosition(...)` ~line 774), add:

```typescript
        // React to human charging — jump to block
        const humanPlayer = this.getHumanPlayer();
        if (humanPlayer?.isCharging && humanPlayer.chargeTimer > 0.75) {
          const distToShooter = player.distanceTo(humanPlayer.position);
          if (distToShooter < 5) {
            player.jump();
          }
        }
```

- [x] **Step 10: Add charge bar to HUD**

In `src/ui/hud.ts`, add a new element in the constructor, after the existing elements:

```typescript
    this.chargeBarContainer = document.createElement('div');
    Object.assign(this.chargeBarContainer.style, {
      position: 'absolute', bottom: '60px', left: '50%',
      transform: 'translateX(-50%)', width: '200px', height: '16px',
      backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '8px',
      border: '2px solid rgba(255,255,255,0.4)',
      overflow: 'hidden', zIndex: '10', display: 'none',
    });

    this.chargeBarFill = document.createElement('div');
    Object.assign(this.chargeBarFill.style, {
      height: '100%', width: '0%', borderRadius: '6px',
      transition: 'width 0.05s linear',
    });
    this.chargeBarContainer.appendChild(this.chargeBarFill);
    container.appendChild(this.chargeBarContainer);
```

Add the fields to the class:
```typescript
  private chargeBarContainer: HTMLElement;
  private chargeBarFill: HTMLElement;
```

Add an update method:
```typescript
  updateChargeBar(isCharging: boolean, chargeLevel: number): void {
    if (!isCharging) {
      this.chargeBarContainer.style.display = 'none';
      return;
    }
    this.chargeBarContainer.style.display = 'block';
    const pct = Math.min(chargeLevel * 100, 100);
    this.chargeBarFill.style.width = `${pct}%`;
    // Color: orange → green zone at 80%+
    if (chargeLevel >= 0.8) {
      this.chargeBarFill.style.backgroundColor = '#4caf50'; // green
    } else {
      this.chargeBarFill.style.backgroundColor = '#ff9800'; // orange
    }
  }
```

- [x] **Step 11: Wire charge bar in main.ts**

In `src/main.ts`, in the `update()` function, after the HUD clock/score updates (~line 306), add:

```typescript
    // Charge bar
    const human = session.getHumanPlayer();
    if (human) {
      hud.updateChargeBar(human.isCharging, human.chargeTimer / 1.5);
    }
```

- [x] **Step 12: Expose `getHumanPlayer()` charge state**

`getHumanPlayer()` is already public in game-session.ts. `isCharging` and `chargeTimer` are public on GamePlayer. No changes needed — just verify main.ts can access them.

- [x] **Step 13: Run all tests + build**

Run: `npx vitest run && npx vite build`
Expected: All pass, build succeeds

- [x] **Step 14: Commit**

```
git add src/game/ball.ts src/game/game-session.ts src/game/keyboard-controls.ts src/game/shot-detector.ts src/game/shot-accuracy.ts src/game/player.ts src/ui/hud.ts src/main.ts
git commit -m "feat: charge-up shooting with accuracy bonus, fix shot detection arc velocity + tolerances"
```

---

## Chunk 3: Controls Menu (Task 3)

### Task 3: Controls Menu

**Files:**
- Modify: `src/ui/menus.ts`

- [x] **Step 1: Add Controls button to main menu**

In `src/ui/menus.ts`, in `renderMainMenu()`, after the Full Game button (~line 133), add:

```typescript
    wrapper.appendChild(this.createSecondaryButton('Controls', 'settings'));
```

This uses the existing `'settings'` action which routes to `renderSettings()`.

- [x] **Step 2: Redesign settings screen with controls reference**

Replace the entire `renderSettings()` method (~lines 184-207):

```typescript
  private renderSettings(): void {
    const wrapper = this.createWrapper();

    const heading = document.createElement('h2');
    heading.textContent = 'CONTROLS';
    Object.assign(heading.style, {
      fontSize: '36px',
      fontWeight: 'bold',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      margin: '0 0 24px 0',
      textShadow: '0 0 10px #e94560',
    });
    wrapper.appendChild(heading);

    // Controls reference
    const controls: [string, string][] = [
      ['Movement', 'WASD / Left Stick'],
      ['Shoot (charge)', 'SPACE (hold & release)'],
      ['Pass', 'E / Horizontal Swipe'],
      ['Steal / Block', 'Q / Tap'],
      ['Jump', 'F'],
      ['Dunk', 'G / Swipe Down'],
      ['Sprint', 'SHIFT (hold)'],
    ];

    for (const [action, key] of controls) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', justifyContent: 'space-between',
        width: '100%', maxWidth: '320px',
        padding: '6px 0', fontFamily: 'monospace', fontSize: '14px',
        color: '#cccccc',
      });
      const labelEl = document.createElement('span');
      labelEl.textContent = action;
      labelEl.style.color = '#ffffff';
      const keyEl = document.createElement('span');
      keyEl.textContent = key;
      keyEl.style.color = '#aaaaaa';
      row.appendChild(labelEl);
      row.appendChild(keyEl);
      wrapper.appendChild(row);
    }

    // Divider
    const divider = document.createElement('hr');
    Object.assign(divider.style, {
      width: '100%', maxWidth: '320px',
      border: 'none', borderTop: '1px solid #444',
      margin: '16px 0',
    });
    wrapper.appendChild(divider);

    // Volume sliders
    wrapper.appendChild(this.createVolumeSlider('SFX Volume', 'sfx-volume'));
    wrapper.appendChild(this.createVolumeSlider('Music Volume', 'music-volume'));

    wrapper.appendChild(this.createSecondaryButton('Back', 'back'));

    this.container.appendChild(wrapper);
  }
```

- [x] **Step 3: Run tests + build**

Run: `npx vitest run && npx vite build`

- [x] **Step 4: Commit**

```
git add src/ui/menus.ts
git commit -m "feat: Controls menu with key mappings + volume sliders"
```

---
