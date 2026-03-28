import { describe, it, expect } from 'vitest';
import { findBestPassTarget } from '@/game/pass-targeting';

describe('findBestPassTarget', () => {
  it('should prefer teammate in facing direction', () => {
    const passer = { x: 0, z: 0, facingAngle: 0 };
    const teammates = [
      { id: 'behind', x: 0, z: -5 },
      { id: 'front', x: 0, z: 5 },
    ];
    const result = findBestPassTarget(passer, teammates);
    expect(result?.id).toBe('front');
  });

  it('should prefer closer teammate when direction is similar', () => {
    const passer = { x: 0, z: 0, facingAngle: 0 };
    const teammates = [
      { id: 'close', x: 1, z: 3 },
      { id: 'far', x: 1, z: 15 },
    ];
    const result = findBestPassTarget(passer, teammates);
    expect(result?.id).toBe('close');
  });

  it('should still return a teammate even if all are behind', () => {
    const passer = { x: 0, z: 0, facingAngle: 0 };
    const teammates = [
      { id: 'behind1', x: -2, z: -3 },
      { id: 'behind2', x: 2, z: -5 },
    ];
    const result = findBestPassTarget(passer, teammates);
    expect(result).not.toBeNull();
  });

  it('should return null with no teammates', () => {
    const passer = { x: 0, z: 0, facingAngle: 0 };
    const result = findBestPassTarget(passer, []);
    expect(result).toBeNull();
  });

  it('should handle diagonal facing correctly', () => {
    const passer = { x: 0, z: 0, facingAngle: Math.PI / 4 };
    const teammates = [
      { id: 'diagonal', x: 5, z: 5 },
      { id: 'sideways', x: -5, z: 5 },
    ];
    const result = findBestPassTarget(passer, teammates);
    expect(result?.id).toBe('diagonal');
  });
});
