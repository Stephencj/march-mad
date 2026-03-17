import { describe, it, expect } from 'vitest';
import { createFullCourt, FULL_COURT_DIMENSIONS } from '@/game/full-court';
import * as THREE from 'three';

describe('Full Court', () => {
  it('exports correct full-court dimensions', () => {
    expect(FULL_COURT_DIMENSIONS.width).toBe(15);
    expect(FULL_COURT_DIMENSIONS.length).toBe(28);
    expect(FULL_COURT_DIMENSIONS.hoopHome.z).toBeLessThan(0);
    expect(FULL_COURT_DIMENSIONS.hoopAway.z).toBeGreaterThan(0);
  });

  it('creates a group with floor, markings, and two hoops', () => {
    const court = createFullCourt(0xe94560, 0x3498db);
    expect(court).toBeInstanceOf(THREE.Group);
    const names: string[] = [];
    court.traverse(obj => { if (obj.name) names.push(obj.name); });
    expect(names).toContain('floor');
    expect(names).toContain('center-line');
    expect(names).toContain('center-circle');
    expect(names).toContain('hoop-home');
    expect(names).toContain('hoop-away');
    expect(names).toContain('three-point-arc-home');
    expect(names).toContain('three-point-arc-away');
    expect(names).toContain('paint-home');
    expect(names).toContain('paint-away');
  });

  it('has floor covering the full court area', () => {
    const court = createFullCourt(0xff0000, 0x0000ff);
    const floor = court.getObjectByName('floor')! as THREE.Mesh;
    const geo = floor.geometry as THREE.PlaneGeometry;
    expect(geo.parameters.width).toBe(15);
    expect(geo.parameters.height).toBe(28);
  });
});
