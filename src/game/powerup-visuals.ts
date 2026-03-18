import * as THREE from 'three';

const TIER_COLORS: Record<string, number> = {
  // Tier 1 — green
  'speed-burst': 0x2ecc71,
  'hot-hand': 0x2ecc71,
  'sticky-fingers': 0x2ecc71,
  // Tier 2 — orange
  'on-fire': 0xf39c12,
  'phantom-step': 0xf39c12,
  'brick-wall': 0xf39c12,
  // Tier 3 — red
  'giant-ball': 0xe74c3c,
  'trampoline': 0xe74c3c,
  'force-field': 0xe74c3c,
};

export class PowerupVisuals {
  private orbGroup: THREE.Group | null = null;
  private orbTime = 0;
  private orbPosition: { x: number; z: number } = { x: 0, z: 0 };

  spawnOrb(type: string, position: { x: number; z: number }): THREE.Group {
    const color = TIER_COLORS[type] ?? 0xffffff;

    const group = new THREE.Group();
    group.name = 'powerup-orb';

    // Glowing sphere
    const sphereGeo = new THREE.SphereGeometry(0.2, 16, 12);
    const sphereMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.0,
      roughness: 0.2,
      metalness: 0.3,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.name = 'orb-sphere';
    group.add(sphere);

    // Rotating ring
    const ringGeo = new THREE.TorusGeometry(0.35, 0.02, 8, 32);
    const ringMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.6,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.name = 'orb-ring';
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Position above court
    group.position.set(position.x, 0.5, position.z);

    this.orbGroup = group;
    this.orbTime = 0;
    this.orbPosition = { x: position.x, z: position.z };

    return group;
  }

  removeOrb(): void {
    this.orbGroup = null;
  }

  hasActiveOrb(): boolean {
    return this.orbGroup !== null;
  }

  getOrbMesh(): THREE.Group | null {
    return this.orbGroup;
  }

  checkPickup(playerPosition: THREE.Vector3): boolean {
    if (!this.orbGroup) return false;

    const dx = playerPosition.x - this.orbPosition.x;
    const dz = playerPosition.z - this.orbPosition.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    return horizontalDist <= 1.0;
  }

  update(dt: number): void {
    if (!this.orbGroup) return;

    this.orbTime += dt;

    // Bob up/down: y = 0.5 +/- 0.15 via sine wave
    this.orbGroup.position.y = 0.5 + Math.sin(this.orbTime * 3) * 0.15;

    // Rotate the ring
    const ring = this.orbGroup.getObjectByName('orb-ring');
    if (ring) {
      ring.rotation.z += dt * 2;
    }

    // Pulse the sphere emissive intensity
    const sphere = this.orbGroup.getObjectByName('orb-sphere') as THREE.Mesh | undefined;
    if (sphere) {
      const mat = sphere.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.8 + Math.sin(this.orbTime * 5) * 0.4;
    }
  }
}
