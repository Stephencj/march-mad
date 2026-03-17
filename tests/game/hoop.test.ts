import { describe, it, expect } from 'vitest';
import { createHoop } from '@/game/hoop';
import * as THREE from 'three';

describe('Cartoon Hoop', () => {
  it('creates a group with pole, backboard, rim, net, and frame', () => {
    const hoop = createHoop(new THREE.Vector3(0, 3.05, -13), 0xe94560);
    expect(hoop).toBeInstanceOf(THREE.Group);
    const names = hoop.children.map(c => c.name).filter(n => n);
    expect(names).toContain('pole');
    expect(names).toContain('backboard');
    expect(names).toContain('rim');
    expect(names).toContain('net');
  });

  it('positions group at correct height (rim at local origin)', () => {
    const hoop = createHoop(new THREE.Vector3(0, 3.05, -13), 0xff0000);
    // Group position is the hoop position, rim is at local (0,0,0)
    expect(hoop.position.y).toBeCloseTo(3.05, 1);
    const rim = hoop.getObjectByName('rim')!;
    expect(rim.position.y).toBeCloseTo(0, 1);
  });

  it('has oversized rim radius', () => {
    const hoop = createHoop(new THREE.Vector3(0, 3.05, -13), 0xff0000);
    const rim = hoop.getObjectByName('rim')!;
    const geo = (rim as THREE.Mesh).geometry as THREE.TorusGeometry;
    expect(geo.parameters.radius).toBeCloseTo(0.35, 1);
  });

  it('backboard is 1.5x normal size', () => {
    const hoop = createHoop(new THREE.Vector3(0, 3.05, -13), 0xff0000);
    const bb = hoop.getObjectByName('backboard')!;
    const geo = (bb as THREE.Mesh).geometry as THREE.BoxGeometry;
    expect(geo.parameters.width).toBeCloseTo(2.7, 1);
  });
});
