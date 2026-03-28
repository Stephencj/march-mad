import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { isInDunkZone } from '@/game/shot-range';

describe('isInDunkZone', () => {
  const hoopHome = new THREE.Vector3(0, 3.05, -13);
  const hoopAway = new THREE.Vector3(0, 3.05, 13);

  it('should return true directly under home hoop', () => {
    expect(isInDunkZone(new THREE.Vector3(0, 0, -12), hoopHome)).toBe(true);
  });

  it('should return true directly under away hoop', () => {
    expect(isInDunkZone(new THREE.Vector3(0, 0, 12), hoopAway)).toBe(true);
  });

  it('should return false at mid-court', () => {
    expect(isInDunkZone(new THREE.Vector3(0, 0, 0), hoopHome)).toBe(false);
  });

  it('should return false outside paint width', () => {
    expect(isInDunkZone(new THREE.Vector3(3, 0, -12), hoopHome)).toBe(false);
  });

  it('should return false at paint edge far from hoop', () => {
    expect(isInDunkZone(new THREE.Vector3(0, 0, -9), hoopHome)).toBe(false);
  });

  it('should return true at edge of dunk zone', () => {
    expect(isInDunkZone(new THREE.Vector3(1.5, 0, -11.5), hoopHome)).toBe(true);
  });
});
