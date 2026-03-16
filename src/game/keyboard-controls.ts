import type { GestureResult, ControlInput } from './controls';

export class KeyboardControls {
  private keys = new Set<string>();
  private gestureCallbacks: Array<(g: GestureResult) => void> = [];
  private spaceDownTime = 0;
  private lastGesture: GestureResult | null = null;

  onGesture(callback: (g: GestureResult) => void): void {
    this.gestureCallbacks.push(callback);
  }

  handleKeyDown(code: string): void {
    this.keys.add(code);
    if (code === 'Space') {
      this.spaceDownTime = performance.now();
    } else if (code === 'KeyE') {
      this.emitGesture({ type: 'pass', power: 0, direction: { x: 0, y: -1 } });
    } else if (code === 'KeyQ') {
      this.emitGesture({ type: 'tap', power: 0, direction: { x: 0, y: 0 } });
    }
  }

  handleKeyUp(code: string): void {
    this.keys.delete(code);
    if (code === 'Space') {
      const holdTime = performance.now() - this.spaceDownTime;
      const power = Math.min(holdTime / 500, 1);
      this.emitGesture({ type: 'swipe-up', power, direction: { x: 0, y: -1 } });
    }
  }

  private emitGesture(gesture: GestureResult): void {
    this.lastGesture = gesture;
    this.gestureCallbacks.forEach((cb) => cb(gesture));
  }

  getInput(): ControlInput {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('KeyD')) x += 1;
    if (this.keys.has('KeyW')) y -= 1;
    if (this.keys.has('KeyS')) y += 1;
    const mag = Math.sqrt(x * x + y * y);
    if (mag > 1) { x /= mag; y /= mag; }
    const gesture = this.lastGesture;
    this.lastGesture = null; // consume gesture so it doesn't repeat
    return { joystick: { x, y }, gesture };
  }
}
