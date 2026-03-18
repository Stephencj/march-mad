import { describe, it, expect } from 'vitest';
import { PowerupVisuals } from '@/game/powerup-visuals';
import * as THREE from 'three';

describe('PowerupVisuals', () => {
  it('creates an orb mesh at a position', () => {
    const pv = new PowerupVisuals();
    const orb = pv.spawnOrb('speed-burst', { x: 3, z: -2 });
    expect(orb).toBeInstanceOf(THREE.Group);
  });

  it('removes orb on pickup', () => {
    const pv = new PowerupVisuals();
    pv.spawnOrb('speed-burst', { x: 3, z: -2 });
    expect(pv.hasActiveOrb()).toBe(true);
    pv.removeOrb();
    expect(pv.hasActiveOrb()).toBe(false);
  });

  it('detects player within pickup range', () => {
    const pv = new PowerupVisuals();
    pv.spawnOrb('hot-hand', { x: 0, z: 0 });
    expect(pv.checkPickup(new THREE.Vector3(0.3, 0, 0.3))).toBe(true);
    expect(pv.checkPickup(new THREE.Vector3(5, 0, 5))).toBe(false);
  });

  it('animates orb bob and rotate', () => {
    const pv = new PowerupVisuals();
    pv.spawnOrb('on-fire', { x: 0, z: 0 });
    const mesh = pv.getOrbMesh()!;
    const startY = mesh.position.y;
    pv.update(0.5);
    expect(mesh.position.y).not.toBeCloseTo(startY, 2);
  });
});
