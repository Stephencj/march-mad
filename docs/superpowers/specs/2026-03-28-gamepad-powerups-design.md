# Game Mechanics Pass: Gamepad Support + Powerup Fix

**Date:** 2026-03-28
**Scope:** Gamepad controller support, powerup spawn fix, haptic feedback

---

## 1. Powerup Spawn Fix + Smart Placement

### Bug
In `src/systems/powerups.ts:66-67`, spawn coordinates use swapped axes:
- `x: Math.random() * 28 - 14` → range [-14, +14] (should be court width ~15)
- `z: Math.random() * 15 - 7.5` → range [-7.5, +7.5] (should be court length ~28)

Court dimensions (`full-court.ts`): width=15 (x-axis), length=28 (z-axis). Players clamped to x: [-7, 7]. Powerups spawn far outside playable area.

### Fix
- Correct to `x: [-6.5, 6.5]` (0.5 margin from sidelines at ±7)
- Correct to `z: [-12, 12]` (1.0 margin from baselines at ±13)

### Smart Placement
New `findValidSpawnPosition(players)` function:
- Generate candidate within corrected bounds
- Reject if within **2.0 units** of any player position
- Reject if within **3.0 units** of either hoop (|z| > 11)
- Reject if inside **paint** (|x| < paintWidth/2=1.8 AND |z| > length/2 - paintLength = 8.2)
- Retry up to 10 times, accept last candidate to avoid infinite loops
- `update()` signature gains `playerPositions: {x: number, z: number}[]` parameter

---

## 2. Gamepad Controls

### New file: `src/game/gamepad-controls.ts`

`GamepadControls` class implementing same `getInput() → ControlInput` interface.

### Polling
- `navigator.getGamepads()` called each frame
- First connected gamepad tracked via `gamepadconnected`/`gamepaddisconnected` events
- Left stick → joystick x/y with deadzone of 0.15

### Button Mapping

| Button Index | Xbox    | PS      | Nintendo | Gesture                                          |
|-------------|---------|---------|----------|--------------------------------------------------|
| 0           | A       | ×       | B        | `charge-start` (down) / `swipe-up` (up, w/power) |
| 1           | B       | ○       | A        | `tap` (steal)                                    |
| 2           | X       | □       | Y        | `pass`                                           |
| 3           | Y       | △       | X        | `jump`                                           |
| 4           | LB      | L1      | L        | `jump-block`                                     |
| 5           | RB      | R1      | R        | `cycle-player`                                   |
| 6           | LT      | L2      | ZL       | `block` (guard, analog > 0.5)                    |
| 7           | RT      | R2      | ZR       | sprint (analog > 0.3)                            |
| 9           | Start   | Options | +        | Pause (one-shot, not gesture)                    |

### Charge-Up Shooting
Button 0 press starts `chargeTimer`, release emits `swipe-up` with `power = holdTime / 1500`.

### Nintendo Button Swap
Detect controller ID containing "Pro Controller" or vendor ID `057e`. When detected, swap buttons 0↔1 and 2↔3 internally so physical south/east/west/north positions match intended actions.

---

## 3. Input Manager & Auto-Detection

### New file: `src/game/input-manager.ts`

Thin `InputManager` class:
- Holds `TouchControls`, `KeyboardControls`, `GamepadControls`
- Single `getInput(): ControlInput` merging all sources
- Tracks `lastUsedDevice: 'keyboard' | 'gamepad' | 'touch'`
- Exposes `getControllerType(): 'xbox' | 'playstation' | 'nintendo' | null`
- Handles `gamepadconnected`/`gamepaddisconnected` events

### Merge Priority
- Joystick: first non-zero wins (touch > gamepad > keyboard)
- Gesture: first non-null wins
- Sprint: gamepad RT OR keyboard Shift

### Integration
Replace manual merge block in `main.ts:311-320` with `inputManager.getInput()`.

---

## 4. Haptic Feedback

### New file: `src/systems/haptics.ts`

`HapticManager` class using Gamepad API `vibrationActuator.playEffect('dual-rumble', ...)`.

### Presets

| Event          | Intensity   | Duration     | Pattern               |
|---------------|-------------|-------------|----------------------|
| Shoot release  | 0.3         | 100ms        | Light tap            |
| Score/dunk     | 0.7         | 200ms        | Strong pulse         |
| Block/steal    | 0.5         | 150ms        | Medium hit           |
| Powerup pickup | 0.4 → 0.8  | 100ms, 200ms | Double pulse         |
| Charge ongoing | 0.1 → 0.5  | Continuous   | Ramps with charge    |
| Foul           | 0.6         | 300ms        | Sustained buzz       |

### Integration
- Wired into `EventBus` events: `score`, `foul`, `powerup`
- Direct calls from gesture handlers for shoot/block/steal/charge
- Graceful no-op if `vibrationActuator` unavailable

---

## 5. UI Updates

### Controls Screen
- `menus.ts` CONTROLS_DATA and `pause-menu.ts` controls view: add second column showing gamepad button equivalents
- Column content switches based on `inputManager.getControllerType()` (Xbox/PS/Nintendo labels)

### HUD Indicator
- Small icon in HUD corner showing connected controller type
- Hidden when no gamepad connected (keyboard-only)

---

## Files Changed

| File | Change |
|------|--------|
| `src/systems/powerups.ts` | Fix spawn bounds, add `findValidSpawnPosition()`, update `update()` signature |
| `src/game/gamepad-controls.ts` | **New** — GamepadControls class |
| `src/game/input-manager.ts` | **New** — InputManager with auto-detection |
| `src/systems/haptics.ts` | **New** — HapticManager |
| `src/main.ts` | Replace manual input merge with InputManager, wire haptics |
| `src/game/game-session.ts` | Pass player positions to powerup update, emit haptic events |
| `src/ui/menus.ts` | Add gamepad column to CONTROLS_DATA |
| `src/ui/pause-menu.ts` | Add gamepad column to controls view |
| `src/ui/hud.ts` | Add controller type indicator |
| `src/core/types.ts` | Add `ControllerType` type if needed |

## Testing

- Unit tests for `GamepadControls` button mapping and deadzone
- Unit tests for `findValidSpawnPosition()` bounds and rejection logic
- Unit tests for Nintendo button swap detection
- Integration: manual testing with Xbox, PS, and Nintendo Pro controllers
- Haptics: manual verification (no automated test for vibration)
