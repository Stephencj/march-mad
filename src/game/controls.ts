// Constants
export const JOYSTICK_RADIUS = 60;
export const SWIPE_THRESHOLD = 30;
export const TAP_THRESHOLD = 15;
export const TAP_DURATION = 200;
export const DOUBLE_TAP_WINDOW = 300;

// Types
export type GestureType = 'swipe-up' | 'pass' | 'tap' | 'swipe-down' | 'double-tap' | 'jump' | 'charge-start' | 'block' | 'jump-block' | 'cycle-player';

export interface TouchPoint {
  x: number;
  y: number;
  id: number;
  isLeftHalf: boolean;
  timestamp: number;
}

export interface TouchEndPoint extends TouchPoint {
  startX: number;
  startY: number;
  startTimestamp: number;
}

export interface GestureResult {
  type: GestureType;
  power: number;
  direction: { x: number; y: number };
}

export interface ControlInput {
  joystick: { x: number; y: number };
  gesture: GestureResult | null;
  sprinting?: boolean;
}

type GestureCallback = (gesture: GestureResult) => void;

export class TouchControls {
  private joystickOrigin: { x: number; y: number } | null = null;
  private joystickDelta: { x: number; y: number } = { x: 0, y: 0 };
  private gestureCallbacks: GestureCallback[] = [];
  private lastGesture: GestureResult | null = null;
  private lastTapTimestamp: number | null = null;

  onGesture(callback: GestureCallback): void {
    this.gestureCallbacks.push(callback);
  }

  handleTouchStart(touch: TouchPoint): void {
    if (touch.isLeftHalf) {
      // Left half: set joystick origin
      this.joystickOrigin = { x: touch.x, y: touch.y };
      this.joystickDelta = { x: 0, y: 0 };
    }
    // Right half touches are tracked; gesture detection happens on end
  }

  handleTouchMove(touch: TouchPoint): void {
    if (touch.isLeftHalf && this.joystickOrigin) {
      // Compute delta from origin, normalize to max magnitude 1
      const dx = touch.x - this.joystickOrigin.x;
      const dy = touch.y - this.joystickOrigin.y;
      const magnitude = Math.sqrt(dx * dx + dy * dy);

      if (magnitude <= JOYSTICK_RADIUS) {
        this.joystickDelta = { x: dx / JOYSTICK_RADIUS, y: dy / JOYSTICK_RADIUS };
      } else {
        // Clamp to unit circle
        this.joystickDelta = { x: dx / magnitude, y: dy / magnitude };
      }
    }
  }

  handleTouchEnd(touch: TouchEndPoint): void {
    if (touch.isLeftHalf) {
      // Reset joystick
      this.joystickOrigin = null;
      this.joystickDelta = { x: 0, y: 0 };
      return;
    }

    // Right half: detect gesture
    const dx = touch.x - touch.startX;
    const dy = touch.y - touch.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const duration = touch.timestamp - touch.startTimestamp;

    let gesture: GestureResult;

    if (distance < TAP_THRESHOLD && duration < TAP_DURATION) {
      // Tap or double-tap
      if (this.lastTapTimestamp !== null && (touch.startTimestamp - this.lastTapTimestamp) < DOUBLE_TAP_WINDOW) {
        gesture = {
          type: 'double-tap',
          power: 0,
          direction: { x: 0, y: 0 },
        };
        this.lastTapTimestamp = null;
      } else {
        gesture = {
          type: 'tap',
          power: 0,
          direction: { x: 0, y: 0 },
        };
        this.lastTapTimestamp = touch.timestamp;
      }
    } else if (distance >= SWIPE_THRESHOLD) {
      // Swipe gesture
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDy > absDx) {
        // Vertical swipe
        if (dy < 0) {
          gesture = {
            type: 'swipe-up',
            power: distance / JOYSTICK_RADIUS,
            direction: { x: 0, y: -1 },
          };
        } else {
          gesture = {
            type: 'swipe-down',
            power: distance / JOYSTICK_RADIUS,
            direction: { x: 0, y: 1 },
          };
        }
      } else {
        // Horizontal swipe -> pass
        const normX = dx / distance;
        const normY = dy / distance;
        gesture = {
          type: 'pass',
          power: distance / JOYSTICK_RADIUS,
          direction: { x: normX, y: normY },
        };
      }
    } else {
      // Distance between TAP_THRESHOLD and SWIPE_THRESHOLD, treat as tap
      gesture = {
        type: 'tap',
        power: 0,
        direction: { x: 0, y: 0 },
      };
      this.lastTapTimestamp = touch.timestamp;
    }

    this.lastGesture = gesture;
    this.emitGesture(gesture);
  }

  getInput(): ControlInput {
    const gesture = this.lastGesture;
    this.lastGesture = null; // consume gesture so it doesn't repeat
    return {
      joystick: { x: this.joystickDelta.x, y: this.joystickDelta.y },
      gesture,
    };
  }

  private emitGesture(gesture: GestureResult): void {
    for (const callback of this.gestureCallbacks) {
      callback(gesture);
    }
  }
}
