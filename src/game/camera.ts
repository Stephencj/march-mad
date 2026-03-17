import * as THREE from 'three';

export type CameraMode = 'offense' | 'defense' | 'slam' | 'spectator' | 'sub-in';

interface ModeConfig {
  offsetBehind: number;   // distance behind the ball/player along Z
  offsetHeight: number;   // Y height
  offsetSide: number;     // X lateral offset
}

const MODE_CONFIGS: Record<CameraMode, ModeConfig> = {
  offense:   { offsetBehind: 6,  offsetHeight: 4,  offsetSide: 0 },
  defense:   { offsetBehind: 10, offsetHeight: 8,  offsetSide: 2 },
  slam:      { offsetBehind: 3,  offsetHeight: 2,  offsetSide: 2 },
  spectator: { offsetBehind: 15, offsetHeight: 10, offsetSide: 0 },
  'sub-in':  { offsetBehind: 5,  offsetHeight: 3,  offsetSide: 3 },
};

const LERP_SPEED = 4.0;
const SLAM_DURATION = 2.5; // seconds

export class CameraSystem {
  private camera: THREE.PerspectiveCamera;
  private _currentMode: CameraMode = 'spectator';
  private _previousMode: CameraMode = 'spectator';
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

  update(playerPosition: THREE.Vector3, hoopPosition: THREE.Vector3, dt: number): void {
    // Handle slam cam timer
    if (this._currentMode === 'slam') {
      this.slamTimer -= dt;
      if (this.slamTimer <= 0) {
        this._currentMode = this._previousMode === 'slam' ? 'spectator' : this._previousMode;
        this.slamTimer = 0;
      }
    }

    // Compute target position based on current mode
    const baseConfig = MODE_CONFIGS[this._currentMode];
    let config = baseConfig;
    if (this.fullCourt && (this._currentMode === 'offense' || this._currentMode === 'defense')) {
      config = {
        offsetBehind: baseConfig.offsetBehind * 1.3,
        offsetHeight: baseConfig.offsetHeight * 1.25,
        offsetSide: baseConfig.offsetSide,
      };
    }
    this.computeTargetPosition(playerPosition, hoopPosition, config);

    const effectiveLerpSpeed = this.fullCourt ? 3 : LERP_SPEED;

    if (this._needsSnap) {
      // Snap directly to target on mode change
      this.camera.position.copy(this.targetPosition);
      this._needsSnap = false;
    } else {
      // Lerp camera position toward target for smooth transitions
      const lerpFactor = 1 - Math.exp(-effectiveLerpSpeed * dt);
      this.camera.position.lerp(this.targetPosition, lerpFactor);
    }

    // Look at the midpoint between player and hoop (or hoop for slam)
    if (this._currentMode === 'slam') {
      this.targetLookAt.copy(hoopPosition);
    } else {
      this.targetLookAt.lerpVectors(playerPosition, hoopPosition, 0.3);
    }
    this.camera.lookAt(this.targetLookAt);
  }

  private computeTargetPosition(
    playerPosition: THREE.Vector3,
    hoopPosition: THREE.Vector3,
    config: ModeConfig
  ): void {
    // Direction from hoop to player (camera goes behind the player relative to the hoop)
    const direction = new THREE.Vector3()
      .subVectors(playerPosition, hoopPosition)
      .normalize();

    // Position camera behind the player (away from the hoop)
    this.targetPosition.set(
      playerPosition.x + direction.x * config.offsetBehind + config.offsetSide,
      playerPosition.y + config.offsetHeight,
      playerPosition.z + direction.z * config.offsetBehind
    );
  }
}
