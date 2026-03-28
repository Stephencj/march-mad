import * as THREE from 'three';

export interface ShotClampResult {
  target: THREE.Vector3;
  clamped: boolean;
}

const PAINT_HALF_WIDTH = 1.8;
const PAINT_LENGTH = 5.8;
const DUNK_ZONE_DEPTH = PAINT_LENGTH / 3; // ~1.93 units from hoop

export function isInDunkZone(
  playerPos: THREE.Vector3,
  attackHoop: THREE.Vector3
): boolean {
  if (Math.abs(playerPos.x) > PAINT_HALF_WIDTH) return false;
  const distFromHoop = Math.abs(playerPos.z - attackHoop.z);
  return distFromHoop < DUNK_ZONE_DEPTH;
}

export function clampShotTarget(
  shooterPos: THREE.Vector3,
  hoopPos: THREE.Vector3,
  maxRange: number
): ShotClampResult {
  const dist = shooterPos.distanceTo(hoopPos);
  if (dist <= maxRange) {
    return { target: hoopPos.clone(), clamped: false };
  }

  const direction = new THREE.Vector3().subVectors(hoopPos, shooterPos).normalize();
  const clampedTarget = shooterPos.clone().addScaledVector(direction, maxRange);
  clampedTarget.y = THREE.MathUtils.lerp(shooterPos.y, hoopPos.y, maxRange / dist);
  return { target: clampedTarget, clamped: true };
}
