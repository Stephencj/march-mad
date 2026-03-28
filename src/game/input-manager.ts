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
}
