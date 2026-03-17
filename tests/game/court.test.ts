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
    expect(court.getObjectByName('floor')).toBeTruthy();
    expect(court.getObjectByName('three-point-arc')).toBeTruthy();
    expect(court.getObjectByName('rim')).toBeTruthy();
    expect(court.getObjectByName('backboard')).toBeTruthy();
  });

  it('positions hoop at correct height', () => {
    const court = createCourt();
    // Hoop group is positioned at rim height, rim is at local (0,0,0)
    const hoopGroup = court.getObjectByName('hoop-group')!;
    expect(hoopGroup.position.y).toBeCloseTo(3.05, 1);
  });
});
