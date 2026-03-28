import { describe, it, expect } from 'vitest';
import { clampShotTarget } from '@/game/shot-range';
import * as THREE from 'three';

describe('clampShotTarget', () => {
  it('should not clamp shots within 12 units', () => {
    const shooter = new THREE.Vector3(0, 1, 0);
    const hoop = new THREE.Vector3(0, 3.05, 10);
    const result = clampShotTarget(shooter, hoop, 12);
    expect(result.clamped).toBe(false);
    expect(result.target.x).toBeCloseTo(hoop.x);
    expect(result.target.z).toBeCloseTo(hoop.z);
  });

  it('should clamp shots beyond 12 units', () => {
    const shooter = new THREE.Vector3(0, 1, -10);
    const hoop = new THREE.Vector3(0, 3.05, 13);
    const result = clampShotTarget(shooter, hoop, 12);
    expect(result.clamped).toBe(true);
    const dist = shooter.distanceTo(result.target);
    expect(dist).toBeCloseTo(12, 0);
  });

  it('should preserve direction when clamping', () => {
    const shooter = new THREE.Vector3(5, 1, -10);
    const hoop = new THREE.Vector3(0, 3.05, 13);
    const result = clampShotTarget(shooter, hoop, 12);
    const dirToHoop = new THREE.Vector3().subVectors(hoop, shooter).normalize();
    const dirToTarget = new THREE.Vector3().subVectors(result.target, shooter).normalize();
    expect(dirToHoop.dot(dirToTarget)).toBeCloseTo(1.0, 1);
  });
});
