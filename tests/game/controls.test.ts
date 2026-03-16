import { describe, it, expect, vi } from 'vitest';
import { TouchControls, type GestureResult } from '@/game/controls';

describe('TouchControls', () => {
  it('detects joystick direction from touch position', () => {
    const controls = new TouchControls();
    controls.handleTouchStart({ x: 50, y: 300, id: 0, isLeftHalf: true, timestamp: 0 });
    controls.handleTouchMove({ x: 80, y: 300, id: 0, isLeftHalf: true, timestamp: 16 });
    const input = controls.getInput();
    expect(input.joystick.x).toBeGreaterThan(0);
    expect(input.joystick.y).toBeCloseTo(0);
  });

  it('detects swipe up as swipe-up gesture', () => {
    const controls = new TouchControls();
    let gesture: GestureResult | null = null;
    controls.onGesture((g) => { gesture = g; });
    controls.handleTouchStart({ x: 400, y: 500, id: 1, isLeftHalf: false, timestamp: 0 });
    controls.handleTouchEnd({ x: 400, y: 300, id: 1, isLeftHalf: false, timestamp: 150, startX: 400, startY: 500, startTimestamp: 0 });
    expect(gesture).not.toBeNull();
    expect(gesture!.type).toBe('swipe-up');
    expect(gesture!.power).toBeGreaterThan(0);
  });

  it('detects swipe toward direction as pass gesture', () => {
    const controls = new TouchControls();
    let gesture: GestureResult | null = null;
    controls.onGesture((g) => { gesture = g; });
    controls.handleTouchStart({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 0 });
    controls.handleTouchEnd({ x: 550, y: 400, id: 1, isLeftHalf: false, timestamp: 150, startX: 400, startY: 400, startTimestamp: 0 });
    expect(gesture).not.toBeNull();
    expect(gesture!.type).toBe('pass');
  });

  it('detects tap as tap gesture', () => {
    const controls = new TouchControls();
    let gesture: GestureResult | null = null;
    controls.onGesture((g) => { gesture = g; });
    controls.handleTouchStart({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 0 });
    controls.handleTouchEnd({ x: 402, y: 401, id: 1, isLeftHalf: false, timestamp: 80, startX: 400, startY: 400, startTimestamp: 0 });
    expect(gesture).not.toBeNull();
    expect(gesture!.type).toBe('tap');
  });

  it('detects double-tap', () => {
    const controls = new TouchControls();
    let gesture: GestureResult | null = null;
    controls.onGesture((g) => { gesture = g; });
    controls.handleTouchStart({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 0 });
    controls.handleTouchEnd({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 50, startX: 400, startY: 400, startTimestamp: 0 });
    controls.handleTouchStart({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 200 });
    controls.handleTouchEnd({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 250, startX: 400, startY: 400, startTimestamp: 200 });
    expect(gesture).not.toBeNull();
    expect(gesture!.type).toBe('double-tap');
  });

  it('normalizes joystick output to max magnitude 1', () => {
    const controls = new TouchControls();
    controls.handleTouchStart({ x: 50, y: 300, id: 0, isLeftHalf: true, timestamp: 0 });
    controls.handleTouchMove({ x: 200, y: 100, id: 0, isLeftHalf: true, timestamp: 16 });
    const input = controls.getInput();
    const magnitude = Math.sqrt(input.joystick.x ** 2 + input.joystick.y ** 2);
    expect(magnitude).toBeLessThanOrEqual(1.01);
  });
});
