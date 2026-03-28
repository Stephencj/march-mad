import * as THREE from 'three';

export interface ShotClampResult {
  target: THREE.Vector3;
  clamped: boolean;
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
