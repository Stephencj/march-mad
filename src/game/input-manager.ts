import type { ControlInput } from './controls';
import { TouchControls } from './controls';
import { KeyboardControls } from './keyboard-controls';
import { GamepadControls, type ControllerType } from './gamepad-controls';

export class InputManager {
  readonly touchControls: TouchControls;
  readonly keyboardControls: KeyboardControls;
  readonly gamepadControls: GamepadControls;

  lastUsedDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  gamepadIndex: number | null = null;
  /** Ordered list of gamepad indices (index 0 drives primary player, 1 drives P2, ..). */
  connectedGamepads: number[] = [];
  /** Per-extra-player GamepadControls (index 1 = P2's gamepad controls, etc). */
  private extraGamepadControls: GamepadControls[] = [];

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
    if (!this.connectedGamepads.includes(e.gamepad.index)) {
      this.connectedGamepads.push(e.gamepad.index);
    }
    // First gamepad connected drives the primary player (matches existing
    // single-player behaviour). Later gamepads get their own GamepadControls
    // instance so button-latch state is independent.
    if (this.gamepadIndex === null) {
      this.gamepadIndex = e.gamepad.index;
      this.gamepadControls.detectControllerType(e.gamepad);
    } else {
      // Ensure an extra-controls slot exists for this non-primary gamepad
      while (this.extraGamepadControls.length < this.connectedGamepads.length - 1) {
        this.extraGamepadControls.push(new GamepadControls());
      }
      // Detect its type (for future per-player button glyphs)
      const slot = this.connectedGamepads.indexOf(e.gamepad.index) - 1;
      if (slot >= 0 && this.extraGamepadControls[slot]) {
        this.extraGamepadControls[slot].detectControllerType(e.gamepad);
      }
    }
  }

  handleGamepadDisconnected(e: GamepadEvent): void {
    this.connectedGamepads = this.connectedGamepads.filter(i => i !== e.gamepad.index);
    if (e.gamepad.index === this.gamepadIndex) {
      // Promote the next connected gamepad to primary (or unset if none).
      this.gamepadIndex = this.connectedGamepads[0] ?? null;
    }
  }

  getControllerType(): ControllerType {
    if (this.gamepadIndex === null) return null;
    return this.gamepadControls.controllerType;
  }

  private getActiveGamepad(): Gamepad | null {
    if (this.gamepadIndex === null) return null;
    try {
      if (typeof navigator.getGamepads !== 'function') return null;
      const pads = navigator.getGamepads();
      return pads[this.gamepadIndex] ?? null;
    } catch {
      return null;
    }
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

  /** Count of connected gamepads, used for the "pick how many players" menu. */
  getConnectedCount(): number {
    return this.connectedGamepads.length;
  }

  /**
   * Per-player input for local multiplayer. `playerIndex` 0 is the primary
   * human (shares keyboard + touch + gamepad[0]). Indices 1..N use extra
   * gamepads exclusively — no keyboard sharing (we only allow one keyboard).
   */
  getInputForPlayer(playerIndex: number): ControlInput {
    if (playerIndex === 0) return this.getInput();
    const gpIndex = this.connectedGamepads[playerIndex];
    if (gpIndex === undefined || typeof navigator.getGamepads !== 'function') {
      return { joystick: { x: 0, y: 0 }, gesture: null, sprinting: false };
    }
    const pad = navigator.getGamepads()[gpIndex] ?? null;
    const controls = this.extraGamepadControls[playerIndex - 1];
    if (!pad || !controls) {
      return { joystick: { x: 0, y: 0 }, gesture: null, sprinting: false };
    }
    return controls.getInput(pad);
  }
}
