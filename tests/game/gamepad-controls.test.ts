import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GamepadControls } from '@/game/gamepad-controls';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeButton(pressed: boolean, value?: number): GamepadButton {
  return { pressed, touched: pressed, value: value ?? (pressed ? 1 : 0) };
}

function createMockGamepad(overrides: Partial<Gamepad> = {}): Gamepad {
  return {
    id: 'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)',
    index: 0,
    connected: true,
    timestamp: performance.now(),
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => makeButton(false)),
    hapticActuators: [],
    vibrationActuator: null as any,
    ...overrides,
  } as Gamepad;
}

/** Clone buttons array and set one button */
function withButton(pad: Gamepad, index: number, pressed: boolean, value?: number): Gamepad {
  const buttons = pad.buttons.map((b) => ({ ...b }));
  buttons[index] = makeButton(pressed, value);
  return { ...pad, buttons };
}

/** Clone axes array and set specific axes */
function withAxes(pad: Gamepad, x: number, y: number): Gamepad {
  const axes = [...pad.axes];
  axes[0] = x;
  axes[1] = y;
  return { ...pad, axes };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GamepadControls', () => {
  // -------------------------------------------------------------------------
  // Deadzone
  // -------------------------------------------------------------------------

  describe('deadzone', () => {
    it('returns 0 for axes below 0.15 threshold', () => {
      const gc = new GamepadControls();
      const pad = withAxes(createMockGamepad(), 0.1, -0.1);
      const input = gc.getInput(pad);
      expect(input.joystick.x).toBe(0);
      expect(input.joystick.y).toBe(0);
    });

    it('returns 0 for axes exactly at boundary (0.14)', () => {
      const gc = new GamepadControls();
      const pad = withAxes(createMockGamepad(), 0.14, 0.14);
      const input = gc.getInput(pad);
      expect(input.joystick.x).toBe(0);
      expect(input.joystick.y).toBe(0);
    });

    it('passes through axes above 0.15', () => {
      const gc = new GamepadControls();
      const pad = withAxes(createMockGamepad(), 0.5, -0.8);
      const input = gc.getInput(pad);
      expect(input.joystick.x).toBeCloseTo(0.5, 5);
      expect(input.joystick.y).toBeCloseTo(-0.8, 5);
    });

    it('returns 0 for null gamepad', () => {
      const gc = new GamepadControls();
      const input = gc.getInput(null);
      expect(input.joystick.x).toBe(0);
      expect(input.joystick.y).toBe(0);
      expect(input.gesture).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Button gestures (one-shot)
  // -------------------------------------------------------------------------

  describe('button gesture mapping', () => {
    it('button 1 (steal) emits tap on press', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 1, true);
      const input = gc.getInput(pad);
      expect(input.gesture?.type).toBe('tap');
    });

    it('button 2 (pass) emits pass on press', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 2, true);
      const input = gc.getInput(pad);
      expect(input.gesture?.type).toBe('pass');
    });

    it('button 3 (jump) emits jump on press', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 3, true);
      const input = gc.getInput(pad);
      expect(input.gesture?.type).toBe('jump');
    });

    it('button 4 (jump-block) emits jump-block on press', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 4, true);
      const input = gc.getInput(pad);
      expect(input.gesture?.type).toBe('jump-block');
    });

    it('button 5 (cycle-player) emits cycle-player on press', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 5, true);
      const input = gc.getInput(pad);
      expect(input.gesture?.type).toBe('cycle-player');
    });

    it('button 6 (guard) emits block when value exceeds 0.5', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 6, true, 0.8);
      const input = gc.getInput(pad);
      expect(input.gesture?.type).toBe('block');
    });

    it('button 6 (guard) does NOT emit block when value <= 0.5', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 6, true, 0.4);
      const input = gc.getInput(pad);
      expect(input.gesture).toBeNull();
    });

    it('gestures are one-shot — not repeated if button held', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 1, true);
      gc.getInput(pad); // first press — consumes gesture
      const input2 = gc.getInput(pad); // same state, held
      expect(input2.gesture).toBeNull();
    });

    it('gesture fires again after release + re-press', () => {
      const gc = new GamepadControls();
      const pressed = withButton(createMockGamepad(), 1, true);
      const released = withButton(createMockGamepad(), 1, false);
      gc.getInput(pressed);
      gc.getInput(released);
      const input = gc.getInput(pressed); // second press
      expect(input.gesture?.type).toBe('tap');
    });
  });

  // -------------------------------------------------------------------------
  // Sprint (button 7)
  // -------------------------------------------------------------------------

  describe('sprint', () => {
    it('sets sprinting true when button 7 value > 0.3', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 7, true, 0.8);
      const input = gc.getInput(pad);
      expect(input.sprinting).toBe(true);
    });

    it('sprinting is false when button 7 value <= 0.3', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 7, true, 0.2);
      const input = gc.getInput(pad);
      expect(input.sprinting).toBe(false);
    });

    it('sprinting is false when button 7 not pressed', () => {
      const gc = new GamepadControls();
      const input = gc.getInput(createMockGamepad());
      expect(input.sprinting).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Charge-up shooting (button 0)
  // -------------------------------------------------------------------------

  describe('charge-up shooting', () => {
    it('button 0 press emits charge-start', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 0, true);
      const input = gc.getInput(pad);
      expect(input.gesture?.type).toBe('charge-start');
    });

    it('button 0 release emits swipe-up with computed power', () => {
      const gc = new GamepadControls();
      vi.useFakeTimers();

      const pressed = withButton(createMockGamepad(), 0, true);
      const released = withButton(createMockGamepad(), 0, false);

      gc.getInput(pressed); // start charge
      vi.advanceTimersByTime(750); // half of 1500ms → power ~0.5
      const input = gc.getInput(released);

      expect(input.gesture?.type).toBe('swipe-up');
      expect(input.gesture?.power).toBeCloseTo(0.5, 1);

      vi.useRealTimers();
    });

    it('power is clamped to 1 for long holds', () => {
      const gc = new GamepadControls();
      vi.useFakeTimers();

      const pressed = withButton(createMockGamepad(), 0, true);
      const released = withButton(createMockGamepad(), 0, false);

      gc.getInput(pressed);
      vi.advanceTimersByTime(3000); // 2x the max
      const input = gc.getInput(released);

      expect(input.gesture?.power).toBe(1);

      vi.useRealTimers();
    });

    it('charge-start is one-shot (not repeated while held)', () => {
      const gc = new GamepadControls();
      const pressed = withButton(createMockGamepad(), 0, true);
      gc.getInput(pressed); // first press — charge-start emitted
      const input2 = gc.getInput(pressed); // still held
      expect(input2.gesture).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Nintendo button swap
  // -------------------------------------------------------------------------

  describe('Nintendo button swap', () => {
    const nintendoPad = createMockGamepad({
      id: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
    });

    it('detects nintendo controller from id', () => {
      const gc = new GamepadControls();
      gc.detectControllerType(nintendoPad);
      expect(gc.controllerType).toBe('nintendo');
    });

    it('button 0 on Nintendo maps to steal (tap) not shoot', () => {
      const gc = new GamepadControls();
      // Prime controller type
      gc.detectControllerType(nintendoPad);
      const pad = withButton({ ...nintendoPad }, 0, true);
      const input = gc.getInput(pad);
      // After swap, physical button 0 becomes logical button 1 → steal/tap
      expect(input.gesture?.type).toBe('tap');
    });

    it('button 1 on Nintendo maps to shoot (charge-start) not steal', () => {
      const gc = new GamepadControls();
      gc.detectControllerType(nintendoPad);
      const pad = withButton({ ...nintendoPad }, 1, true);
      const input = gc.getInput(pad);
      // After swap, physical button 1 becomes logical button 0 → shoot
      expect(input.gesture?.type).toBe('charge-start');
    });

    it('button 2 on Nintendo maps to jump not pass', () => {
      const gc = new GamepadControls();
      gc.detectControllerType(nintendoPad);
      const pad = withButton({ ...nintendoPad }, 2, true);
      const input = gc.getInput(pad);
      // After swap, physical button 2 becomes logical button 3 → jump
      expect(input.gesture?.type).toBe('jump');
    });

    it('button 3 on Nintendo maps to pass not jump', () => {
      const gc = new GamepadControls();
      gc.detectControllerType(nintendoPad);
      const pad = withButton({ ...nintendoPad }, 3, true);
      const input = gc.getInput(pad);
      // After swap, physical button 3 becomes logical button 2 → pass
      expect(input.gesture?.type).toBe('pass');
    });
  });

  // -------------------------------------------------------------------------
  // Controller type detection
  // -------------------------------------------------------------------------

  describe('controller type detection', () => {
    it('detects xbox by default', () => {
      const gc = new GamepadControls();
      gc.detectControllerType(createMockGamepad());
      expect(gc.controllerType).toBe('xbox');
    });

    it('detects playstation by vendor id 054c', () => {
      const gc = new GamepadControls();
      const pad = createMockGamepad({ id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' });
      gc.detectControllerType(pad);
      expect(gc.controllerType).toBe('playstation');
    });

    it('detects playstation by keyword "dualsense"', () => {
      const gc = new GamepadControls();
      const pad = createMockGamepad({ id: 'DualSense Controller' });
      gc.detectControllerType(pad);
      expect(gc.controllerType).toBe('playstation');
    });

    it('detects playstation by keyword "dualshock"', () => {
      const gc = new GamepadControls();
      const pad = createMockGamepad({ id: 'DualShock 4 Controller' });
      gc.detectControllerType(pad);
      expect(gc.controllerType).toBe('playstation');
    });

    it('detects playstation by keyword "playstation"', () => {
      const gc = new GamepadControls();
      const pad = createMockGamepad({ id: 'PlayStation Controller' });
      gc.detectControllerType(pad);
      expect(gc.controllerType).toBe('playstation');
    });

    it('detects nintendo by vendor id 057e', () => {
      const gc = new GamepadControls();
      const pad = createMockGamepad({ id: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)' });
      gc.detectControllerType(pad);
      expect(gc.controllerType).toBe('nintendo');
    });

    it('detects nintendo by keyword "pro controller"', () => {
      const gc = new GamepadControls();
      const pad = createMockGamepad({ id: 'Pro Controller' });
      gc.detectControllerType(pad);
      expect(gc.controllerType).toBe('nintendo');
    });

    it('detects nintendo by keyword "nintendo"', () => {
      const gc = new GamepadControls();
      const pad = createMockGamepad({ id: 'Nintendo Switch Controller' });
      gc.detectControllerType(pad);
      expect(gc.controllerType).toBe('nintendo');
    });

    it('initialises controllerType as null', () => {
      const gc = new GamepadControls();
      expect(gc.controllerType).toBeNull();
    });

    it('detectControllerType is called implicitly on first getInput', () => {
      const gc = new GamepadControls();
      const pad = createMockGamepad({ id: 'PlayStation Controller' });
      gc.getInput(pad);
      expect(gc.controllerType).toBe('playstation');
    });
  });

  // -------------------------------------------------------------------------
  // Pause (button 9)
  // -------------------------------------------------------------------------

  describe('pause handling', () => {
    it('button 9 sets pausePressed on press transition', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 9, true);
      gc.getInput(pad);
      expect(gc.pausePressed).toBe(true);
    });

    it('pausePressed is false before any input', () => {
      const gc = new GamepadControls();
      expect(gc.pausePressed).toBe(false);
    });

    it('consumePause resets pausePressed to false', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 9, true);
      gc.getInput(pad);
      expect(gc.pausePressed).toBe(true);
      gc.consumePause();
      expect(gc.pausePressed).toBe(false);
    });

    it('pause is one-shot — not repeated while button held', () => {
      const gc = new GamepadControls();
      const pad = withButton(createMockGamepad(), 9, true);
      gc.getInput(pad); // first press
      gc.consumePause();
      gc.getInput(pad); // still held
      expect(gc.pausePressed).toBe(false);
    });

    it('pause fires again after release + re-press', () => {
      const gc = new GamepadControls();
      const pressed = withButton(createMockGamepad(), 9, true);
      const released = withButton(createMockGamepad(), 9, false);
      gc.getInput(pressed);
      gc.consumePause();
      gc.getInput(released);
      gc.getInput(pressed); // second press
      expect(gc.pausePressed).toBe(true);
    });
  });
});
