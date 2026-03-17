import * as THREE from 'three';

export class Ball {
  mesh: THREE.Mesh;
  heldBy: string | null = null;
  velocity = new THREE.Vector3();
  isInFlight = false;
  private arc: THREE.Vector3[] = [];
  private arcIndex = 0;
  private arcSpeed = 60;
  private passTarget: THREE.Vector3 | null = null;
  private passSpeed = 12;

  constructor(position = new THREE.Vector3(0, 1, 0)) {
    const geometry = new THREE.SphereGeometry(0.22, 12, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.6 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.name = 'ball';
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

  followHolder(holderPosition: THREE.Vector3, holderRotationY: number = 0, animTime: number = 0): void {
    if (this.heldBy === null) return;
    // Position ball in front of player based on facing direction
    const offsetDist = 0.4;
    const frontX = holderPosition.x + Math.sin(holderRotationY) * offsetDist;
    const frontZ = holderPosition.z + Math.cos(holderRotationY) * offsetDist;
    // Dribble bounce: ball goes from hand height down to near ground and back
    const dribbleY = 0.3 + Math.abs(Math.sin(animTime * 10)) * 0.7;
    this.mesh.position.set(frontX, dribbleY, frontZ);
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
    if (this.heldBy !== null) return;

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
        return;
      }
      // Move toward target at passSpeed, no gravity
      const direction = toTarget.normalize();
      this.velocity.copy(direction.multiplyScalar(this.passSpeed));
      this.mesh.position.addScaledVector(this.velocity, dt);
      return;
    }

    // State 4: normal gravity + bounce physics (existing)
    this.velocity.y -= 9.81 * dt;
    this.mesh.position.addScaledVector(this.velocity, dt);
    if (this.mesh.position.y < 0.22) {
      this.mesh.position.y = 0.22;
      this.velocity.y = -this.velocity.y * 0.6;
    }
  }
}
