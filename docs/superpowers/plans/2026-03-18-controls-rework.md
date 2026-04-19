# Controls Rework + Sprint/Stamina + Pause Menu — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remap controls (unified shot/dunk, guard/jump-block, Tab cycling, Escape pause), add sprint stamina system with HUD bar, add pause menu.

**Architecture:** Five tasks: (1) player properties + stamina + sprint speed, (2) keyboard remapping + gesture types, (3) game-session gesture handlers + dunk-via-proximity + stamina drain + Tab cycling + contest modifiers, (4) stamina bar HUD + main.ts wiring, (5) pause menu + updated controls screen.

**Tech Stack:** Three.js, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-18-controls-rework.md`

---

## Chunk 1: Foundation + Controls (Tasks 1-2)

### Task 1: Player Properties + Sprint Speed

**Files:**
- Modify: `src/game/player.ts`

- [ ] **Step 1: Add stamina, guard, and block properties**

In `src/game/player.ts`, find the public properties section (near `isCharging`, `chargeTimer`, `hasBall`, etc.) and add:

```typescript
  stamina = 1.0;
  isExhausted = false;
  isGuarding = false;
  isBlocking = false;
  guardTimer = 0;
```

- [ ] **Step 2: Add `triggerGuard()` method**

Add near the existing `triggerSteal()`, `triggerShoot()` methods:

```typescript
  triggerGuard(): void {
    this.isGuarding = true;
    this.guardTimer = 1.0;
    this.animState = 'guard';
    this.animTime = 0;
  }
```

- [ ] **Step 3: Add guard timer tick and cleanup in `animate()`**

In the `animate()` method, at the TOP (before the animation state machine), add guard timer handling:

```typescript
    // Guard timer
    if (this.isGuarding) {
      this.guardTimer -= dt;
      if (this.guardTimer <= 0) {
        this.isGuarding = false;
        this.guardTimer = 0;
        // Hide block-screen mesh if it exists
        const blockScreen = this.group.getObjectByName('block-screen');
        if (blockScreen) blockScreen.visible = false;
      }
    }

    // Clear blocking flag on landing
    if (this.isBlocking && !this.isJumping) {
      this.isBlocking = false;
    }
```

Also, in the animation state determination section, ensure `isGuarding` overrides to `'guard'` state:

Find where animation states are determined (the if/else chain with `isMoving`, `isSprinting`, etc.) and add before the idle fallback:

```typescript
    } else if (this.isGuarding) {
      this.animState = 'guard';
```

- [ ] **Step 4: Increase sprint speed**

Find the sprint multiplier line (search for `1.6`):
```typescript
    const speed = this.isSprinting ? this.moveSpeed * 1.6 : this.moveSpeed;
```
Change to:
```typescript
    const speed = this.isSprinting ? this.moveSpeed * 2.0 : this.moveSpeed;
```

- [ ] **Step 5: Run tests + build, commit**

Run: `npx vitest run && npx vite build`
Commit: `git commit -am "feat: player stamina, guard, block properties + sprint speed 2.0x"`

---

### Task 2: Keyboard Remapping + Gesture Types

**Files:**
- Modify: `src/game/controls.ts`
- Modify: `src/game/keyboard-controls.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add new gesture types**

In `src/game/controls.ts`, line 9, change:
```typescript
export type GestureType = 'swipe-up' | 'pass' | 'tap' | 'swipe-down' | 'double-tap' | 'jump' | 'charge-start';
```
To:
```typescript
export type GestureType = 'swipe-up' | 'pass' | 'tap' | 'swipe-down' | 'double-tap' | 'jump' | 'charge-start' | 'block' | 'jump-block' | 'cycle-player';
```

- [ ] **Step 2: Remap keyboard controls**

Replace `src/game/keyboard-controls.ts` `handleKeyDown` method entirely:

```typescript
  handleKeyDown(code: string): void {
    this.keys.add(code);
    if (code === 'Space') {
      this.spaceDownTime = performance.now();
      this.emitGesture({ type: 'charge-start', power: 0, direction: { x: 0, y: 0 } });
    } else if (code === 'KeyE') {
      this.emitGesture({ type: 'pass', power: 0, direction: { x: 0, y: -1 } });
    } else if (code === 'KeyQ') {
      this.emitGesture({ type: 'tap', power: 0, direction: { x: 0, y: 0 } });
    } else if (code === 'KeyF') {
      // Shift+F = jump-block, F alone = jump
      if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
        this.emitGesture({ type: 'jump-block', power: 1, direction: { x: 0, y: 0 } });
      } else {
        this.emitGesture({ type: 'jump', power: 1, direction: { x: 0, y: 0 } });
      }
    } else if (code === 'KeyG') {
      this.emitGesture({ type: 'block', power: 0, direction: { x: 0, y: 0 } });
    } else if (code === 'Tab') {
      this.emitGesture({ type: 'cycle-player', power: 0, direction: { x: 0, y: 0 } });
    }
  }
```

- [ ] **Step 3: Add Tab and Escape preventDefault in main.ts**

In `src/main.ts`, replace lines 121-122:
```typescript
document.addEventListener('keydown', (e) => keyboardControls.handleKeyDown(e.code));
document.addEventListener('keyup', (e) => keyboardControls.handleKeyUp(e.code));
```
With:
```typescript
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' || e.code === 'Escape') e.preventDefault();
  keyboardControls.handleKeyDown(e.code);
});
document.addEventListener('keyup', (e) => keyboardControls.handleKeyUp(e.code));
```

- [ ] **Step 4: Fix sprinting in input merge**

In `src/main.ts`, in the `update()` function (~line 274-280), the merged `ControlInput` is missing `sprinting`. Change:
```typescript
    const input: ControlInput = {
      joystick: {
        x: touchInput.joystick.x || kbInput.joystick.x,
        y: touchInput.joystick.y || kbInput.joystick.y,
      },
      gesture: touchInput.gesture ?? kbInput.gesture,
    };
```
To:
```typescript
    const input: ControlInput = {
      joystick: {
        x: touchInput.joystick.x || kbInput.joystick.x,
        y: touchInput.joystick.y || kbInput.joystick.y,
      },
      gesture: touchInput.gesture ?? kbInput.gesture,
      sprinting: kbInput.sprinting,
    };
```

- [ ] **Step 5: Add YourGame to MainMenu state transition**

In `src/main.ts`, in the `transitions` array (~line 49-69), add:
```typescript
  { from: 'YourGame', to: 'MainMenu' },
```

- [ ] **Step 6: Run tests + build, commit**

Run: `npx vitest run && npx vite build`
Commit: `git commit -am "feat: remap controls — G=guard, Shift+F=jump-block, Tab=cycle, fix sprint input"`

---

## Chunk 2: Game Logic (Task 3)

### Task 3: Game Session — Gesture Handlers + Stamina + Dunk Proximity + Tab Cycling + Contest

**Files:**
- Modify: `src/game/game-session.ts`
- Modify: `src/game/shot-accuracy.ts`

- [ ] **Step 1: Add new fields to GameSession**

Add near other private fields:
```typescript
  private tabCycleIndex = 0;
```

- [ ] **Step 2: Rewrite `swipe-up` case for dunk-via-proximity**

Replace the current `case 'swipe-up':` block (~lines 563-585) with:

```typescript
      case 'swipe-up':
        if (hasBall) {
          const humanTeam = this.getPlayerTeam(this.humanPlayerId);
          const targetHoop = this.getTeamAttackHoop(humanTeam);
          const dist = human.distanceTo(targetHoop);
          const chargeLevel = human.chargeTimer / 1.5;

          // Calculate charge multiplier
          let chargeMultiplier = 1.0;
          if (chargeLevel < 0.5) {
            chargeMultiplier = 0.5 + chargeLevel;
          } else if (chargeLevel >= 0.8) {
            chargeMultiplier = 1.5;
          } else {
            chargeMultiplier = 1.0 + (chargeLevel - 0.5) / 0.3 * 0.5;
          }

          human.isCharging = false;
          human.chargeTimer = 0;

          // DUNK PATH: in the paint + high stamina
          if (dist < 5 && human.stamina >= 0.8) {
            let successRate: number;
            if (dist < 3) successRate = 0.9;
            else if (dist < 5) successRate = 0.7;
            else successRate = 0.4;
            successRate += (human.data.stats.dunkPower - 5) * 0.03;
            successRate = Math.max(0.1, Math.min(0.95, successRate));

            const opponents = humanTeam === 'home' ? this.awayPlayers : this.homePlayers;
            let contested = false;
            for (const def of opponents) {
              const defDist = def.distanceTo(targetHoop);
              const isInPath = defDist < dist && def.distanceTo(human.position) < 3;
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
            // SHOT PATH: normal charge-up shot
            human.loseBall();
            human.triggerShoot();
            this.lastShooterId = human.data.id;
            this.lastChargeMultiplier = chargeMultiplier;
            this.ball.shootAt(targetHoop, gesture.power);
          }
        }
        break;
```

- [ ] **Step 3: Remove the `swipe-down` dunk case**

Delete the entire `case 'swipe-down': { ... }` block (~lines 587-635). Dunks are now handled via proximity in `swipe-up`.

- [ ] **Step 4: Add block, jump-block, and cycle-player gesture handlers**

In `handleGesture()`, add these cases after `charge-start`:

```typescript
      case 'block':
        if (!hasBall) {
          human.triggerGuard();
        }
        break;

      case 'jump-block':
        if (!hasBall) {
          human.jump();
          human.isBlocking = true;
        }
        break;

      case 'cycle-player':
        this.cyclePlayerControl();
        break;
```

- [ ] **Step 5: Add `cyclePlayerControl()` method**

Add after `switchHumanControl()`:

```typescript
  private cyclePlayerControl(): void {
    const humanTeam = this.getPlayerTeam(this.humanPlayerId);
    const teamPlayers = humanTeam === 'home' ? this.homePlayers : this.awayPlayers;
    const possession = this.matchEngine.state.possession;
    const onOffense = possession === humanTeam;
    const humanHasBall = this.getHumanPlayer()?.hasBall ?? false;

    if (onOffense && !humanHasBall) {
      // On offense without ball: switch to ball carrier
      const carrier = teamPlayers.find(p => p.hasBall);
      if (carrier && carrier.data.id !== this.humanPlayerId) {
        this.switchHumanControl(carrier.data.id);
        this.tabCycleIndex = 0;
      }
      return;
    }

    // Defense, loose ball, or offense with ball: cycle through teammates
    const ballPos = this.ball.heldBy
      ? this.getPlayerById(this.ball.heldBy)?.position ?? this.ball.mesh.position
      : this.ball.mesh.position;

    const candidates = teamPlayers
      .filter(p => p.data.id !== this.humanPlayerId)
      .sort((a, b) => a.distanceTo(ballPos) - b.distanceTo(ballPos));

    if (candidates.length === 0) return;

    this.tabCycleIndex = this.tabCycleIndex % candidates.length;
    const target = candidates[this.tabCycleIndex];
    this.switchHumanControl(target.data.id);
    this.tabCycleIndex = (this.tabCycleIndex + 1) % candidates.length;
  }
```

- [ ] **Step 6: Reset tab cycle index in `changePossession()`**

In `changePossession()`, add:
```typescript
    this.tabCycleIndex = 0;
```

- [ ] **Step 7: Add stamina drain/recharge in `processInput()`**

In `processInput()`, replace line 414 (`human.isSprinting = input.sprinting ?? false;`) with:

```typescript
    // Stamina-gated sprinting
    const wantsSprint = input.sprinting ?? false;
    if (wantsSprint && human.stamina > 0 && !human.isExhausted) {
      human.isSprinting = true;
      human.stamina -= 0.3 * dt;
      if (human.stamina <= 0) {
        human.stamina = 0;
        human.isExhausted = true;
        human.isSprinting = false;
      }
    } else {
      human.isSprinting = false;
      human.stamina = Math.min(1.0, human.stamina + 0.2 * dt);
      if (human.isExhausted && human.stamina >= 0.3) {
        human.isExhausted = false;
      }
    }
```

- [ ] **Step 8: Add AI stamina management in `update()`**

In `update()`, after `updatePowerups(dt)`, add:

```typescript
    // AI stamina management
    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue;
      if (player.isSprinting && player.stamina > 0 && !player.isExhausted) {
        player.stamina -= 0.3 * dt;
        if (player.stamina <= 0) {
          player.stamina = 0;
          player.isExhausted = true;
          player.isSprinting = false;
        }
      } else if (!player.isSprinting) {
        player.stamina = Math.min(1.0, player.stamina + 0.2 * dt);
        if (player.isExhausted && player.stamina >= 0.3) {
          player.isExhausted = false;
        }
      }
    }
```

In `runAI()`, where ball handler sets `player.isSprinting = true`, change to:
```typescript
          player.isSprinting = player.stamina > 0 && !player.isExhausted;
```

- [ ] **Step 9: Add contest bonus to shot accuracy**

In `src/game/shot-accuracy.ts`, add `contestBonus` to ShotContext:
```typescript
  contestBonus?: number; // 0-1, additional accuracy reduction from guard/block
```

After the existing contest penalty and charge multiplier lines, before the final clamp, add:
```typescript
  // Active contest bonus (guard/jump-block)
  const bonus = ctx.contestBonus ?? 0;
  baseAccuracy *= (1 - bonus);
```

In `src/game/game-session.ts`, where `calculateShotSuccess` is called, compute the contest bonus by scanning nearby defenders. Add BEFORE the `calculateShotSuccess` call:

```typescript
        // Compute active contest bonus from guarding/blocking defenders
        let contestBonus = 0;
        const shooterPos = shooter?.position ?? this.ball.mesh.position;
        const defTeam = this.getPlayerTeam(this.lastShooterId) === 'home' ? this.awayPlayers : this.homePlayers;
        for (const def of defTeam) {
          const d = def.distanceTo(shooterPos);
          if (def.isGuarding && d < 2) {
            contestBonus = Math.max(contestBonus, 0.2);
          }
          if (def.isJumping && def.isBlocking && d < 3) {
            contestBonus = Math.max(contestBonus, 0.3);
          }
        }
```

Then pass `contestBonus` in the call:
```typescript
          chargeMultiplier: this.lastChargeMultiplier,
          contestBonus,
```

- [ ] **Step 10: Add jump catch mechanic**

In `update()`, after the loose ball pickup check and before the `runAI()` call, add:

```typescript
    // Jump catch: airborne player (not blocking) can catch ball passing nearby
    if (this.ball.isInFlight && !this.pendingPassTarget) {
      for (const p of this.getAllPlayers()) {
        if (p.isJumping && !p.isBlocking && p.distanceTo(this.ball.mesh.position) < 1.0) {
          if (Math.random() < 0.15) {
            this.ball.isInFlight = false;
            this.ball.velocity.set(0, 0, 0);
            this.setBallHolder(p.data.id);
            const catchTeam = this.getPlayerTeam(p.data.id);
            if (this.matchEngine.state.possession !== catchTeam) {
              this.changePossession(catchTeam, `jump catch by ${p.data.id}`);
            }
            this.events.emit('splash', { text: 'INTERCEPTED!', color: '#f39c12' });
            break;
          }
        }
      }
    }
```

- [ ] **Step 11: Run tests + build, commit**

Run: `npx vitest run && npx vite build`
Commit: `git commit -am "feat: dunk-via-proximity, guard/jump-block, Tab cycling, stamina system, contest modifiers"`

---

## Chunk 3: HUD + Pause Menu + Controls Screen (Tasks 4-5)

### Task 4: Stamina Bar HUD

**Files:**
- Modify: `src/ui/hud.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add stamina bar element to HUD**

In `src/ui/hud.ts`, add fields:
```typescript
  private staminaBarContainer: HTMLElement;
  private staminaBarFill: HTMLElement;
```

In the constructor, after the charge bar elements, add:
```typescript
    this.staminaBarContainer = document.createElement('div');
    Object.assign(this.staminaBarContainer.style, {
      position: 'absolute', bottom: '20px', left: '20px',
      width: '120px', height: '12px',
      backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '6px',
      border: '2px solid rgba(255,255,255,0.3)',
      overflow: 'hidden', zIndex: '10',
    });

    this.staminaBarFill = document.createElement('div');
    Object.assign(this.staminaBarFill.style, {
      height: '100%', width: '100%', borderRadius: '4px',
      backgroundColor: '#4caf50',
      transition: 'width 0.1s linear',
    });
    this.staminaBarContainer.appendChild(this.staminaBarFill);
    container.appendChild(this.staminaBarContainer);
```

Add update method:
```typescript
  updateStaminaBar(stamina: number): void {
    const pct = Math.min(stamina * 100, 100);
    this.staminaBarFill.style.width = `${pct}%`;
    if (stamina > 0.5) {
      this.staminaBarFill.style.backgroundColor = '#4caf50';
    } else if (stamina > 0.2) {
      this.staminaBarFill.style.backgroundColor = '#ffeb3b';
    } else {
      this.staminaBarFill.style.backgroundColor = '#f44336';
    }
  }
```

- [ ] **Step 2: Wire stamina bar in main.ts**

In `src/main.ts`, in `update()`, after the charge bar update line, add:
```typescript
    hud.updateStaminaBar(human.stamina);
```

- [ ] **Step 3: Run tests + build, commit**

Run: `npx vitest run && npx vite build`
Commit: `git commit -am "feat: stamina bar HUD — green/yellow/red based on level"`

---

### Task 5: Pause Menu + Updated Controls Screen

**Files:**
- Create: `src/ui/pause-menu.ts`
- Modify: `src/ui/menus.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Extract shared controls data**

In `src/ui/menus.ts`, add an exported constant BEFORE the class definition:

```typescript
export const CONTROLS_DATA: [string, string][] = [
  ['Movement', 'WASD / Left Stick'],
  ['Shoot / Dunk', 'SPACE (hold to charge; dunk near hoop)'],
  ['Pass', 'E / Horizontal Swipe'],
  ['Steal', 'Q / Tap'],
  ['Guard', 'G'],
  ['Jump', 'F'],
  ['Jump Block', 'SHIFT + F'],
  ['Sprint', 'SHIFT (hold, uses stamina)'],
  ['Switch Player', 'TAB'],
  ['Pause', 'ESC'],
];
```

Update `renderSettings()` to use `CONTROLS_DATA` instead of the inline controls array. Replace the local `const controls` declaration and its data with:
```typescript
    for (const [action, key] of CONTROLS_DATA) {
```

- [ ] **Step 2: Create pause-menu.ts**

Create `src/ui/pause-menu.ts`. The class needs:
- `show()` / `hide()` / `isVisible` getter
- Three views: pause main, controls reference, quit confirmation
- Uses `CONTROLS_DATA` from menus.ts for the controls view
- `onAction` callback for 'resume' and 'quit'
- Same dark overlay style as existing menus (rgba(10, 10, 20, 0.85))
- When switching views, clear the overlay's children using `while (overlay.firstChild) overlay.removeChild(overlay.firstChild)` and rebuild (do NOT use innerHTML for security)

Build the PauseMenu class with these methods:
- `constructor(container, onAction)` — stores references
- `show()` — creates overlay div, calls `renderPauseView()`
- `hide()` — removes overlay
- `renderPauseView()` — PAUSED title + Resume/Controls/Main Menu buttons
- `renderControlsView()` — CONTROLS title + key mapping rows from CONTROLS_DATA + Back button
- `renderConfirmQuit()` — "Quit current game?" + Quit/Cancel buttons

Button styles: Resume uses primary color `#e94560`, others use transparent with `#444` border. All white text, sans-serif font.

Navigation: Controls button calls `renderControlsView()`, Back returns to `renderPauseView()`, Main Menu calls `renderConfirmQuit()`, Quit calls `onAction('quit')`, Resume calls `onAction('resume')`.

- [ ] **Step 3: Wire pause menu in main.ts**

Import the PauseMenu:
```typescript
import { PauseMenu } from '@/ui/pause-menu';
```

After the HUD setup, create pause infrastructure:
```typescript
const pauseContainer = document.createElement('div');
pauseContainer.id = 'pause-container';
pauseContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
uiOverlay.appendChild(pauseContainer);

let isPaused = false;
const pauseMenu = new PauseMenu(pauseContainer, (action) => {
  if (action === 'resume') {
    isPaused = false;
    pauseMenu.hide();
  } else if (action === 'quit') {
    isPaused = false;
    pauseMenu.hide();
    if (session) {
      session.removeFromScene(scene);
      session = null;
    }
    stateMachine.transition('MainMenu');
    menuUI.show('main');
    hud.hide();
  }
});
```

Update the keydown event listener to handle Escape for pause toggle:
```typescript
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' || e.code === 'Escape') e.preventDefault();
  if (e.code === 'Escape' && stateMachine.current === 'YourGame') {
    isPaused = !isPaused;
    if (isPaused) {
      pauseMenu.show();
    } else {
      pauseMenu.hide();
    }
    return;
  }
  if (!isPaused) {
    keyboardControls.handleKeyDown(e.code);
  }
});
```

In the `update()` function, add `&& !isPaused` to the game condition:
```typescript
  if (session && stateMachine.current === 'YourGame' && !isPaused) {
```

- [ ] **Step 4: Run tests + build, commit**

Run: `npx vitest run && npx vite build`
Commit: `git commit -am "feat: pause menu (ESC), updated controls screen, shared controls data"`

---
