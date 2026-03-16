import { describe, it, expect } from 'vitest';
import { createCourt, COURT_DIMENSIONS } from '@/game/court';
import * as THREE from 'three';

describe('Court', () => {
  it('exports correct half-court dimensions', () => {
    expect(COURT_DIMENSIONS.width).toBe(15);
    expect(COURT_DIMENSIONS.length).toBe(14);
    expect(COURT_DIMENSIONS.threePointRadius).toBeGreaterThan(0);
    expect(COURT_DIMENSIONS.hoopPosition).toBeDefined();
  });

  it('creates a group with floor, lines, hoop, and backboard', () => {
    const court = createCourt();
    expect(court).toBeInstanceOf(THREE.Group);
    const names = court.children.map((c) => c.name);
    expect(names).toContain('floor');
    expect(names).toContain('three-point-arc');
    expect(names).toContain('hoop');
    expect(names).toContain('backboard');
  });

  it('positions hoop at correct height', () => {
    const court = createCourt();
    const hoop = court.getObjectByName('hoop')!;
    expect(hoop.position.y).toBeCloseTo(3.05, 1);
  });
});
