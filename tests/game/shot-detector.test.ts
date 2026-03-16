import { describe, it, expect } from 'vitest';
import { ShotDetector } from '@/game/shot-detector';
import * as THREE from 'three';
import { COURT_DIMENSIONS } from '@/game/court';

describe('ShotDetector', () => {
  const hoopPos = COURT_DIMENSIONS.hoopPosition;

  it('detects made shot when ball passes through hoop', () => {
    const detector = new ShotDetector();
    const result = detector.check(
      new THREE.Vector3(hoopPos.x, hoopPos.y + 0.1, hoopPos.z),
      new THREE.Vector3(0, -2, 0), true
    );
    expect(result.made).toBe(true);
  });

  it('does not detect when ball is far from hoop', () => {
    const detector = new ShotDetector();
    const result = detector.check(new THREE.Vector3(5, 2, 5), new THREE.Vector3(0, -1, 0), true);
    expect(result.made).toBe(false);
  });

  it('does not detect when ball is not in flight', () => {
    const detector = new ShotDetector();
    const result = detector.check(
      new THREE.Vector3(hoopPos.x, hoopPos.y, hoopPos.z), new THREE.Vector3(0, -1, 0), false
    );
    expect(result.made).toBe(false);
  });

  it('classifies inside arc as layup/mid-range', () => {
    const detector = new ShotDetector();
    const result = detector.classifyShot(new THREE.Vector3(0, 1, -2));
    expect(['layup', 'mid-range']).toContain(result);
  });

  it('classifies outside arc as three-pointer', () => {
    const detector = new ShotDetector();
    const result = detector.classifyShot(new THREE.Vector3(0, 1, 5));
    expect(result).toBe('three-pointer');
  });

  it('classifies as dunk when flagged', () => {
    const detector = new ShotDetector();
    const result = detector.classifyShot(new THREE.Vector3(0, 1, -5), true);
    expect(result).toBe('dunk');
  });

  it('prevents double-detection with cooldown', () => {
    const d = new ShotDetector();
    const r1 = d.check(new THREE.Vector3(hoopPos.x, hoopPos.y + 0.1, hoopPos.z), new THREE.Vector3(0, -2, 0), true);
    expect(r1.made).toBe(true);
    const r2 = d.check(new THREE.Vector3(hoopPos.x, hoopPos.y + 0.1, hoopPos.z), new THREE.Vector3(0, -2, 0), true);
    expect(r2.made).toBe(false);
  });
});
