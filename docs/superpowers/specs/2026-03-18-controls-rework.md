# Controls Rework + Sprint/Stamina + Pause Menu — Design Spec

## Overview

Six changes: (1) unify shot/dunk to Space key with proximity-based dunk trigger, (2) block/jump-block controls using existing guard animation, (3) sprint speed increase with stamina bar, (4) Tab player cycling, (5) Escape pause menu, (6) update controls screen.

## 1. Unified Shot/Dunk (Space Key)

### Problem

Dunk is currently a separate key (G / swipe-down). This is unintuitive — dunks should happen naturally when you drive to the hoop.

### Fix

Remove G as the dunk key. Dunks are now triggered automatically via Space based on proximity to the attacking hoop:

**In the paint** (within 5 units of attacking hoop) + **stamina >= 0.8** (near-full sprint bar):
- Space triggers a **dunk** — uses existing dunk mechanics (distance-based success rate, contest check, dunk animation)

**In the paint** + **stamina < 0.8**:
- Space triggers a normal **shot** (charge-up mechanic still works)

**Outside the paint** (> 5 units from hoop):
- Space triggers a normal **shot** (charge-up as implemented)

**Control flow in `handleGesture()` `swipe-up` case:** Replace the current body with a conditional that checks proximity and stamina FIRST, before calling any shot/dunk logic:

```typescript
case 'swipe-up':
  if (hasBall) {
    const humanTeam = this.getPlayerTeam(this.humanPlayerId);
    const targetHoop = this.getTeamAttackHoop(humanTeam);
    const dist = human.distanceTo(targetHoop);

    // Check stamina BEFORE draining this frame
    if (dist < 5 && human.stamina >= 0.8) {
      // DUNK PATH — reuse existing dunk logic (success rate, contest, animation)
      // ... existing dunk code from the old swipe-down handler ...
    } else {
      // SHOT PATH — existing charge-up shot logic
      // ... existing swipe-up code ...
    }
  }
  break;
```

Remove the `swipe-down` case for dunks entirely. Remove G → `swipe-down` from keyboard-controls.ts. G becomes Block (section 2).

Touch controls: swipe-up gets the same proximity check — no separate swipe-down dunk gesture.

## 2. Block / Jump Block

### Problem

The `guard` animation exists in player.ts but is never triggered by player input. There's no distinction between jumping and actively blocking.

### Fix

Three defensive actions with distinct mechanics:

| Action | Key | Animation | Effect |
|--------|-----|-----------|--------|
| Jump | F | `jump` | Pure vertical jump. If player intersects ball path mid-air, chance to **catch** the ball (interception). No active deflection bonus. |
| Guard | G | `guard` | Standing block. Player enters guard stance (arms up). While guarding, nearby shots have increased deflection chance. Good for close-range contests. |
| Jump Block | Shift+F | `jump-block` | Jump with force field activated. Highest reach, best deflection probability against arcing shots. |

**G key → Guard:** In `keyboard-controls.ts`, change G from `'swipe-down'` to `'block'`. In `handleGesture()`, the `'block'` case calls `human.triggerGuard()`.

**`triggerGuard()` implementation in player.ts:** Add a `guardTimer` property (like existing `stealTimer`/`shootTimer`). `triggerGuard()` sets `isGuarding = true`, `guardTimer = 1.0` (1 second guard stance). In `animate()`, tick down `guardTimer`; when it expires, set `isGuarding = false`. While `isGuarding` is true, the animation state is `'guard'`. Also: the `guard` animation creates a `block-screen` mesh that needs cleanup — when `animState` transitions away from `'guard'`, hide the block-screen mesh.

**Shift+F → Jump Block:** In `keyboard-controls.ts`, when F is pressed, check if Shift is already held (`this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')`). If so, emit `'jump-block'`; otherwise emit `'jump'`. In `handleGesture()`, `'jump-block'` calls `human.jump()` AND sets `human.isBlocking = true`. Clear `isBlocking` on landing (when `isJumping` becomes false).

**F key (plain jump):** Unchanged — calls `jump()`. Add a catch mechanic: in the ball update/pickup logic, if a player is `isJumping` (but NOT `isBlocking`) and the ball passes within 1.0 unit mid-air, 15% chance to catch the ball outright.

**Shot contest modifiers — applied as multipliers to existing `defenderDistance` penalty in `shot-accuracy.ts`:**

Add an optional `contestBonus` parameter to `ShotContext` (default 0). Before the existing contest penalty calculation, apply the bonus as an additional multiplier:

- Guard stance within 2 units of shooter → `contestBonus = 0.2` (reduces accuracy by 20%)
- Jump-block within 3 units of ball path → `contestBonus = 0.3` (reduces accuracy by 30%)
- These stack with the existing distance-based contest penalty (multiplicative)

The bonus is calculated in `game-session.ts` before calling `calculateShotSuccess()`, by scanning nearby defenders for `isGuarding` or `isJumping && isBlocking`.

**New properties on GamePlayer:**
- `isGuarding = false` — true while in guard animation
- `isBlocking = false` — true during jump-block (cleared on landing)
- `guardTimer = 0` — counts down from 1.0

**New GestureTypes:** Add `'block'` and `'jump-block'` to the GestureType union.

## 3. Sprint Speed + Stamina

### Problem

Sprint is too slow and has no resource cost, so there's no strategic decision about when to sprint.

### Fix

**Speed increase:** Change sprint multiplier in `player.ts` from 1.6x to 2.0x.

**Stamina system:** New properties on GamePlayer:
- `stamina = 1.0` — range 0.0 to 1.0
- `isExhausted = false` — prevents sprint flickering

Constants:
- `STAMINA_DRAIN_RATE = 0.3` per second (~3.3 seconds of full sprint)
- `STAMINA_RECHARGE_RATE = 0.2` per second (~5 seconds to full recharge)
- `STAMINA_EXHAUSTION_RECOVERY = 0.3` — can't sprint again until stamina reaches this
- `STAMINA_DUNK_THRESHOLD = 0.8` — stamina needed for proximity dunk

**Stamina management for human player** — in `processInput()`, BEFORE setting `isSprinting`:

```
if input.sprinting AND stamina > 0 AND !isExhausted:
  isSprinting = true
  stamina -= DRAIN_RATE * dt
  if stamina <= 0: stamina = 0, isExhausted = true, isSprinting = false
else:
  isSprinting = false
  stamina = min(1.0, stamina + RECHARGE_RATE * dt)
  if isExhausted AND stamina >= EXHAUSTION_RECOVERY: isExhausted = false
```

**AI stamina** — in `update()` (not `processInput()`), update stamina for ALL AI players each frame. In `runAI()`, the ball handler sprint logic (`player.isSprinting = true`) must check `player.stamina > 0 && !player.isExhausted` first.

**Fix input merge in main.ts:** The combined input at lines 274-280 of `main.ts` currently drops the `sprinting` field. Add `sprinting: kbInput.sprinting` to the merged `ControlInput` object.

**Stamina bar HUD:** Small horizontal bar, always visible during gameplay. Position: bottom-left of screen. Color: green > 0.5, yellow 0.2-0.5, red < 0.2. Same style as charge bar.

## 4. Tab Player Cycling

### Problem

No manual player switching. Auto-switch on rebound works but there's no way to choose who to control.

### Fix

**Tab key** cycles through the human's team players:

**On defense or loose ball:**
- Sort teammates by distance to the ball (closest first)
- Each Tab press switches to the next player in sorted list
- Wraps around

**On offense, currently holding the ball:**
- Cycles through off-ball teammates (sorted by distance to ball carrier)

**On offense, not holding the ball:**
- Switches directly to the ball carrier (one press)
- Next Tab press is then "on offense with ball" → cycles off-ball

Uses existing `switchHumanControl()`. Add `tabCycleIndex` field to game-session. Reset index inside `changePossession()` (which already covers possession changes and goals).

**keyboard-controls.ts:** Add Tab handling. Since `handleKeyDown` only receives `e.code` (not the event), the `preventDefault()` for Tab must happen in `main.ts` at the event listener level. Same for Escape. Update the event listeners in main.ts:

```typescript
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (e.code === 'Escape') e.preventDefault();
  keyboardControls.handleKeyDown(e.code);
});
```

In `keyboard-controls.ts`, Tab emits `'cycle-player'` gesture. In `game-session.ts`, handle it in `handleGesture()` via a new `cyclePlayerControl()` method.

**New GestureType:** Add `'cycle-player'` to the union.

## 5. Escape Pause Menu

### Problem

No way to pause, see controls mid-game, or quit.

### Fix

**Escape key** toggles pause. Handled in `main.ts`.

**Pause state:** Add `isPaused: boolean` to game state in main.ts. When paused:
- Stop calling `session.update(dt)` and `session.processInput()`
- Keep rendering (scene visible behind overlay)

**State machine transition:** Add `{ from: 'YourGame', to: 'MainMenu' }` to the transitions array in main.ts so the "Main Menu" button can work.

**Pause overlay:** New `PauseMenu` class in `src/ui/pause-menu.ts`. DOM overlay appended to `#ui-overlay`:
```
PAUSED

[Resume]        ← closes overlay, unpauses
[Controls]      ← shows controls reference (same key mapping table)
[Main Menu]     ← confirms "Quit current game?" then returns to main menu
```

**Resume:** Click Resume or press Escape again → unpauses, overlay removed.

**Main Menu:** Confirmation dialog first ("Quit current game?"). On confirm, transition state machine to MainMenu, clean up game session/scene.

**Controls sub-view:** Same key mapping data as `renderSettings()` in menus.ts. Extract the controls data array into a shared constant so both menus.ts and pause-menu.ts use the same source.

## 6. Updated Controls Screen

Update the controls reference in BOTH the main menu Controls screen AND the pause menu controls view:

```
CONTROLS

Movement ........... WASD / Left Stick
Shoot / Dunk ....... SPACE (hold to charge; dunk near hoop w/ stamina)
Pass ............... E / Horizontal Swipe
Steal .............. Q / Tap
Guard .............. G
Jump ............... F
Jump Block ......... SHIFT + F
Sprint ............. SHIFT (hold, uses stamina)
Switch Player ...... TAB
Pause .............. ESC
```

Note: Block/Guard touch controls are intentionally keyboard-only. Touch players rely on auto-guard behavior from AI.

## Files to Modify

- `src/game/controls.ts` — add 'block', 'jump-block', 'cycle-player' to GestureType
- `src/game/keyboard-controls.ts` — remap G to block, add Shift+F for jump-block, add Tab for cycle-player
- `src/game/player.ts` — add `stamina`, `isExhausted`, `isGuarding`, `isBlocking`, `guardTimer` properties; `triggerGuard()` method; sprint speed 2.0x; guard cleanup for block-screen mesh
- `src/game/game-session.ts` — handle new gestures (block, jump-block, charge-start→dunk proximity, cycle-player); stamina drain/recharge for human + AI; shot contest modifiers; dunk-via-shot routing
- `src/game/shot-accuracy.ts` — add `contestBonus` parameter
- `src/ui/hud.ts` — add stamina bar element
- `src/ui/pause-menu.ts` — new file for pause overlay with resume/controls/main-menu
- `src/ui/menus.ts` — update controls reference text, extract shared controls data
- `src/main.ts` — Escape/Tab preventDefault, isPaused state, pause/resume logic, stamina bar wiring, fix sprinting in input merge, add YourGame→MainMenu state transition
