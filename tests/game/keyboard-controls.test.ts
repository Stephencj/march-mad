import { describe, it, expect, vi } from 'vitest';
import { KeyboardControls } from '@/game/keyboard-controls';
import type { GestureResult } from '@/game/controls';

describe('KeyboardControls', () => {
  it('maps WASD to movement vector', () => {
    const kb = new KeyboardControls();
    kb.handleKeyDown('KeyW');
    const input = kb.getInput();
    expect(input.joystick.y).toBeLessThan(0);
  });

  it('normalizes diagonal movement', () => {
    const kb = new KeyboardControls();
    kb.handleKeyDown('KeyW');
    kb.handleKeyDown('KeyD');
    const input = kb.getInput();
    const mag = Math.sqrt(input.joystick.x ** 2 + input.joystick.y ** 2);
    expect(mag).toBeCloseTo(1, 1);
  });

  it('maps Space to swipe-up gesture', () => {
    const kb = new KeyboardControls();
    let gesture: GestureResult | null = null;
    kb.onGesture((g) => { gesture = g; });
    kb.handleKeyDown('Space');
    kb.handleKeyUp('Space');
    expect(gesture?.type).toBe('swipe-up');
  });

  it('maps KeyE to pass gesture', () => {
    const kb = new KeyboardControls();
    let gesture: GestureResult | null = null;
    kb.onGesture((g) => { gesture = g; });
    kb.handleKeyDown('KeyE');
    expect(gesture?.type).toBe('pass');
  });

  it('maps KeyQ to tap gesture', () => {
    const kb = new KeyboardControls();
    let gesture: GestureResult | null = null;
    kb.onGesture((g) => { gesture = g; });
    kb.handleKeyDown('KeyQ');
    expect(gesture?.type).toBe('tap');
  });

  it('clears movement on key up', () => {
    const kb = new KeyboardControls();
    kb.handleKeyDown('KeyW');
    kb.handleKeyUp('KeyW');
    const input = kb.getInput();
    expect(input.joystick.y).toBe(0);
  });
});
