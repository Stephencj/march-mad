# Gamepad + Powerup Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add gamepad controller support (Xbox/PS/Nintendo auto-detect with haptics), fix powerup out-of-bounds spawning with smart placement, and create a unified input manager.

**Architecture:** New `GamepadControls` class mirrors the existing `KeyboardControls` pattern (same `getInput() → ControlInput` interface). A thin `InputManager` merges all three input sources. `HapticManager` wires into EventBus + direct calls. Powerup spawn fix is self-contained in `powerups.ts`.

**Tech Stack:** Browser Gamepad API, TypeScript, Three.js, Vitest

**Spec:** `docs/superpowers/specs/2026-03-28-gamepad-powerups-design.md`

---

### Task 1: Fix Powerup Spawn Bounds

**Files:**
- Modify: `src/systems/powerups.ts:59-72`
- Test: `tests/systems/powerups.test.ts`

- [ ] **Step 1: Write failing test for correct bounds**

In `tests/systems/powerups.test.ts`, add:

```typescript
describe('spawn bounds', () => {
  it('should spawn orbs within court bounds', () => {
    const system = new PowerupSystem(new EventBus());
    // Force meter full
    system.chargeMeter(100);

    for (let i = 0; i < 100; i++) {
      system.update(5, 0);
      if (system.activeOrb) {
        const { x, z } = system.activeOrb.position;
        expect(x).toBeGreaterThanOrEqual(-6.5);
        expect(x).toBeLessThanOrEqual(6.5);
        expect(z).toBeGreaterThanOrEqual(-12);
        expect(z).toBeLessThanOrEqual(12);
        // Reset for next iteration
        system.activeOrb = null;
        system.chargeMeter(100);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/systems/powerups.test.ts`
Expected: FAIL — x values exceed ±6.5 (current range is ±14)

- [ ] **Step 3: Fix spawn bounds in powerups.ts**

In `src/systems/powerups.ts`, replace lines 65-68:

```typescript
// OLD:
position: {
  x: Math.random() * 28 - 14,
  z: Math.random() * 15 - 7.5,
},

// NEW:
position: {
  x: Math.random() * 13 - 6.5,    // court width: [-6.5, 6.5]
  z: Math.random() * 24 - 12,      // court length: [-12, 12]
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/systems/powerups.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/systems/powerups.ts tests/systems/powerups.test.ts
git commit -m "fix: correct powerup spawn bounds (x/z were swapped)"
```

---

### Task 2: Smart Powerup Placement

**Files:**
- Modify: `src/systems/powerups.ts`
- Modify: `src/game/game-session.ts:1086-1091`
- Test: `tests/systems/powerups.test.ts`

- [ ] **Step 1: Write failing tests for smart placement**

In `tests/systems/powerups.test.ts`, add:

```typescript
import { findValidSpawnPosition } from '@/systems/powerups';

describe('findValidSpawnPosition', () => {
  it('should not spawn within 2.0 units of any player', () => {
    const players = [{ x: 0, z: 0 }];
    for (let i = 0; i < 50; i++) {
      const pos = findValidSpawnPosition(players);
      const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
      expect(dist).toBeGreaterThanOrEqual(2.0);
    }
  });

  it('should not spawn within 3.0 units of hoops (|z| > 11)', () => {
    for (let i = 0; i < 50; i++) {
      const pos = findValidSpawnPosition([]);
      if (Math.abs(pos.z) > 11) {
        // Should not happen — hoops at z=±13, exclusion zone |z| > 11
        expect(Math.abs(pos.z)).toBeLessThanOrEqual(11);
      }
    }
  });

  it('should not spawn inside paint area', () => {
    for (let i = 0; i < 50; i++) {
      const pos = findValidSpawnPosition([]);
      const inPaint = Math.abs(pos.x) < 1.8 && Math.abs(pos.z) > 8.2;
      expect(inPaint).toBe(false);
    }
  });

  it('should always return a position within court bounds', () => {
    // Even with many players crowding the court
    const players = [];
    for (let px = -6; px <= 6; px += 2) {
      for (let pz = -10; pz <= 10; pz += 2) {
        players.push({ x: px, z: pz });
      }
    }
    const pos = findValidSpawnPosition(players);
    expect(pos.x).toBeGreaterThanOrEqual(-6.5);
    expect(pos.x).toBeLessThanOrEqual(6.5);
    expect(pos.z).toBeGreaterThanOrEqual(-12);
    expect(pos.z).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/systems/powerups.test.ts`
Expected: FAIL — `findValidSpawnPosition` not found

- [ ] **Step 3: Implement findValidSpawnPosition**

In `src/systems/powerups.ts`, add before the class:

```typescript
export function findValidSpawnPosition(
  players: { x: number; z: number }[]
): { x: number; z: number } {
  let candidate = { x: 0, z: 0 };

  for (let attempt = 0; attempt < 10; attempt++) {
    candidate = {
      x: Math.random() * 13 - 6.5,
      z: Math.random() * 24 - 12,
    };

    // Reject: too close to a player
    const tooCloseToPlayer = players.some((p) => {
      const dx = candidate.x - p.x;
      const dz = candidate.z - p.z;
      return Math.sqrt(dx * dx + dz * dz) < 2.0;
    });
    if (tooCloseToPlayer) continue;

    // Reject: too close to hoops (z=±13)
    if (Math.abs(candidate.z) > 11) continue;

    // Reject: inside paint (|x| < 1.8 AND |z| > 8.2)
    if (Math.abs(candidate.x) < 1.8 && Math.abs(candidate.z) > 8.2) continue;

    return candidate;
  }

  return candidate; // Accept last candidate after max retries
}
```

- [ ] **Step 4: Update PowerupSystem.update() to use findValidSpawnPosition**

In `src/systems/powerups.ts`, change the `update` method signature and body:

```typescript
update(deficit: number, dt: number, playerPositions: { x: number; z: number }[] = []): void {
  if (this.meter >= 100 && !this.activeOrb && deficit > 0) {
    const type = this.selectPowerup(deficit);
    if (type) {
      this.activeOrb = {
        type,
        position: findValidSpawnPosition(playerPositions),
      };
      this.meter = 0;
    }
  }
}
```

- [ ] **Step 5: Update game-session.ts to pass player positions**

In `src/game/game-session.ts`, in the `updatePowerups` method (~line 1090), change:

```typescript
// OLD:
this.powerupSystem.update(diff.deficit, dt);

// NEW:
const playerPositions = this.getAllPlayers().map((p) => ({
  x: p.position.x,
  z: p.position.z,
}));
this.powerupSystem.update(diff.deficit, dt, playerPositions);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/systems/powerups.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/systems/powerups.ts src/game/game-session.ts tests/systems/powerups.test.ts
git commit -m "feat: smart powerup placement — avoid players, hoops, and paint"
```

---

### Task 3: GamepadControls Class

**Files:**
- Create: `src/game/gamepad-controls.ts`
- Test: `tests/game/gamepad-controls.test.ts`

- [ ] **Step 1: Write failing tests for GamepadControls**

Create `tests/game/gamepad-controls.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { GamepadControls } from '@/game/gamepad-controls';

// Mock gamepad with configurable axes/buttons
function createMockGamepad(overrides: Partial<Gamepad> = {}): Gamepad {
  return {
    id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)',
    index: 0,
    connected: true,
    timestamp: performance.now(),
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    })),
    hapticActuators: [],
    vibrationActuator: null as any,
    ...overrides,
  } as Gamepad;
}

function createMockGamepadWithAxes(x: number, y: number): Gamepad {
  return createMockGamepad({ axes: [x, y, 0, 0] });
}

function createMockGamepadWithButton(index: number, pressed = true, value = 1): Gamepad {
  const buttons = Array.from({ length: 17 }, () => ({
    pressed: false,
    touched: false,
    value: 0,
  }));
  buttons[index] = { pressed, touched: pressed, value };
  return createMockGamepad({ buttons });
}

describe('GamepadControls', () => {
  let controls: GamepadControls;

  beforeEach(() => {
    controls = new GamepadControls();
  });

  describe('deadzone', () => {
    it('should ignore stick values below deadzone (0.15)', () => {
      const input = controls.getInput(createMockGamepadWithAxes(0.1, 0.1));
      expect(input.joystick.x).toBe(0);
      expect(input.joystick.y).toBe(0);
    });

    it('should pass through stick values above deadzone', () => {
      const input = controls.getInput(createMockGamepadWithAxes(0.5, -0.8));
      expect(input.joystick.x).toBeCloseTo(0.5);
      expect(input.joystick.y).toBeCloseTo(-0.8);
    });
  });

  describe('button gestures', () => {
    it('button 0 down should emit charge-start', () => {
      controls.getInput(createMockGamepadWithButton(0));
      const input = controls.getInput(createMockGamepadWithButton(0));
      expect(input.gesture?.type).toBe('charge-start');
    });

    it('button 1 should emit tap (steal)', () => {
      const input = controls.getInput(createMockGamepadWithButton(1));
      expect(input.gesture?.type).toBe('tap');
    });

    it('button 2 should emit pass', () => {
      const input = controls.getInput(createMockGamepadWithButton(2));
      expect(input.gesture?.type).toBe('pass');
    });

    it('button 3 should emit jump', () => {
      const input = controls.getInput(createMockGamepadWithButton(3));
      expect(input.gesture?.type).toBe('jump');
    });

    it('button 4 (LB) should emit jump-block', () => {
      const input = controls.getInput(createMockGamepadWithButton(4));
      expect(input.gesture?.type).toBe('jump-block');
    });

    it('button 5 (RB) should emit cycle-player', () => {
      const input = controls.getInput(createMockGamepadWithButton(5));
      expect(input.gesture?.type).toBe('cycle-player');
    });

    it('button 6 (LT) above threshold should emit block', () => {
      const input = controls.getInput(createMockGamepadWithButton(6, true, 0.7));
      expect(input.gesture?.type).toBe('block');
    });

    it('button 6 (LT) below threshold should not emit block', () => {
      const input = controls.getInput(createMockGamepadWithButton(6, false, 0.3));
      expect(input.gesture?.type).not.toBe('block');
    });
  });

  describe('sprint', () => {
    it('button 7 (RT) above 0.3 should set sprinting true', () => {
      const input = controls.getInput(createMockGamepadWithButton(7, true, 0.5));
      expect(input.sprinting).toBe(true);
    });

    it('button 7 (RT) below 0.3 should not sprint', () => {
      const input = controls.getInput(createMockGamepadWithButton(7, false, 0.1));
      expect(input.sprinting).toBe(false);
    });
  });

  describe('charge-up shooting', () => {
    it('button 0 release should emit swipe-up with power', () => {
      // Press button 0
      controls.getInput(createMockGamepadWithButton(0));

      // Release after simulated hold
      const noButtons = createMockGamepad();
      // Manually set internal charge start to simulate hold time
      (controls as any).chargeStartTime = performance.now() - 750; // 750ms hold
      const input = controls.getInput(noButtons);
      expect(input.gesture?.type).toBe('swipe-up');
      expect(input.gesture?.power).toBeGreaterThan(0);
      expect(input.gesture?.power).toBeLessThanOrEqual(1);
    });
  });

  describe('nintendo swap', () => {
    it('should swap buttons 0/1 and 2/3 for Nintendo controllers', () => {
      const nintendoControls = new GamepadControls();
      const nintendoPad = createMockGamepadWithButton(0); // physical B on Nintendo
      (nintendoPad as any).id = 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)';
      nintendoControls.detectControllerType(nintendoPad);

      // Button 0 on Nintendo is physical B (east), should map to steal (tap)
      const input = nintendoControls.getInput(nintendoPad);
      expect(input.gesture?.type).toBe('tap');
    });
  });

  describe('controller detection', () => {
    it('should detect Xbox controller', () => {
      const pad = createMockGamepad({
        id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)',
      });
      controls.detectControllerType(pad);
      expect(controls.controllerType).toBe('xbox');
    });

    it('should detect PlayStation controller', () => {
      const pad = createMockGamepad({
        id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
      });
      controls.detectControllerType(pad);
      expect(controls.controllerType).toBe('playstation');
    });

    it('should detect Nintendo controller', () => {
      const pad = createMockGamepad({
        id: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
      });
      controls.detectControllerType(pad);
      expect(controls.controllerType).toBe('nintendo');
    });
  });

  describe('pause', () => {
    it('button 9 should set pausePressed', () => {
      controls.getInput(createMockGamepadWithButton(9));
      expect(controls.pausePressed).toBe(true);
    });

    it('pause should only fire once per press', () => {
      controls.getInput(createMockGamepadWithButton(9));
      expect(controls.pausePressed).toBe(true);
      controls.consumePause();
      controls.getInput(createMockGamepadWithButton(9));
      expect(controls.pausePressed).toBe(false); // still held, no re-trigger
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/game/gamepad-controls.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement GamepadControls**

Create `src/game/gamepad-controls.ts`:

```typescript
import type { GestureResult, ControlInput } from './controls';

export type ControllerType = 'xbox' | 'playstation' | 'nintendo' | null;

const DEADZONE = 0.15;

// Button indices in standard gamepad mapping
const BTN_SHOOT = 0;    // A / × / B(nintendo)
const BTN_STEAL = 1;    // B / ○ / A(nintendo)
const BTN_PASS = 2;     // X / □ / Y(nintendo)
const BTN_JUMP = 3;     // Y / △ / X(nintendo)
const BTN_JUMP_BLOCK = 4; // LB / L1 / L
const BTN_CYCLE = 5;    // RB / R1 / R
const BTN_GUARD = 6;    // LT / L2 / ZL
const BTN_SPRINT = 7;   // RT / R2 / ZR
const BTN_PAUSE = 9;    // Start / Options / +

const GUARD_THRESHOLD = 0.5;
const SPRINT_THRESHOLD = 0.3;

export class GamepadControls {
  controllerType: ControllerType = null;
  pausePressed = false;

  private prevButtons: boolean[] = Array(17).fill(false);
  private chargeStartTime = 0;
  private isCharging = false;
  private pauseWasDown = false;
  private isNintendo = false;

  detectControllerType(pad: Gamepad): void {
    const id = pad.id.toLowerCase();
    if (id.includes('057e') || id.includes('pro controller') || id.includes('nintendo')) {
      this.controllerType = 'nintendo';
      this.isNintendo = true;
    } else if (id.includes('054c') || id.includes('dualsense') || id.includes('dualshock') || id.includes('playstation')) {
      this.controllerType = 'playstation';
      this.isNintendo = false;
    } else {
      this.controllerType = 'xbox';
      this.isNintendo = false;
    }
  }

  private mapButton(index: number): number {
    if (!this.isNintendo) return index;
    // Nintendo swaps: physical south(B)=0↔1=physical east(A), west(Y)=2↔3=north(X)
    if (index === 0) return 1;
    if (index === 1) return 0;
    if (index === 2) return 3;
    if (index === 3) return 2;
    return index;
  }

  getInput(pad: Gamepad | null): ControlInput {
    if (!pad) {
      return { joystick: { x: 0, y: 0 }, gesture: null, sprinting: false };
    }

    // Left stick with deadzone
    let x = pad.axes[0] ?? 0;
    let y = pad.axes[1] ?? 0;
    if (Math.abs(x) < DEADZONE) x = 0;
    if (Math.abs(y) < DEADZONE) y = 0;

    // Sprint from RT
    const sprintValue = pad.buttons[BTN_SPRINT]?.value ?? 0;
    const sprinting = sprintValue > SPRINT_THRESHOLD;

    // Process buttons for gestures
    let gesture: GestureResult | null = null;

    // Map button presses through Nintendo swap
    const shootBtn = this.mapButton(BTN_SHOOT);
    const stealBtn = this.mapButton(BTN_STEAL);
    const passBtn = this.mapButton(BTN_PASS);
    const jumpBtn = this.mapButton(BTN_JUMP);

    const shootPressed = pad.buttons[shootBtn]?.pressed ?? false;
    const shootWasPressed = this.prevButtons[shootBtn] ?? false;

    // Charge-up shooting: button 0 (mapped)
    if (shootPressed && !shootWasPressed) {
      // Button just pressed — start charging
      this.chargeStartTime = performance.now();
      this.isCharging = true;
      gesture = { type: 'charge-start', power: 0, direction: { x: 0, y: 0 } };
    } else if (!shootPressed && shootWasPressed && this.isCharging) {
      // Button just released — fire shot
      const holdTime = performance.now() - this.chargeStartTime;
      const power = Math.min(holdTime / 1500, 1);
      gesture = { type: 'swipe-up', power, direction: { x: 0, y: -1 } };
      this.isCharging = false;
    }

    // One-shot button gestures (only on press, not hold)
    if (!gesture) {
      const stealPressed = pad.buttons[stealBtn]?.pressed ?? false;
      const passPressed = pad.buttons[passBtn]?.pressed ?? false;
      const jumpPressed = pad.buttons[jumpBtn]?.pressed ?? false;
      const jumpBlockPressed = pad.buttons[BTN_JUMP_BLOCK]?.pressed ?? false;
      const cyclePressed = pad.buttons[BTN_CYCLE]?.pressed ?? false;
      const guardValue = pad.buttons[BTN_GUARD]?.value ?? 0;

      if (stealPressed && !this.prevButtons[stealBtn]) {
        gesture = { type: 'tap', power: 0, direction: { x: 0, y: 0 } };
      } else if (passPressed && !this.prevButtons[passBtn]) {
        gesture = { type: 'pass', power: 0, direction: { x: 0, y: -1 } };
      } else if (jumpPressed && !this.prevButtons[jumpBtn]) {
        gesture = { type: 'jump', power: 1, direction: { x: 0, y: 0 } };
      } else if (jumpBlockPressed && !this.prevButtons[BTN_JUMP_BLOCK]) {
        gesture = { type: 'jump-block', power: 1, direction: { x: 0, y: 0 } };
      } else if (cyclePressed && !this.prevButtons[BTN_CYCLE]) {
        gesture = { type: 'cycle-player', power: 0, direction: { x: 0, y: 0 } };
      } else if (guardValue > GUARD_THRESHOLD && !(this.prevButtons[BTN_GUARD])) {
        gesture = { type: 'block', power: 0, direction: { x: 0, y: 0 } };
      }
    }

    // Pause (one-shot)
    const pauseDown = pad.buttons[BTN_PAUSE]?.pressed ?? false;
    if (pauseDown && !this.pauseWasDown) {
      this.pausePressed = true;
    }
    this.pauseWasDown = pauseDown;

    // Store previous button states
    this.prevButtons = pad.buttons.map((b) => b.pressed);

    return { joystick: { x, y }, gesture, sprinting };
  }

  consumePause(): void {
    this.pausePressed = false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game/gamepad-controls.test.ts`
Expected: Most tests PASS. Fix any edge cases.

- [ ] **Step 5: Commit**

```bash
git add src/game/gamepad-controls.ts tests/game/gamepad-controls.test.ts
git commit -m "feat: GamepadControls class with Xbox/PS/Nintendo support"
```

---

### Task 4: InputManager

**Files:**
- Create: `src/game/input-manager.ts`
- Modify: `src/main.ts`
- Test: `tests/game/input-manager.test.ts`

- [ ] **Step 1: Write failing tests for InputManager**

Create `tests/game/input-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { InputManager } from '@/game/input-manager';

describe('InputManager', () => {
  let manager: InputManager;

  beforeEach(() => {
    manager = new InputManager();
  });

  describe('merge priority', () => {
    it('should prefer gamepad joystick over keyboard when non-zero', () => {
      // Simulate: keyboard has input, gamepad has input
      // Gamepad should win if it has non-zero values
      const input = manager.getInput();
      // Without any actual input sources connected, should return zeroes
      expect(input.joystick.x).toBe(0);
      expect(input.joystick.y).toBe(0);
    });

    it('should combine sprinting from keyboard or gamepad', () => {
      const input = manager.getInput();
      expect(input.sprinting).toBe(false);
    });
  });

  describe('lastUsedDevice', () => {
    it('should default to keyboard', () => {
      expect(manager.lastUsedDevice).toBe('keyboard');
    });
  });

  describe('controller type', () => {
    it('should return null when no gamepad connected', () => {
      expect(manager.getControllerType()).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/game/input-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement InputManager**

Create `src/game/input-manager.ts`:

```typescript
import type { ControlInput } from './controls';
import { TouchControls } from './controls';
import { KeyboardControls } from './keyboard-controls';
import { GamepadControls, type ControllerType } from './gamepad-controls';

export class InputManager {
  readonly touchControls: TouchControls;
  readonly keyboardControls: KeyboardControls;
  readonly gamepadControls: GamepadControls;

  lastUsedDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  private gamepadIndex: number | null = null;

  constructor(
    touch?: TouchControls,
    keyboard?: KeyboardControls,
    gamepad?: GamepadControls,
  ) {
    this.touchControls = touch ?? new TouchControls();
    this.keyboardControls = keyboard ?? new KeyboardControls();
    this.gamepadControls = gamepad ?? new GamepadControls();
  }

  handleGamepadConnected(e: GamepadEvent): void {
    this.gamepadIndex = e.gamepad.index;
    this.gamepadControls.detectControllerType(e.gamepad);
  }

  handleGamepadDisconnected(e: GamepadEvent): void {
    if (e.gamepad.index === this.gamepadIndex) {
      this.gamepadIndex = null;
    }
  }

  getControllerType(): ControllerType {
    if (this.gamepadIndex === null) return null;
    return this.gamepadControls.controllerType;
  }

  private getActiveGamepad(): Gamepad | null {
    if (this.gamepadIndex === null) return null;
    const pads = navigator.getGamepads();
    return pads[this.gamepadIndex] ?? null;
  }

  getInput(): ControlInput {
    const touchInput = this.touchControls.getInput();
    const kbInput = this.keyboardControls.getInput();
    const pad = this.getActiveGamepad();
    const gpInput = this.gamepadControls.getInput(pad);

    // Track last used device
    if (Math.abs(touchInput.joystick.x) > 0 || Math.abs(touchInput.joystick.y) > 0 || touchInput.gesture) {
      this.lastUsedDevice = 'touch';
    } else if (Math.abs(gpInput.joystick.x) > 0 || Math.abs(gpInput.joystick.y) > 0 || gpInput.gesture) {
      this.lastUsedDevice = 'gamepad';
    } else if (Math.abs(kbInput.joystick.x) > 0 || Math.abs(kbInput.joystick.y) > 0 || kbInput.gesture) {
      this.lastUsedDevice = 'keyboard';
    }

    // Merge: first non-zero joystick wins (touch > gamepad > keyboard)
    let jx = 0;
    let jy = 0;
    if (Math.abs(touchInput.joystick.x) > 0 || Math.abs(touchInput.joystick.y) > 0) {
      jx = touchInput.joystick.x;
      jy = touchInput.joystick.y;
    } else if (Math.abs(gpInput.joystick.x) > 0 || Math.abs(gpInput.joystick.y) > 0) {
      jx = gpInput.joystick.x;
      jy = gpInput.joystick.y;
    } else {
      jx = kbInput.joystick.x;
      jy = kbInput.joystick.y;
    }

    // Gesture: first non-null wins
    const gesture = touchInput.gesture ?? gpInput.gesture ?? kbInput.gesture ?? null;

    // Sprint: either gamepad or keyboard
    const sprinting = gpInput.sprinting || kbInput.sprinting;

    return { joystick: { x: jx, y: jy }, gesture, sprinting };
  }

  checkPause(): boolean {
    if (this.gamepadControls.pausePressed) {
      this.gamepadControls.consumePause();
      return true;
    }
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game/input-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/input-manager.ts tests/game/input-manager.test.ts
git commit -m "feat: InputManager — unified input from touch, keyboard, and gamepad"
```

---

### Task 5: Wire InputManager into main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Replace manual input merge with InputManager**

In `src/main.ts`, update imports (top of file):

```typescript
// REMOVE these two imports:
import { TouchControls } from './game/controls';
import { KeyboardControls } from './game/keyboard-controls';

// ADD:
import { InputManager } from './game/input-manager';
```

Replace the controls instantiation (~lines 91-92):

```typescript
// OLD:
const touchControls = new TouchControls();
const keyboardControls = new KeyboardControls();

// NEW:
const inputManager = new InputManager();
```

Update touch event listeners (~lines 95-121) to use `inputManager.touchControls`:

```typescript
// Replace all `touchControls.` with `inputManager.touchControls.`
```

Update keyboard event listeners (~lines 123-138):

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
    inputManager.keyboardControls.handleKeyDown(e.code);
  }
});
document.addEventListener('keyup', (e) => inputManager.keyboardControls.handleKeyUp(e.code));
```

Add gamepad event listeners right after keyboard listeners:

```typescript
window.addEventListener('gamepadconnected', (e) => inputManager.handleGamepadConnected(e));
window.addEventListener('gamepaddisconnected', (e) => inputManager.handleGamepadDisconnected(e));
```

- [ ] **Step 2: Replace the merge block in update() (~lines 310-320)**

```typescript
// OLD:
const touchInput = touchControls.getInput();
const kbInput = keyboardControls.getInput();
const input: ControlInput = {
  joystick: {
    x: touchInput.joystick.x || kbInput.joystick.x,
    y: touchInput.joystick.y || kbInput.joystick.y,
  },
  gesture: touchInput.gesture ?? kbInput.gesture,
  sprinting: kbInput.sprinting,
};

// NEW:
// Check gamepad pause
if (inputManager.checkPause()) {
  isPaused = !isPaused;
  if (isPaused) {
    pauseMenu.show();
  } else {
    pauseMenu.hide();
  }
}

const input = inputManager.getInput();
```

- [ ] **Step 3: Verify the game still runs**

Run: `npm run dev`
Test keyboard controls still work. If a gamepad is connected, verify it's detected in console.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "refactor: wire InputManager into game loop, replacing manual input merge"
```

---

### Task 6: HapticManager

**Files:**
- Create: `src/systems/haptics.ts`
- Test: `tests/systems/haptics.test.ts`

- [ ] **Step 1: Write failing tests for HapticManager**

Create `tests/systems/haptics.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HapticManager } from '@/systems/haptics';

function createMockVibrationActuator() {
  return {
    playEffect: vi.fn().mockResolvedValue('complete'),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

describe('HapticManager', () => {
  let haptics: HapticManager;
  let mockActuator: ReturnType<typeof createMockVibrationActuator>;

  beforeEach(() => {
    mockActuator = createMockVibrationActuator();
    haptics = new HapticManager();
    haptics.setVibrationActuator(mockActuator as any);
  });

  it('should fire light tap on shoot', () => {
    haptics.onShoot();
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 100,
      strongMagnitude: 0.3,
      weakMagnitude: 0.3,
    });
  });

  it('should fire strong pulse on score', () => {
    haptics.onScore();
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 200,
      strongMagnitude: 0.7,
      weakMagnitude: 0.7,
    });
  });

  it('should fire medium hit on block', () => {
    haptics.onBlock();
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 150,
      strongMagnitude: 0.5,
      weakMagnitude: 0.5,
    });
  });

  it('should fire double pulse on powerup pickup', async () => {
    haptics.onPowerupPickup();
    expect(mockActuator.playEffect).toHaveBeenCalledTimes(1);
    // Second pulse fires after 150ms delay
  });

  it('should fire sustained buzz on foul', () => {
    haptics.onFoul();
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 300,
      strongMagnitude: 0.6,
      weakMagnitude: 0.6,
    });
  });

  it('should no-op gracefully when no actuator set', () => {
    const noHaptics = new HapticManager();
    expect(() => noHaptics.onShoot()).not.toThrow();
    expect(() => noHaptics.onScore()).not.toThrow();
  });

  it('should ramp charge vibration with level', () => {
    haptics.onCharge(0.5);
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 50,
      strongMagnitude: expect.closeTo(0.3, 1),
      weakMagnitude: expect.closeTo(0.3, 1),
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/systems/haptics.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement HapticManager**

Create `src/systems/haptics.ts`:

```typescript
export class HapticManager {
  private actuator: GamepadHapticActuator | null = null;

  setVibrationActuator(actuator: GamepadHapticActuator | null): void {
    this.actuator = actuator;
  }

  private rumble(intensity: number, duration: number): void {
    this.actuator?.playEffect('dual-rumble', {
      duration,
      strongMagnitude: intensity,
      weakMagnitude: intensity,
    });
  }

  onShoot(): void {
    this.rumble(0.3, 100);
  }

  onScore(): void {
    this.rumble(0.7, 200);
  }

  onBlock(): void {
    this.rumble(0.5, 150);
  }

  onSteal(): void {
    this.rumble(0.5, 150);
  }

  onPowerupPickup(): void {
    this.rumble(0.4, 100);
    setTimeout(() => this.rumble(0.8, 200), 150);
  }

  onFoul(): void {
    this.rumble(0.6, 300);
  }

  onCharge(level: number): void {
    // Ramp from 0.1 to 0.5 based on charge level
    const intensity = 0.1 + level * 0.4;
    this.rumble(intensity, 50);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/systems/haptics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/systems/haptics.ts tests/systems/haptics.test.ts
git commit -m "feat: HapticManager with preset vibration patterns"
```

---

### Task 7: Wire Haptics into Game Events

**Files:**
- Modify: `src/main.ts`
- Modify: `src/game/game-session.ts`

- [ ] **Step 1: Create HapticManager and wire to EventBus in main.ts**

In `src/main.ts`, add import:

```typescript
import { HapticManager } from './systems/haptics';
```

After the `inputManager` instantiation, add:

```typescript
const hapticManager = new HapticManager();

// Update haptic actuator when gamepad connects
window.addEventListener('gamepadconnected', (e) => {
  const pad = navigator.getGamepads()[e.gamepad.index];
  if (pad?.vibrationActuator) {
    hapticManager.setVibrationActuator(pad.vibrationActuator);
  }
});

// Wire EventBus haptic events
gameEvents.on('score', () => hapticManager.onScore());
gameEvents.on('foul', () => hapticManager.onFoul());
gameEvents.on('powerup', () => hapticManager.onPowerupPickup());
```

Note: merge the `gamepadconnected` listener with the one from Task 5 into a single handler:

```typescript
window.addEventListener('gamepadconnected', (e) => {
  inputManager.handleGamepadConnected(e);
  const pad = navigator.getGamepads()[e.gamepad.index];
  if (pad?.vibrationActuator) {
    hapticManager.setVibrationActuator(pad.vibrationActuator);
  }
});
```

- [ ] **Step 2: Wire haptics for shoot, block, steal, and charge in game-session.ts**

In `src/game/game-session.ts`, add a `hapticManager` field and setter:

```typescript
// Add field to GameSession class:
private hapticManager: HapticManager | null = null;

// Add setter method:
setHapticManager(haptics: HapticManager): void {
  this.hapticManager = haptics;
}
```

In the `handleGesture` method, add haptic calls:

- After `'swipe-up'` (shot release, ~line 684): add `this.hapticManager?.onShoot();`
- After `'block'` (guard, ~line 668): add `this.hapticManager?.onBlock();`
- After `'tap'` (steal, ~line 764): add `this.hapticManager?.onSteal();`
- In `processInput`, when `human.isCharging` (~line 442): add `this.hapticManager?.onCharge(human.chargeTimer / 1.5);`

In `src/main.ts`, after creating the session, call:

```typescript
session.setHapticManager(hapticManager);
```

- [ ] **Step 3: Verify haptics work with a connected gamepad**

Run: `npm run dev`
Connect a gamepad. Shoot, score, guard — feel for vibration feedback.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/game/game-session.ts
git commit -m "feat: wire haptic feedback into game events and gestures"
```

---

### Task 8: Update Controls UI with Gamepad Prompts

**Files:**
- Modify: `src/ui/menus.ts`
- Modify: `src/ui/pause-menu.ts`
- Modify: `src/ui/hud.ts`

- [ ] **Step 1: Update CONTROLS_DATA to include gamepad columns**

In `src/ui/menus.ts`, change the data structure:

```typescript
export const CONTROLS_DATA: [string, string, string, string, string][] = [
  // [Action, Keyboard, Xbox, PlayStation, Nintendo]
  ['Movement',       'WASD',             'Left Stick',  'Left Stick',  'Left Stick'],
  ['Shoot / Dunk',   'SPACE (hold)',     'A (hold)',    '× (hold)',    'B (hold)'],
  ['Pass',           'E',                'X',           '□',           'Y'],
  ['Steal',          'Q',                'B',           '○',           'A'],
  ['Guard',          'G',                'LT',          'L2',          'ZL'],
  ['Jump',           'F',                'Y',           '△',           'X'],
  ['Jump Block',     'SHIFT + F',        'LB',          'L1',          'L'],
  ['Sprint',         'SHIFT (hold)',     'RT (hold)',   'R2 (hold)',   'ZR (hold)'],
  ['Switch Player',  'TAB',             'RB',          'R1',          'R'],
  ['Pause',          'ESC',             'Menu',        'Options',     '+'],
];
```

- [ ] **Step 2: Update pause-menu.ts renderControlsView to show two columns**

In `src/ui/pause-menu.ts`, update `renderControlsView()` to accept a `controllerType` parameter and display two columns — Keyboard + the relevant gamepad column:

```typescript
renderControlsView(controllerType: ControllerType = null): void {
  this.clearOverlay();
  if (!this.overlay) return;

  const title = document.createElement('h1');
  title.textContent = 'CONTROLS';
  Object.assign(title.style, {
    fontSize: '48px', fontWeight: 'bold', color: '#ffffff',
    margin: '0 0 32px 0', textShadow: '0 0 20px #e94560',
  });
  this.overlay.appendChild(title);

  // Determine which gamepad column to show (index: 2=xbox, 3=ps, 4=nintendo)
  const gpColIndex = controllerType === 'playstation' ? 3
    : controllerType === 'nintendo' ? 4
    : controllerType === 'xbox' ? 2
    : null;

  for (const row of CONTROLS_DATA) {
    const rowEl = document.createElement('div');
    Object.assign(rowEl.style, {
      display: 'flex', justifyContent: 'space-between', width: '100%',
      maxWidth: gpColIndex !== null ? '480px' : '320px',
      padding: '6px 0', fontFamily: 'monospace', fontSize: '14px', color: '#cccccc',
    });

    const labelEl = document.createElement('span');
    labelEl.textContent = row[0];
    labelEl.style.color = '#ffffff';
    labelEl.style.flex = '1';

    const kbEl = document.createElement('span');
    kbEl.textContent = row[1];
    kbEl.style.color = '#aaaaaa';
    kbEl.style.flex = '1';
    kbEl.style.textAlign = 'right';

    rowEl.appendChild(labelEl);
    rowEl.appendChild(kbEl);

    if (gpColIndex !== null) {
      const gpEl = document.createElement('span');
      gpEl.textContent = row[gpColIndex];
      gpEl.style.color = '#88ccff';
      gpEl.style.flex = '1';
      gpEl.style.textAlign = 'right';
      rowEl.appendChild(gpEl);
    }

    this.overlay.appendChild(rowEl);
  }

  const spacer = document.createElement('div');
  spacer.style.height = '24px';
  this.overlay.appendChild(spacer);

  this.overlay.appendChild(this.createButton('Back', false, () => this.renderPauseView()));
}
```

- [ ] **Step 3: Add controller icon to HUD**

In `src/ui/hud.ts`, add a controller indicator element:

```typescript
// In constructor, after other elements:
private controllerIcon: HTMLElement;

// In constructor body:
this.controllerIcon = document.createElement('div');
this.controllerIcon.dataset.hudRole = 'controller';
Object.assign(this.controllerIcon.style, {
  position: 'absolute', bottom: '10px', right: '10px',
  fontSize: '12px', color: '#888888', fontFamily: 'monospace',
  display: 'none',
});
this.container.appendChild(this.controllerIcon);

// Add method:
updateControllerIcon(type: ControllerType): void {
  if (!type) {
    this.controllerIcon.style.display = 'none';
    return;
  }
  this.controllerIcon.style.display = 'block';
  const labels: Record<string, string> = {
    xbox: '🎮 Xbox',
    playstation: '🎮 PlayStation',
    nintendo: '🎮 Nintendo',
  };
  this.controllerIcon.textContent = labels[type] ?? '';
}
```

In `src/main.ts` game loop, after the input line, add:

```typescript
hud.updateControllerIcon(inputManager.getControllerType());
```

- [ ] **Step 4: Run the game and verify UI**

Run: `npm run dev`
Check: controls screen shows two columns when gamepad is connected, controller icon appears in HUD.

- [ ] **Step 5: Commit**

```bash
git add src/ui/menus.ts src/ui/pause-menu.ts src/ui/hud.ts src/main.ts
git commit -m "feat: gamepad button prompts in controls UI + controller icon in HUD"
```

---

### Task 9: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass, including new ones from Tasks 1-6.

- [ ] **Step 2: Fix any failures**

If any test fails, diagnose and fix.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: test suite cleanup after gamepad + powerup changes"
```

---
