import * as THREE from 'three';

export type CameraMode = 'broadcast' | 'slam' | 'spectator';

// Broadcast camera: fixed side-view that follows the action along the court
const HALF_COURT = { sideDistance: 18, height: 10 };
const FULL_COURT = { sideDistance: 22, height: 12 };

const LERP_SPEED = 4.0;
const SLAM_DURATION = 2.5; // seconds

// Court Z bounds used to clamp the camera
const HALF_COURT_Z = 7;
const FULL_COURT_Z = 14;

export class CameraSystem {
  private camera: THREE.PerspectiveCamera;
  private _currentMode: CameraMode = 'broadcast';
  private _previousMode: CameraMode = 'broadcast';
  private slamTimer = 0;
  private targetPosition = new THREE.Vector3();
  private targetLookAt = new THREE.Vector3();
  private _needsSnap = true;
  fullCourt = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  get currentMode(): CameraMode {
    return this._currentMode;
  }

  setMode(mode: CameraMode): void {
    if (mode !== this._currentMode) {
      this._previousMode = this._currentMode;
      this._currentMode = mode;
      this._needsSnap = true;
    }
  }

  triggerSlamCam(hoopPosition: THREE.Vector3): void {
    this._previousMode = this._currentMode;
    this._currentMode = 'slam';
    this.slamTimer = SLAM_DURATION;
    this._needsSnap = true;
  }

  update(trackPosition: THREE.Vector3, lookAtTarget: THREE.Vector3, dt: number): void {
    // Handle slam cam timer
    if (this._currentMode === 'slam') {
      this.slamTimer -= dt;
      if (this.slamTimer <= 0) {
        this._currentMode = this._previousMode === 'slam' ? 'broadcast' : this._previousMode;
        this.slamTimer = 0;
      }
    }

    const courtConfig = this.fullCourt ? FULL_COURT : HALF_COURT;
    const courtZ = this.fullCourt ? FULL_COURT_Z : HALF_COURT_Z;

    if (this._currentMode === 'slam') {
      // Slam cam: close-up near the action point
      this.targetPosition.set(
        trackPosition.x + 4,
        trackPosition.y + 2,
        trackPosition.z + 3
      );
      this.targetLookAt.copy(trackPosition);
    } else {
      // Broadcast camera: fixed X (side distance), fixed Y (height), Z follows action
      const clampedZ = THREE.MathUtils.clamp(trackPosition.z, -courtZ, courtZ);
      this.targetPosition.set(courtConfig.sideDistance, courtConfig.height, clampedZ);

      // Look at center of court (x=0), waist height, same Z as camera
      this.targetLookAt.set(0, 1.5, clampedZ);
    }

    if (this._needsSnap) {
      this.camera.position.copy(this.targetPosition);
      this._needsSnap = false;
    } else {
      const lerpFactor = 1 - Math.exp(-LERP_SPEED * dt);
      this.camera.position.lerp(this.targetPosition, lerpFactor);
    }

    this.camera.lookAt(this.targetLookAt);
  }
}
