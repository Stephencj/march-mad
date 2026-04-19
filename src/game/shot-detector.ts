import * as THREE from 'three';
import { FULL_COURT_DIMENSIONS } from '@/game/full-court';
import { ShotType } from '@/core/types';

export interface ShotCheckResult {
  made: boolean;
  shotType?: ShotType;
}

export class ShotDetector {
  private cooldown = 0;
  private hoopPosition: THREE.Vector3;

  constructor(hoopPosition: THREE.Vector3) {
    this.hoopPosition = hoopPosition;
  }

  setHoopPosition(pos: THREE.Vector3): void {
    this.hoopPosition = pos;
  }

  check(ballPosition: THREE.Vector3, ballVelocity: THREE.Vector3, inFlight: boolean): ShotCheckResult {
    if (!inFlight) {
      return { made: false };
    }

    if (this.cooldown > 0) {
      return { made: false };
    }

    const hoop = this.hoopPosition;

    // Horizontal distance from hoop center
    const dx = ballPosition.x - hoop.x;
    const dz = ballPosition.z - hoop.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    // Vertical distance from hoop
    const verticalDist = Math.abs(ballPosition.y - hoop.y);

    // Ball must be within 0.4 units horizontally and 0.5 units vertically of hoop,
    // and must be descending (velocity.y < 0)
    // Log when ball is near hoop for debugging
    if (horizontalDist < 3) {
      console.log(`[SHOT] hDist=${horizontalDist.toFixed(2)} vDist=${verticalDist.toFixed(2)} velY=${ballVelocity.y.toFixed(2)} descending=${ballVelocity.y < 0}`);
    }

    if (horizontalDist <= 0.8 && verticalDist <= 1.0 && ballVelocity.y < 0) {
      this.cooldown = 1;
      return { made: true };
    }

    return { made: false };
  }

  classifyShot(shooterPosition: THREE.Vector3, isDunk = false): ShotType {
    if (isDunk) {
      return 'dunk';
    }

    const hoop = this.hoopPosition;
    const dx = shooterPosition.x - hoop.x;
    const dz = shooterPosition.z - hoop.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 2) {
      return 'layup';
    }

    if (dist < FULL_COURT_DIMENSIONS.threePointRadius) {
      return 'mid-range';
    }

    return 'three-pointer';
  }

  tick(dt: number): void {
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
    }
  }

  reset(): void {
    this.cooldown = 0;
  }
}
