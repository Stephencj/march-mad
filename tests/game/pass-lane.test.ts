import { describe, it, expect } from 'vitest';
import { isInPassLane } from '@/game/pass-targeting';

describe('isInPassLane', () => {
  it('should detect defender directly in pass path', () => {
    expect(isInPassLane({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 0 }, 1.0)).toBe(true);
  });

  it('should detect defender near pass path', () => {
    expect(isInPassLane({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 0.8 }, 1.0)).toBe(true);
  });

  it('should not detect defender far from pass path', () => {
    expect(isInPassLane({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 3 }, 1.0)).toBe(false);
  });

  it('should not detect defender behind the ball', () => {
    expect(isInPassLane({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: -3, z: 0 }, 1.0)).toBe(false);
  });

  it('should not detect defender past the target', () => {
    expect(isInPassLane({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 15, z: 0 }, 1.0)).toBe(false);
  });
});
