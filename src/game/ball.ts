import * as THREE from 'three';

export class Ball {
  mesh: THREE.Mesh;
  heldBy: string | null = null;
  velocity = new THREE.Vector3();
  isInFlight = false;
  readonly radius = 0.22;
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
    const geometry = new THREE.SphereGeometry(0.22, 12, 8);
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
    this.dribbleHandMaxY = 0;
    this.dribbleHandMinY = 0;
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

  // Dribble bounce state
  private lastHandY = 0;
  private dribbleHandMaxY = 0;
  private dribbleHandMinY = 0;

  followHolder(playerGroup: THREE.Group, isDribbling = false): void {
    if (this.heldBy === null) return;

    // Get the right forearm from the nested skeleton
    const forearmRight = playerGroup.getObjectByName('forearm-right');
    if (!forearmRight) {
      this.mesh.position.set(playerGroup.position.x, playerGroup.position.y + 0.8, playerGroup.position.z);
      return;
    }

    // Update world matrices so nested transforms are current
    playerGroup.updateWorldMatrix(true, true);

    // Compute hand world position (tip of forearm)
    const handLocal = new THREE.Vector3(0, -0.11, 0);
    const handWorld = handLocal.applyMatrix4(forearmRight.matrixWorld);

    if (!isDribbling) {
      // Not dribbling — ball glued to hand (shooting, dunk, etc.)
      this.mesh.position.copy(handWorld);
      this.lastHandY = handWorld.y;
      return;
    }

    // DRIBBLE: ball follows hand in upper portion, bounces to floor in lower portion
    // Track the hand's Y range
    if (this.dribbleHandMaxY === 0) {
      this.dribbleHandMaxY = handWorld.y;
      this.dribbleHandMinY = handWorld.y;
    }
    this.dribbleHandMaxY = Math.max(this.dribbleHandMaxY, handWorld.y) - 0.002; // slowly decay
    this.dribbleHandMinY = Math.min(this.dribbleHandMinY, handWorld.y) + 0.002;

    const range = this.dribbleHandMaxY - this.dribbleHandMinY;
    if (range < 0.05) {
      // Hand barely moving — just stick to hand
      this.mesh.position.copy(handWorld);
    } else {
      // Normalize hand Y to 0-1 range (0 = lowest, 1 = highest)
      const normalized = Math.max(0, Math.min(1, (handWorld.y - this.dribbleHandMinY) / range));

      if (normalized > 0.4) {
        // Upper 60% — ball in hand
        this.mesh.position.copy(handWorld);
      } else {
        // Lower 40% — ball does floor bounce
        // Map 0.4->0 to a bounce arc: down to floor and back
        const bounceT = 1 - (normalized / 0.4); // 0 at hand release, 1 at hand lowest
        const floorY = this.radius;
        const releaseY = this.dribbleHandMinY + range * 0.4; // Y at the release point
        // Parabolic: quick drop, bounce, quick rise
        const arcT = Math.abs(bounceT * 2 - 1); // V shape: 0→1→0
        const bounceY = floorY + (releaseY - floorY) * arcT;
        this.mesh.position.set(handWorld.x, bounceY, handWorld.z);
      }
    }
    this.lastHandY = handWorld.y;
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
    if (this.mesh.position.y < 0.22) {
      this.mesh.position.y = 0.22;
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
