import type { GestureResult, ControlInput } from './controls';

export type ControllerType = 'xbox' | 'playstation' | 'nintendo' | null;

const DEADZONE = 0.15;
const CHARGE_MAX_MS = 1500;

export class GamepadControls {
  controllerType: ControllerType = null;
  pausePressed = false;

  private prevButtons: boolean[] = [];
  private isCharging = false;
  private chargeStartTime = 0;
  private pendingGesture: GestureResult | null = null;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  detectControllerType(pad: Gamepad): void {
    const id = pad.id.toLowerCase();
    if (id.includes('057e') || id.includes('pro controller') || id.includes('nintendo')) {
      this.controllerType = 'nintendo';
    } else if (
      id.includes('054c') ||
      id.includes('dualsense') ||
      id.includes('dualshock') ||
      id.includes('playstation')
    ) {
      this.controllerType = 'playstation';
    } else {
      this.controllerType = 'xbox';
    }
  }

  getInput(pad: Gamepad | null): ControlInput {
    if (pad === null) {
      return { joystick: { x: 0, y: 0 }, gesture: null, sprinting: false };
    }

    // Detect controller type on first call
    if (this.controllerType === null) {
      this.detectControllerType(pad);
    }

    // ---- Left stick with deadzone ----
    const rawX = pad.axes[0] ?? 0;
    const rawY = pad.axes[1] ?? 0;
    const x = Math.abs(rawX) < DEADZONE ? 0 : rawX;
    const y = Math.abs(rawY) < DEADZONE ? 0 : rawY;

    // ---- Resolve button indices (Nintendo swap) ----
    const isNintendo = this.controllerType === 'nintendo';
    const logicalButtons = this.resolveButtonStates(pad.buttons, isNintendo);

    // ---- Sprint (button 7 — analog trigger, no one-shot) ----
    const sprintValue = pad.buttons[7]?.value ?? 0;
    const sprinting = sprintValue > 0.3;

    // ---- Process one-shot buttons ----
    this.processButtons(logicalButtons, pad.buttons);

    // ---- Consume pending gesture ----
    const gesture = this.pendingGesture;
    this.pendingGesture = null;

    return { joystick: { x, y }, gesture, sprinting };
  }

  consumePause(): void {
    this.pausePressed = false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns a boolean[] of logical button pressed states after applying the
   * Nintendo swap (0↔1, 2↔3).
   */
  private resolveButtonStates(buttons: readonly GamepadButton[], isNintendo: boolean): boolean[] {
    const states = buttons.map((b) => b.pressed);
    if (isNintendo) {
      // Swap 0 ↔ 1
      [states[0], states[1]] = [states[1], states[0]];
      // Swap 2 ↔ 3
      [states[2], states[3]] = [states[3], states[2]];
    }
    return states;
  }

  /**
   * Processes all logical button transitions and sets pendingGesture /
   * pausePressed / charge state accordingly.
   */
  private processButtons(logical: boolean[], raw: readonly GamepadButton[]): void {
    const now = performance.now();

    // Ensure prevButtons is large enough
    while (this.prevButtons.length < logical.length) {
      this.prevButtons.push(false);
    }

    const justPressed = (i: number) => logical[i] && !this.prevButtons[i];
    const justReleased = (i: number) => !logical[i] && this.prevButtons[i];

    // Button 0 — Shoot (charge-up)
    if (justPressed(0)) {
      this.chargeStartTime = now;
      this.isCharging = true;
      this.pendingGesture = { type: 'charge-start', power: 0, direction: { x: 0, y: 0 } };
    } else if (justReleased(0) && this.isCharging) {
      const power = Math.min((now - this.chargeStartTime) / CHARGE_MAX_MS, 1);
      this.isCharging = false;
      this.pendingGesture = { type: 'swipe-up', power, direction: { x: 0, y: -1 } };
    }

    // Button 1 — Steal
    if (justPressed(1)) {
      this.pendingGesture = { type: 'tap', power: 0, direction: { x: 0, y: 0 } };
    }

    // Button 2 — Pass
    if (justPressed(2)) {
      this.pendingGesture = { type: 'pass', power: 0, direction: { x: 0, y: -1 } };
    }

    // Button 3 — Jump
    if (justPressed(3)) {
      this.pendingGesture = { type: 'jump', power: 1, direction: { x: 0, y: 0 } };
    }

    // Button 4 — Jump-Block
    if (justPressed(4)) {
      this.pendingGesture = { type: 'jump-block', power: 1, direction: { x: 0, y: 0 } };
    }

    // Button 5 — Cycle Player
    if (justPressed(5)) {
      this.pendingGesture = { type: 'cycle-player', power: 0, direction: { x: 0, y: 0 } };
    }

    // Button 6 — Guard (analog, threshold > 0.5)
    const guardValue = raw[6]?.value ?? 0;
    const guardLogicalPressed = guardValue > 0.5;
    const guardWasPressed = this.prevButtons[6]; // use raw prev for analog button
    if (guardLogicalPressed && !guardWasPressed) {
      this.pendingGesture = { type: 'block', power: 0, direction: { x: 0, y: 0 } };
    }

    // Button 9 — Pause (one-shot)
    if (justPressed(9)) {
      this.pausePressed = true;
    }

    // Save current logical states as previous for next frame
    this.prevButtons = [...logical];
    // Override index 6 prev state with analog threshold result so guard
    // one-shot works correctly on subsequent frames
    this.prevButtons[6] = guardLogicalPressed;
  }
}
