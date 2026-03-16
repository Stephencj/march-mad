import * as THREE from 'three';

export class Ball {
  mesh: THREE.Mesh;
  heldBy: string | null = null;
  velocity = new THREE.Vector3();

  constructor(position = new THREE.Vector3(0, 1, 0)) {
    const geometry = new THREE.SphereGeometry(0.12, 12, 8);
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

  update(dt: number): void {
    if (this.heldBy !== null) return;
    this.velocity.y -= 9.81 * dt;
    this.mesh.position.addScaledVector(this.velocity, dt);
    if (this.mesh.position.y < 0.12) {
      this.mesh.position.y = 0.12;
      this.velocity.y = -this.velocity.y * 0.6;
    }
  }
}
