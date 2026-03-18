import * as THREE from 'three';

export class Ball {
  mesh: THREE.Mesh;
  heldBy: string | null = null;
  velocity = new THREE.Vector3();
  isInFlight = false;
  readonly radius = 0.16;
  private arc: THREE.Vector3[] = [];
  private arcIndex = 0;
  private arcSpeed = 60;
  private passTarget: THREE.Vector3 | null = null;
  private passSpeed = 12;

  private trail: THREE.Mesh[] = [];
  private trailGroup: THREE.Group;
  private readonly TRAIL_LENGTH = 8;
  private readonly TRAIL_INTERVAL = 0.02; // seconds between trail dots
  private trailTimer = 0;

  constructor(position = new THREE.Vector3(0, 1, 0)) {
    const geometry = new THREE.SphereGeometry(0.16, 12, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.6 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.name = 'ball';

    // Create trail group with shrinking, fading dots
    this.trailGroup = new THREE.Group();
    this.trailGroup.name = 'ball-trail';
    const trailMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true });
    for (let i = 0; i < this.TRAIL_LENGTH; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.12 - i * 0.01, 6, 4),
        trailMat.clone()
      );
      dot.visible = false;
      this.trail.push(dot);
      this.trailGroup.add(dot);
    }
  }

  getTrailGroup(): THREE.Group {
    return this.trailGroup;
  }

  pickup(playerId: string): void {
    this.heldBy = playerId;
    this.velocity.set(0, 0, 0);
  }

  release(): void {
    this.heldBy = null;
  }

  calculateArc(start: THREE.Vector3, target: THREE.Vector3, power: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const steps = 30;
    const distance = start.distanceTo(target);
    const peakHeight = start.y + distance * 0.3 * (0.5 + power * 0.5);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = THREE.MathUtils.lerp(start.x, target.x, t);
      const z = THREE.MathUtils.lerp(start.z, target.z, t);
      const y = THREE.MathUtils.lerp(start.y, target.y, t) + Math.sin(t * Math.PI) * peakHeight;
      points.push(new THREE.Vector3(x, y, z));
    }
    return points;
  }

  private dribbleReleaseX = 0;
  private dribbleReleaseZ = 0;

  followHolder(playerGroup: THREE.Group, isDribbling = false, dribblePhase = 0): void {
    if (this.heldBy === null) return;

    const forearmRight = playerGroup.getObjectByName('forearm-right');
    if (!forearmRight) {
      this.mesh.position.set(playerGroup.position.x, playerGroup.position.y + 0.8, playerGroup.position.z);
      return;
    }

    playerGroup.updateWorldMatrix(true, true);
    const handLocal = new THREE.Vector3(0, -0.11, 0);
    const handWorld = handLocal.applyMatrix4(forearmRight.matrixWorld);

    if (!isDribbling) {
      this.mesh.position.copy(handWorld);
      this.mesh.scale.set(1, 1, 1); // reset squash/stretch
      return;
    }

    // Offset ball phase so ball is at floor when hand is lowest
    const ballPhase = (dribblePhase + 0.25) % 1;
    const floorY = this.radius;

    // FIXED dribble spot: right side of player, slightly forward
    // Uses ONLY player position + rotation — NO hand world position (eliminates all jitter)
    const facing = playerGroup.rotation.y;
    // Forward offset (more in front of player)
    const fwdX = Math.sin(facing) * 0.35;
    const fwdZ = Math.cos(facing) * 0.35;
    // Right-side offset (perpendicular to facing, toward right arm — more outward)
    const rightX = Math.cos(facing) * 0.3;
    const rightZ = -Math.sin(facing) * 0.3;
    const dribbleX = playerGroup.position.x + fwdX + rightX;
    const dribbleZ = playerGroup.position.z + fwdZ + rightZ;

    // Y heights — fixed values, no handWorld dependency
    const handHeight = playerGroup.position.y + 0.55; // approximate hand height when arm is down
    const topHeight = playerGroup.position.y + 0.75; // hand height when arm is up

    if (ballPhase < 0.5) {
      // Ball in hand — lerp Y between top and releasing height
      const t = ballPhase / 0.5;
      const y = topHeight - t * (topHeight - handHeight) * 0.5;
      this.mesh.position.set(dribbleX, y, dribbleZ);
      this.mesh.scale.set(1, 1, 1);
    } else if (ballPhase < 0.6) {
      // Releasing — drop to floor
      const t = (ballPhase - 0.5) / 0.1;
      this.mesh.position.set(dribbleX, handHeight - (handHeight - floorY) * t, dribbleZ);
      this.mesh.scale.set(0.85, 1.3, 0.85);
    } else if (ballPhase < 0.8) {
      // At floor — squash on impact
      const t = (ballPhase - 0.6) / 0.2;
      const bounceUp = Math.sin(t * Math.PI) * 0.08;
      this.mesh.position.set(dribbleX, floorY + bounceUp, dribbleZ);
      const squash = 1 - Math.sin(t * Math.PI) * 0.3;
      const spread = 1 + Math.sin(t * Math.PI) * 0.2;
      this.mesh.scale.set(spread, squash, spread);
    } else {
      // Rising — back up to hand height
      const t = (ballPhase - 0.8) / 0.2;
      this.mesh.position.set(dribbleX, floorY + (topHeight - floorY) * t, dribbleZ);
      const stretch = 1 + (1 - t) * 0.15;
      this.mesh.scale.set(1 / stretch, stretch, 1 / stretch);
    }
  }

  shootAt(target: THREE.Vector3, power: number): void {
    const start = this.mesh.position.clone();
    this.arc = this.calculateArc(start, target, power);
    this.arcIndex = 0;
    this.isInFlight = true;
    this.passTarget = null;
    this.release();
  }

  passTo(target: THREE.Vector3): void {
    this.passTarget = target.clone();
    this.isInFlight = true;
    const direction = new THREE.Vector3().subVectors(target, this.mesh.position).normalize();
    this.velocity.copy(direction.multiplyScalar(this.passSpeed));
    this.arc = [];
    this.arcIndex = 0;
    this.release();
  }

  update(dt: number): void {
    // State 1: held by a player
    if (this.heldBy !== null) {
      this.hideTrail();
      return;
    }

    // State 2: following a shot arc
    if (this.arc.length > 0 && this.arcIndex < this.arc.length) {
      const stepsThisFrame = Math.max(1, Math.round(this.arcSpeed * dt));
      this.arcIndex = Math.min(this.arcIndex + stepsThisFrame, this.arc.length - 1);
      this.mesh.position.copy(this.arc[this.arcIndex]);
      if (this.arcIndex >= this.arc.length - 1) {
        this.isInFlight = false;
        this.arc = [];
        this.arcIndex = 0;
      }
      this.updateTrail(dt);
      return;
    }

    // State 3: chest-height pass (no gravity)
    if (this.passTarget) {
      const toTarget = new THREE.Vector3().subVectors(this.passTarget, this.mesh.position);
      const dist = toTarget.length();
      if (dist < 0.5) {
        this.isInFlight = false;
        this.passTarget = null;
        this.velocity.set(0, 0, 0);
        this.updateTrail(dt);
        return;
      }
      // Move toward target at passSpeed, no gravity
      const direction = toTarget.normalize();
      this.velocity.copy(direction.multiplyScalar(this.passSpeed));
      this.mesh.position.addScaledVector(this.velocity, dt);
      this.updateTrail(dt);
      return;
    }

    // State 4: normal gravity + bounce physics (existing)
    this.velocity.y -= 9.81 * dt;
    this.mesh.position.addScaledVector(this.velocity, dt);
    if (this.mesh.position.y < this.radius) {
      this.mesh.position.y = this.radius;
      this.velocity.y = -this.velocity.y * 0.6;
    }
    this.updateTrail(dt);
  }

  private updateTrail(dt: number): void {
    if (this.isInFlight) {
      this.trailTimer += dt;
      if (this.trailTimer >= this.TRAIL_INTERVAL) {
        this.trailTimer = 0;
        // Shift trail positions down
        for (let i = this.trail.length - 1; i > 0; i--) {
          this.trail[i].position.copy(this.trail[i - 1].position);
          this.trail[i].visible = this.trail[i - 1].visible;
        }
        // Set first trail dot to current ball position
        this.trail[0].position.copy(this.mesh.position);
        this.trail[0].visible = true;
      }
      // Update trail opacity (fade out toward tail)
      for (let i = 0; i < this.trail.length; i++) {
        const mat = this.trail[i].material as THREE.MeshBasicMaterial;
        mat.opacity = 1 - (i / this.trail.length);
      }
    } else {
      this.hideTrail();
    }
  }

  private hideTrail(): void {
    for (const dot of this.trail) {
      dot.visible = false;
    }
    this.trailTimer = 0;
  }
}
