import * as THREE from 'three';
import type { PlayerData } from '@/core/types';

/**
 * Hair style types for Bobblehead Ballers.
 * Each player gets a deterministic style based on their ID hash.
 */
type HairStyle = 'flat-top' | 'afro' | 'mohawk' | 'headband';

/**
 * Simple hash function to derive a deterministic number from a player ID.
 */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Pick a skin tone that varies slightly per player for visual diversity.
 */
function skinToneFromHash(h: number): number {
  const tones = [0xd4956a, 0xc68642, 0x8d5524, 0xf1c27d, 0xe0ac69, 0xa57045];
  return tones[h % tones.length];
}

/**
 * Pick a hair color that varies per player.
 */
function hairColorFromHash(h: number): number {
  const colors = [0x2a1a0a, 0x1a1a1a, 0x4a3728, 0x0a0a0a, 0x3b2314, 0x5c3a1e];
  return colors[h % colors.length];
}

export class GamePlayer {
  group: THREE.Group;
  data: PlayerData;
  hasBall = false;
  aiTarget: THREE.Vector3 | null = null;
  isHumanControlled = false;

  private stats = { points: 0, assists: 0, turnovers: 0 };
  private moveSpeed: number;
  private animTime = 0;
  private lastMoving = false;
  private velocity = new THREE.Vector3();
  private prevPosition = new THREE.Vector3();

  constructor(data: PlayerData, position: THREE.Vector3, teamColor: number) {
    this.data = data;
    this.moveSpeed = 3 + data.stats.speed * 0.5;
    this.group = this.createMesh(teamColor);
    this.group.position.copy(position);
    this.prevPosition.copy(position);
    this.group.name = `player-${data.id}`;
  }

  private createMesh(color: number): THREE.Group {
    const group = new THREE.Group();
    const h = hashId(this.data.id);
    const skinColor = skinToneFromHash(h);
    const hairColor = hairColorFromHash(h);

    // ---- Skin material (shared) ----
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor });
    const jerseyMat = new THREE.MeshStandardMaterial({ color });

    // ========== SHOES (y = 0 to ~0.1) ==========
    const shoeGeo = new THREE.BoxGeometry(0.14, 0.08, 0.2);
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });

    const shoeLeft = new THREE.Mesh(shoeGeo, shoeMat);
    shoeLeft.position.set(-0.08, 0.04, 0.02);
    shoeLeft.name = 'shoe-left';
    group.add(shoeLeft);

    const shoeRight = new THREE.Mesh(shoeGeo, shoeMat);
    shoeRight.position.set(0.08, 0.04, 0.02);
    shoeRight.name = 'shoe-right';
    group.add(shoeRight);

    // ========== LOWER LEGS (y ~ 0.08 to 0.43) ==========
    const lowerLegGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.35, 5);

    const lowerLegLeft = new THREE.Mesh(lowerLegGeo, skinMat);
    lowerLegLeft.position.set(-0.08, 0.255, 0);
    lowerLegLeft.name = 'leg-lower-left';
    group.add(lowerLegLeft);

    const lowerLegRight = new THREE.Mesh(lowerLegGeo, skinMat);
    lowerLegRight.position.set(0.08, 0.255, 0);
    lowerLegRight.name = 'leg-lower-right';
    group.add(lowerLegRight);

    // ========== KNEE JOINTS (y ~ 0.43) ==========
    const kneeGeo = new THREE.SphereGeometry(0.055, 5, 4);

    const kneeLeft = new THREE.Mesh(kneeGeo, skinMat);
    kneeLeft.position.set(-0.08, 0.43, 0);
    kneeLeft.name = 'knee-left';
    group.add(kneeLeft);

    const kneeRight = new THREE.Mesh(kneeGeo, skinMat);
    kneeRight.position.set(0.08, 0.43, 0);
    kneeRight.name = 'knee-right';
    group.add(kneeRight);

    // ========== UPPER LEGS (y ~ 0.43 to 0.78) ==========
    const upperLegGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.35, 5);

    const upperLegLeft = new THREE.Mesh(upperLegGeo, jerseyMat);
    upperLegLeft.position.set(-0.08, 0.605, 0);
    upperLegLeft.name = 'leg-upper-left';
    group.add(upperLegLeft);

    const upperLegRight = new THREE.Mesh(upperLegGeo, jerseyMat);
    upperLegRight.position.set(0.08, 0.605, 0);
    upperLegRight.name = 'leg-upper-right';
    group.add(upperLegRight);

    // ========== TORSO (y ~ 0.78 to 1.18) ==========
    const torsoGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.4, 6);
    const torso = new THREE.Mesh(torsoGeo, jerseyMat);
    torso.position.set(0, 0.98, 0);
    torso.name = 'torso';
    group.add(torso);

    // ========== ARMS ==========
    // Upper arms (from shoulder height ~1.15, angled outward)
    const armGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.28, 4);

    const armLeft = new THREE.Mesh(armGeo, skinMat);
    armLeft.position.set(-0.2, 1.02, 0);
    armLeft.rotation.z = 0.2; // slightly angled outward
    armLeft.name = 'arm-left';
    group.add(armLeft);

    const armRight = new THREE.Mesh(armGeo, skinMat);
    armRight.position.set(0.2, 1.02, 0);
    armRight.rotation.z = -0.2;
    armRight.name = 'arm-right';
    group.add(armRight);

    // Forearms
    const forearmGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.22, 4);

    const forearmLeft = new THREE.Mesh(forearmGeo, skinMat);
    forearmLeft.position.set(-0.22, 0.77, 0);
    forearmLeft.name = 'forearm-left';
    group.add(forearmLeft);

    const forearmRight = new THREE.Mesh(forearmGeo, skinMat);
    forearmRight.position.set(0.22, 0.77, 0);
    forearmRight.name = 'forearm-right';
    group.add(forearmRight);

    // ========== NECK (y ~ 1.18 to 1.33) ==========
    const neckGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.15, 4);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.set(0, 1.255, 0);
    neck.name = 'neck';
    group.add(neck);

    // ========== HEAD (center ~1.58, radius 0.28 -> top at ~1.86) ==========
    const headGeo = new THREE.SphereGeometry(0.28, 8, 6);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 1.58, 0);
    head.name = 'head';
    group.add(head);

    // ========== EYES (simple dark spheres on the head) ==========
    const eyeGeo = new THREE.SphereGeometry(0.04, 4, 4);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const eyeLeft = new THREE.Mesh(eyeGeo, eyeMat);
    eyeLeft.position.set(-0.1, 1.62, 0.24);
    eyeLeft.name = 'eye-left';
    group.add(eyeLeft);

    const eyeRight = new THREE.Mesh(eyeGeo, eyeMat);
    eyeRight.position.set(0.1, 1.62, 0.24);
    eyeRight.name = 'eye-right';
    group.add(eyeRight);

    // ========== HAIR (random style based on player ID hash) ==========
    const hairStyles: HairStyle[] = ['flat-top', 'afro', 'mohawk', 'headband'];
    const style = hairStyles[h % hairStyles.length];
    const hair = this.createHair(style, hairColor);
    hair.name = 'hair';
    group.add(hair);

    // ========== POSSESSION RING (hidden by default) ==========
    const ringGeo = new THREE.TorusGeometry(0.35, 0.04, 6, 16);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xffd700,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.8,
    });
    const possessionRing = new THREE.Mesh(ringGeo, ringMat);
    possessionRing.rotation.x = -Math.PI / 2; // lay flat
    possessionRing.position.set(0, 0.02, 0);
    possessionRing.visible = false;
    possessionRing.name = 'possession-ring';
    group.add(possessionRing);

    // ========== PLAYER INDICATOR (chevron above head, hidden by default) ==========
    const indicator = this.createPlayerIndicator();
    indicator.name = 'player-indicator';
    indicator.visible = false;
    group.add(indicator);

    return group;
  }

  /**
   * Create a hair mesh based on the chosen style.
   */
  private createHair(style: HairStyle, hairColor: number): THREE.Object3D {
    const hairMat = new THREE.MeshStandardMaterial({ color: hairColor });

    switch (style) {
      case 'flat-top': {
        // Box sitting on top of head — classic flat-top look
        const geo = new THREE.BoxGeometry(0.36, 0.16, 0.36);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, 1.92, 0);
        return mesh;
      }

      case 'afro': {
        // Larger sphere on top of head, slightly transparent for volume feel
        const geo = new THREE.SphereGeometry(0.34, 8, 6);
        const mat = new THREE.MeshStandardMaterial({
          color: hairColor,
          transparent: true,
          opacity: 0.85,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 1.78, 0);
        return mesh;
      }

      case 'mohawk': {
        // Thin tall box running along the center of the head
        const geo = new THREE.BoxGeometry(0.06, 0.3, 0.32);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, 2.0, 0);
        return mesh;
      }

      case 'headband': {
        // Torus around the head at forehead height
        const geo = new THREE.TorusGeometry(0.29, 0.03, 6, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff2222 }); // bright red headband
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 1.66, 0);
        return mesh;
      }
    }
  }

  /**
   * Create a downward-pointing chevron/triangle indicator above the player's head.
   * Bright green (0x00ff88) so it's always visible.
   */
  private createPlayerIndicator(): THREE.Mesh {
    const shape = new THREE.Shape();
    // Downward-pointing triangle
    shape.moveTo(0, 0);
    shape.lineTo(0.1, 0.15);
    shape.lineTo(-0.1, 0.15);
    shape.lineTo(0, 0);

    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Position above the head (above hair), rotated to face camera
    mesh.position.set(0, 2.25, 0);
    mesh.rotation.x = -0.3; // slight tilt toward camera
    return mesh;
  }

  /**
   * Main animation method. Call every frame with delta time.
   *
   * Handles:
   * - Dribbling arm animation when holding ball
   * - Running arm swing when moving without ball
   * - Walk cycle leg animation when moving
   * - Possession ring pulsing
   * - Player indicator visibility
   */
  animate(dt: number): void {
    this.animTime += dt;

    // Detect if moving by comparing positions
    const isMoving = this.velocity.lengthSq() > 0.01;

    // --- Possession ring ---
    const ring = this.group.getObjectByName('possession-ring');
    if (ring) {
      ring.visible = this.hasBall;
      if (this.hasBall) {
        // Pulse: oscillate scale between 0.85 and 1.15
        const pulse = 1.0 + 0.15 * Math.sin(this.animTime * 4.0);
        ring.scale.set(pulse, pulse, 1);
      }
    }

    // --- Player indicator ---
    const indicator = this.group.getObjectByName('player-indicator');
    if (indicator) {
      indicator.visible = this.isHumanControlled;
      if (this.isHumanControlled) {
        // Gentle bob
        indicator.position.y = 2.25 + 0.05 * Math.sin(this.animTime * 3.0);
      }
    }

    // --- Arm animation ---
    const armRight = this.group.getObjectByName('arm-right');
    const armLeft = this.group.getObjectByName('arm-left');
    const forearmRight = this.group.getObjectByName('forearm-right');
    const forearmLeft = this.group.getObjectByName('forearm-left');

    if (this.hasBall) {
      // Dribble animation: right arm/forearm bobs up and down
      if (armRight) {
        armRight.rotation.x = 0.3 * Math.sin(this.animTime * 10.0);
      }
      if (forearmRight) {
        const dribbleBob = 0.12 * Math.sin(this.animTime * 10.0);
        forearmRight.position.y = 0.77 + dribbleBob;
        forearmRight.rotation.x = 0.4 * Math.sin(this.animTime * 10.0 + 0.5);
      }
      // Left arm stays mostly still when dribbling
      if (armLeft) {
        armLeft.rotation.x = 0;
      }
      if (forearmLeft) {
        forearmLeft.position.y = 0.77;
        forearmLeft.rotation.x = 0;
      }
    } else if (isMoving) {
      // Running arm swing
      const swing = 0.4 * Math.sin(this.animTime * 8.0);
      if (armRight) armRight.rotation.x = swing;
      if (armLeft) armLeft.rotation.x = -swing;
      if (forearmRight) {
        forearmRight.rotation.x = 0.2 * Math.sin(this.animTime * 8.0 + 1.0);
        forearmRight.position.y = 0.77;
      }
      if (forearmLeft) {
        forearmLeft.rotation.x = -0.2 * Math.sin(this.animTime * 8.0 + 1.0);
        forearmLeft.position.y = 0.77;
      }
    } else {
      // Idle: arms relax
      if (armRight) armRight.rotation.x = 0;
      if (armLeft) armLeft.rotation.x = 0;
      if (forearmRight) {
        forearmRight.rotation.x = 0;
        forearmRight.position.y = 0.77;
      }
      if (forearmLeft) {
        forearmLeft.rotation.x = 0;
        forearmLeft.position.y = 0.77;
      }
    }

    // --- Leg walk cycle ---
    const upperLeft = this.group.getObjectByName('leg-upper-left');
    const upperRight = this.group.getObjectByName('leg-upper-right');
    const lowerLeft = this.group.getObjectByName('leg-lower-left');
    const lowerRight = this.group.getObjectByName('leg-lower-right');
    const shoeLeft = this.group.getObjectByName('shoe-left');
    const shoeRight = this.group.getObjectByName('shoe-right');

    if (isMoving) {
      const walkCycle = this.animTime * 8.0;
      const legSwing = 0.35 * Math.sin(walkCycle);

      if (upperLeft) upperLeft.rotation.x = legSwing;
      if (upperRight) upperRight.rotation.x = -legSwing;

      // Lower legs have a secondary swing (delayed phase)
      const lowerSwing = 0.25 * Math.sin(walkCycle + 1.2);
      if (lowerLeft) lowerLeft.rotation.x = lowerSwing;
      if (lowerRight) lowerRight.rotation.x = -lowerSwing;

      // Shoes follow lower legs
      const shoeSwing = 0.15 * Math.sin(walkCycle + 1.5);
      if (shoeLeft) shoeLeft.rotation.x = shoeSwing;
      if (shoeRight) shoeRight.rotation.x = -shoeSwing;
    } else {
      // Idle: legs straight
      if (upperLeft) upperLeft.rotation.x = 0;
      if (upperRight) upperRight.rotation.x = 0;
      if (lowerLeft) lowerLeft.rotation.x = 0;
      if (lowerRight) lowerRight.rotation.x = 0;
      if (shoeLeft) shoeLeft.rotation.x = 0;
      if (shoeRight) shoeRight.rotation.x = 0;
    }

    this.lastMoving = isMoving;
  }

  moveToward(target: THREE.Vector3, dt: number): void {
    const direction = new THREE.Vector3().subVectors(target, this.group.position);
    direction.y = 0;
    const distance = direction.length();
    if (distance < 0.1) {
      this.velocity.set(0, 0, 0);
      this.animate(dt);
      return;
    }

    direction.normalize();
    const step = this.moveSpeed * dt;
    const actualStep = Math.min(step, distance);
    this.velocity.copy(direction).multiplyScalar(actualStep / dt);
    this.group.position.addScaledVector(direction, actualStep);

    const angle = Math.atan2(-direction.x, -direction.z);
    this.group.rotation.y = angle;

    this.animate(dt);
  }

  recordStat(stat: 'points' | 'assists' | 'turnovers', value: number): void {
    this.stats[stat] += value;
  }

  get performanceScore(): number {
    return this.stats.points + this.stats.assists - this.stats.turnovers;
  }

  resetStats(): void {
    this.stats = { points: 0, assists: 0, turnovers: 0 };
  }

  giveBall(): void {
    this.hasBall = true;
  }

  loseBall(): void {
    this.hasBall = false;
  }

  moveByInput(inputX: number, inputZ: number, dt: number): void {
    if (inputX === 0 && inputZ === 0) {
      this.velocity.set(0, 0, 0);
      this.animate(dt);
      return;
    }
    const direction = new THREE.Vector3(inputX, 0, inputZ).normalize();
    const step = this.moveSpeed * dt;
    this.velocity.copy(direction).multiplyScalar(step / dt);
    this.group.position.addScaledVector(direction, step);

    // Clamp to court bounds
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -7, 7);
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -6.5, 6.5);

    // Face movement direction
    const angle = Math.atan2(-direction.x, -direction.z);
    this.group.rotation.y = angle;

    this.animate(dt);
  }

  distanceTo(point: THREE.Vector3): number {
    const dx = this.group.position.x - point.x;
    const dz = this.group.position.z - point.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }
}
