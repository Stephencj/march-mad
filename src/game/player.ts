import * as THREE from 'three';
import type { PlayerData } from '@/core/types';
import { POSITION_SCALES } from '@/core/types';

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

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export class GamePlayer {
  static courtBoundsZ: [number, number] = [-6.5, 6.5]; // default half court

  group: THREE.Group;
  data: PlayerData;
  hasBall = false;
  aiTarget: THREE.Vector3 | null = null;
  isHumanControlled = false;
  aiMovementState: 'holding' | 'moving' | 'reacting' = 'holding';
  aiHoldTimer = 0; // seconds remaining in hold state

  private stats = { points: 0, assists: 0, turnovers: 0 };
  private moveSpeed: number;
  animTime = 0;
  private lastMoving = false;
  velocity = new THREE.Vector3();
  private prevPosition = new THREE.Vector3();
  private animState: 'idle' | 'walk' | 'sprint' | 'dribble' | 'dribble-sprint' | 'guard' | 'steal' | 'shoot' | 'jump' | 'jump-block' | 'fall' | 'dunk' = 'idle';
  private prevAnimState: string = 'idle';
  private hairRestY: number | undefined;
  private stateTransitionTimer = 0;
  private readonly STATE_BLEND_DURATION = 0.12;
  private lastShoulderL = 0;
  private lastShoulderR = 0;
  private stealTimer = 0;
  private shootTimer = 0;
  private jumpTimer = 0;
  private jumpHeight = 0;
  isJumping = false;
  isSprinting = false;
  private fallTimer = 0;
  private dunkTimer = 0;
  dribblePhase = 0; // 0-1, exposed for ball sync

  constructor(data: PlayerData, position: THREE.Vector3, teamColor: number) {
    this.data = data;
    this.moveSpeed = 2 + data.stats.speed * 0.35; // 2.35 to 5.5 m/s — deliberate, not frantic
    this.group = this.createMesh(teamColor);
    this.group.position.copy(position);
    this.prevPosition.copy(position);
    this.group.name = `player-${data.id}`;

    if (data.position) {
      const scales = POSITION_SCALES[data.position];
      this.group.scale.set(scales.body, scales.height, scales.body);
      const head = this.group.getObjectByName('head');
      if (head) head.scale.multiplyScalar(scales.head);
    }
  }

  private createMesh(color: number): THREE.Group {
    const group = new THREE.Group();
    const h = hashId(this.data.id);
    const skinColor = skinToneFromHash(h);
    const hairColor = hairColorFromHash(h);

    // ---- Skin material (shared) ----
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor });
    const jerseyMat = new THREE.MeshStandardMaterial({ color });

    // ========== BODY PIVOT (root joint at hip height) ==========
    const bodyPivot = new THREE.Group();
    bodyPivot.position.set(0, 0.78, 0);
    bodyPivot.name = 'body-pivot';
    group.add(bodyPivot);

    // ========== TORSO (relative to body-pivot) ==========
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.4, 6), jerseyMat);
    torso.position.set(0, 0.2, 0);
    torso.name = 'torso';
    bodyPivot.add(torso);

    // ========== NECK GROUP (at top of torso) ==========
    const neckGroup = new THREE.Group();
    neckGroup.position.set(0, 0.4, 0);
    neckGroup.name = 'neck-group';
    bodyPivot.add(neckGroup);

    // Neck mesh inside neck group
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.15, 4), skinMat);
    neck.position.set(0, 0.075, 0);
    neck.name = 'neck';
    neckGroup.add(neck);

    // Head on top of neck
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), skinMat);
    head.position.set(0, 0.35, 0);
    head.name = 'head';
    neckGroup.add(head);

    // Eyes on head (relative to neck group)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    const eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 4), eyeMat);
    eyeLeft.position.set(-0.1, 0.39, 0.24);
    eyeLeft.name = 'eye-left';
    neckGroup.add(eyeLeft);
    const eyeRight = eyeLeft.clone();
    eyeRight.position.set(0.1, 0.39, 0.24);
    eyeRight.name = 'eye-right';
    neckGroup.add(eyeRight);

    // ========== HAIR (added to neckGroup) ==========
    const hairStyles: HairStyle[] = ['flat-top', 'afro', 'mohawk', 'headband'];
    const hairIndex = (this.data as any).hairOverride ?? (h % hairStyles.length);
    const style = hairStyles[hairIndex % hairStyles.length];
    const hair = this.createHair(style, hairColor);
    hair.name = 'hair';
    neckGroup.add(hair);

    // ========== BROAD SHOULDERS (connecting torso to arms) ==========
    // Shoulder cap meshes to bridge torso to arm joints
    const shoulderCapGeo = new THREE.SphereGeometry(0.08, 6, 4);
    const shoulderCapLeft = new THREE.Mesh(shoulderCapGeo, jerseyMat);
    shoulderCapLeft.position.set(-0.16, 0.35, 0);
    shoulderCapLeft.name = 'shoulder-cap-left';
    bodyPivot.add(shoulderCapLeft);

    const shoulderCapRight = new THREE.Mesh(shoulderCapGeo, jerseyMat);
    shoulderCapRight.position.set(0.16, 0.35, 0);
    shoulderCapRight.name = 'shoulder-cap-right';
    bodyPivot.add(shoulderCapRight);

    // Shoulder bar connecting across the top of the torso
    const shoulderBarGeo = new THREE.BoxGeometry(0.42, 0.06, 0.12);
    const shoulderBar = new THREE.Mesh(shoulderBarGeo, jerseyMat);
    shoulderBar.position.set(0, 0.37, 0);
    shoulderBar.name = 'shoulder-bar';
    bodyPivot.add(shoulderBar);

    // Shoulder joint groups
    const shoulderLeft = new THREE.Group();
    shoulderLeft.position.set(-0.2, 0.35, 0); // slightly wider to sit on caps
    shoulderLeft.name = 'shoulder-left';
    bodyPivot.add(shoulderLeft);

    const shoulderRight = new THREE.Group();
    shoulderRight.position.set(0.2, 0.35, 0);
    shoulderRight.name = 'shoulder-right';
    bodyPivot.add(shoulderRight);

    // Upper arms (hang down from shoulder)
    const armGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.28, 4);
    const upperArmLeft = new THREE.Mesh(armGeo, jerseyMat);
    upperArmLeft.position.set(0, -0.14, 0);
    upperArmLeft.name = 'upper-arm-left';
    shoulderLeft.add(upperArmLeft);

    const upperArmRight = new THREE.Mesh(armGeo, jerseyMat);
    upperArmRight.position.set(0, -0.14, 0);
    upperArmRight.name = 'upper-arm-right';
    shoulderRight.add(upperArmRight);

    // Elbows (groups at end of upper arm)
    const elbowLeft = new THREE.Group();
    elbowLeft.position.set(0, -0.14, 0);
    elbowLeft.name = 'elbow-left';
    upperArmLeft.add(elbowLeft);

    const elbowRight = new THREE.Group();
    elbowRight.position.set(0, -0.14, 0);
    elbowRight.name = 'elbow-right';
    upperArmRight.add(elbowRight);

    // Forearms
    const forearmGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.22, 4);
    const forearmLeft = new THREE.Mesh(forearmGeo, skinMat);
    forearmLeft.position.set(0, -0.11, 0);
    forearmLeft.name = 'forearm-left';
    elbowLeft.add(forearmLeft);

    const forearmRight = new THREE.Mesh(forearmGeo, skinMat);
    forearmRight.position.set(0, -0.11, 0);
    forearmRight.name = 'forearm-right';
    elbowRight.add(forearmRight);

    // ========== HIP/GROIN (bridges torso bottom to leg tops) ==========
    const hipGeo = new THREE.BoxGeometry(0.28, 0.1, 0.15); // wider than torso bottom, short
    const hipMesh = new THREE.Mesh(hipGeo, jerseyMat); // same color as jersey
    hipMesh.position.set(0, -0.05, 0); // just below body-pivot origin (which is at hip height)
    hipMesh.name = 'hip-mesh';
    bodyPivot.add(hipMesh);

    // ========== HIPS (groups at hip joints, relative to body-pivot at y=0) ==========
    const hipLeft = new THREE.Group();
    hipLeft.position.set(-0.08, 0, 0);
    hipLeft.name = 'hip-left';
    bodyPivot.add(hipLeft);

    const hipRight = new THREE.Group();
    hipRight.position.set(0.08, 0, 0);
    hipRight.name = 'hip-right';
    bodyPivot.add(hipRight);

    // Upper legs (hang down from hips)
    const upperLegGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.35, 5);
    const upperLegLeft = new THREE.Mesh(upperLegGeo, jerseyMat);
    upperLegLeft.position.set(0, -0.175, 0);
    upperLegLeft.name = 'upper-leg-left';
    hipLeft.add(upperLegLeft);

    const upperLegRight = new THREE.Mesh(upperLegGeo, jerseyMat);
    upperLegRight.position.set(0, -0.175, 0);
    upperLegRight.name = 'upper-leg-right';
    hipRight.add(upperLegRight);

    // Knees (groups at bottom of upper leg)
    const kneeLeft = new THREE.Group();
    kneeLeft.position.set(0, -0.175, 0);
    kneeLeft.name = 'knee-left';
    upperLegLeft.add(kneeLeft);

    const kneeRight = new THREE.Group();
    kneeRight.position.set(0, -0.175, 0);
    kneeRight.name = 'knee-right';
    upperLegRight.add(kneeRight);

    // Lower legs (hang from knees)
    const lowerLegGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.35, 5);
    const lowerLegLeft = new THREE.Mesh(lowerLegGeo, skinMat);
    lowerLegLeft.position.set(0, -0.175, 0);
    lowerLegLeft.name = 'lower-leg-left';
    kneeLeft.add(lowerLegLeft);

    const lowerLegRight = new THREE.Mesh(lowerLegGeo, skinMat);
    lowerLegRight.position.set(0, -0.175, 0);
    lowerLegRight.name = 'lower-leg-right';
    kneeRight.add(lowerLegRight);

    // Ankles (groups at bottom of lower leg)
    const ankleLeft = new THREE.Group();
    ankleLeft.position.set(0, -0.175, 0);
    ankleLeft.name = 'ankle-left';
    lowerLegLeft.add(ankleLeft);

    const ankleRight = new THREE.Group();
    ankleRight.position.set(0, -0.175, 0);
    ankleRight.name = 'ankle-right';
    lowerLegRight.add(ankleRight);

    // Shoes
    const shoeGeo = new THREE.BoxGeometry(0.14, 0.08, 0.2);
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const shoeLeft = new THREE.Mesh(shoeGeo, shoeMat);
    shoeLeft.position.set(0, -0.04, 0.02);
    shoeLeft.name = 'shoe-left';
    ankleLeft.add(shoeLeft);

    const shoeRight = new THREE.Mesh(shoeGeo, shoeMat);
    shoeRight.position.set(0, -0.04, 0.02);
    shoeRight.name = 'shoe-right';
    ankleRight.add(shoeRight);

    // ========== POSSESSION RING (direct child of group, not body-pivot) ==========
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

    // ========== PLAYER INDICATOR (direct child of group, not body-pivot) ==========
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

    // Hair positions relative to neckGroup.
    // Head center at y=0.35, head top at ~0.63, eyes at y=0.39 z=0.24 (front).
    // Hair should sit ON TOP and BEHIND the head, never covering the eyes.
    switch (style) {
      case 'flat-top': {
        // Sinks INTO the head slightly so edges don't float
        const geo = new THREE.BoxGeometry(0.34, 0.12, 0.28);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, 0.60, -0.03); // overlaps into head sphere
        return mesh;
      }

      case 'afro': {
        // Solid, envelops top/back of head
        const geo = new THREE.SphereGeometry(0.32, 8, 6);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, 0.50, -0.06);
        return mesh;
      }

      case 'mohawk': {
        // Sinks into head so it looks planted
        const geo = new THREE.BoxGeometry(0.06, 0.20, 0.26);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, 0.60, -0.03); // overlaps into head
        return mesh;
      }

      case 'headband': {
        // Basketball sweatband wrapped around forehead — like LeBron's headband
        // Head radius is 0.28, so band radius matches to hug the head
        const geo = new THREE.CylinderGeometry(0.285, 0.285, 0.06, 16, 1, true);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff2222, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 0.48, 0); // around forehead, above eyes (y=0.39)
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
    const isMoving = this.velocity.lengthSq() > 0.01;

    // Determine animation state (forced state overrides auto-detection)
    if (this.forcedAnimState) {
      this.animState = this.forcedAnimState as typeof this.animState;
      // Still tick timers even when forced
      if (this.stealTimer > 0) this.stealTimer -= dt;
      if (this.shootTimer > 0) this.shootTimer -= dt;
      if (this.fallTimer > 0) this.fallTimer -= dt;
      if (this.dunkTimer > 0) this.dunkTimer -= dt;
    } else if (this.fallTimer > 0) {
      this.animState = 'fall';
      this.fallTimer -= dt;
    } else if (this.dunkTimer > 0) {
      this.animState = 'dunk';
      this.dunkTimer -= dt;
    } else if (this.isJumping && !this.hasBall) {
      this.animState = 'jump-block'; // jumping without ball = blocking attempt
    } else if (this.isJumping) {
      this.animState = 'jump';
    } else if (this.stealTimer > 0) {
      this.animState = 'steal';
      this.stealTimer -= dt;
    } else if (this.shootTimer > 0) {
      this.animState = 'shoot';
      this.shootTimer -= dt;
    } else if (this.hasBall && isMoving && this.isSprinting) {
      this.animState = 'dribble-sprint';
    } else if (this.hasBall) {
      this.animState = 'dribble';
    } else if (isMoving && this.isSprinting) {
      this.animState = 'sprint';
    } else if (isMoving) {
      this.animState = 'walk';
    } else {
      this.animState = 'idle';
    }

    // Get joint references (nested hierarchy — getObjectByName searches recursively)
    const bodyPivot = this.group.getObjectByName('body-pivot')!;
    const hipL = this.group.getObjectByName('hip-left')!;
    const hipR = this.group.getObjectByName('hip-right')!;
    const kneeL = this.group.getObjectByName('knee-left')!;
    const kneeR = this.group.getObjectByName('knee-right')!;
    const shoulderL = this.group.getObjectByName('shoulder-left')!;
    const shoulderR = this.group.getObjectByName('shoulder-right')!;
    const elbowL = this.group.getObjectByName('elbow-left')!;
    const elbowR = this.group.getObjectByName('elbow-right')!;

    // Detect state changes for transition blending
    if (this.animState !== this.prevAnimState) {
      this.lastShoulderL = shoulderL.rotation.x;
      this.lastShoulderR = shoulderR.rotation.x;
      this.stateTransitionTimer = this.STATE_BLEND_DURATION;
      this.prevAnimState = this.animState;
    }
    if (this.stateTransitionTimer > 0) {
      this.stateTransitionTimer -= dt;
    }

    // Possession ring pulse
    const ring = this.group.getObjectByName('possession-ring');
    if (ring) {
      ring.visible = this.hasBall;
      if (this.hasBall) {
        const pulse = 1 + Math.sin(this.animTime * 4) * 0.15;
        ring.scale.set(pulse, 1, pulse);
      }
    }

    // Player indicator bob
    const indicator = this.group.getObjectByName('player-indicator');
    if (indicator) {
      indicator.visible = this.isHumanControlled;
      if (this.isHumanControlled) {
        indicator.position.y = 2.25 + Math.sin(this.animTime * 3) * 0.08;
      }
    }

    switch (this.animState) {
      case 'idle': {
        // Gentle breathing/sway
        bodyPivot.rotation.x = 0;
        bodyPivot.scale.set(1, 1, 1);
        hipL.rotation.x = 0;
        hipR.rotation.x = 0;
        kneeL.rotation.x = 0.05; // very slight natural bend
        kneeR.rotation.x = 0.05;
        shoulderL.rotation.x = 0;
        shoulderR.rotation.x = 0;
        elbowL.rotation.x = -0.1; // slight natural elbow bend
        elbowR.rotation.x = -0.1;
        // Gentle idle bob
        this.group.position.y = Math.sin(this.animTime * 1.5) * 0.03;
        break;
      }

      case 'walk': {
        // Bouncy stride — faster pace, subtler bounce
        const t = this.animTime * 5; // faster stride
        const bounceT = this.animTime * 10; // double freq for per-foot bounce
        const bouncePhase = (Math.sin(bounceT) + 1) / 2;
        this.group.position.y = Math.pow(bouncePhase, 0.6) * 0.15; // subtler (was 0.25)

        // Squash-stretch on body pivot
        const squashStretch = bouncePhase; // 0 = ground contact, 1 = peak
        bodyPivot.scale.set(
          1 + (1 - squashStretch) * 0.03,   // wider at ground
          1 - (1 - squashStretch) * 0.03 + squashStretch * 0.03, // shorter at ground, taller at peak
          1 + (1 - squashStretch) * 0.03    // wider at ground
        );

        // Forward lean
        bodyPivot.rotation.x = 0.12;

        // Leg stride — floaty power curve
        const strideRaw = Math.sin(t);
        const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * 0.6;

        hipL.rotation.x = -stride; // negative = forward swing
        hipR.rotation.x = stride;

        // Knee bend: more when leg is back (pushing off)
        kneeL.rotation.x = 0.15 + Math.max(0, stride) * 0.6;
        kneeR.rotation.x = 0.15 + Math.max(0, -stride) * 0.6;

        // Arms swing opposite to their OPPOSITE legs
        shoulderL.rotation.x = stride * 0.5;
        shoulderR.rotation.x = -stride * 0.5;
        elbowL.rotation.x = -0.3 - Math.max(0, stride) * 0.3;  // NEGATIVE = natural bend
        elbowR.rotation.x = -0.3 - Math.max(0, -stride) * 0.3; // NEGATIVE

        // Torso/hip counter-rotation for natural walk
        const torso = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torso && hipMeshNode) {
          // Hips twist WITH the leading leg, torso twists OPPOSITE
          hipMeshNode.rotation.y = stride * 0.15; // subtle hip twist
          torso.rotation.y = -stride * 0.1; // torso counter-twists
        }
        break;
      }

      case 'dribble': {
        const t = this.animTime * 5; // match walk speed

        // Compute dribble phase (0-1 cycle) — same speed for all modes
        const dribbleSpeed = 2.5; // Hz — cycles per second
        this.dribblePhase = (this.animTime * dribbleSpeed) % 1;

        // Map phase to arm position
        let elbowBend: number;
        if (this.dribblePhase < 0.3) {
          // Rising — arm coming up
          const pt = this.dribblePhase / 0.3;
          elbowBend = -0.5 - 0.5 * (1 - pt); // -1.0 to -0.5
        } else if (this.dribblePhase < 0.5) {
          // Pause at top — hand high
          elbowBend = -0.5; // least bent (hand highest)
        } else if (this.dribblePhase < 0.8) {
          // Pushing down
          const pt = (this.dribblePhase - 0.5) / 0.3;
          elbowBend = -0.5 - pt * 0.6; // -0.5 to -1.1 (most bent = hand lowest)
        } else {
          // Returning up from bottom
          const pt = (this.dribblePhase - 0.8) / 0.2;
          elbowBend = -1.1 + pt * 0.6; // -1.1 to -0.5
        }

        if (this.velocity.lengthSq() > 0.01) {
          // Moving with ball — walk legs + phase-based dribble arm
          const bounceT = this.animTime * 10; // match walk double-bounce
          const bouncePhase = (Math.sin(bounceT) + 1) / 2;
          this.group.position.y = Math.pow(bouncePhase, 0.6) * 0.12; // subtler than walk

          // Squash-stretch on body pivot (subtle)
          const squashStretch = bouncePhase;
          bodyPivot.scale.set(
            1 + (1 - squashStretch) * 0.03,
            1 - (1 - squashStretch) * 0.03 + squashStretch * 0.03,
            1 + (1 - squashStretch) * 0.03
          );

          bodyPivot.rotation.x = 0.15; // slight crouch

          const strideRaw = Math.sin(t);
          const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * 0.5;
          hipL.rotation.x = -stride;
          hipR.rotation.x = stride;
          kneeL.rotation.x = 0.2 + Math.max(0, stride) * 0.5;
          kneeR.rotation.x = 0.2 + Math.max(0, -stride) * 0.5;

          // Dribble arm (right): phase-based
          shoulderR.rotation.x = -0.3;
          elbowR.rotation.x = elbowBend;

          // Torso/hip counter-rotation for natural walk
          const torso = this.group.getObjectByName('torso');
          const hipMeshNode = this.group.getObjectByName('hip-mesh');
          if (torso && hipMeshNode) {
            hipMeshNode.rotation.y = stride * 0.15;
            torso.rotation.y = -stride * 0.1;
          }
        } else {
          // Stationary dribble
          this.group.position.y = Math.sin(this.animTime * 1.5) * 0.03;
          bodyPivot.scale.set(1, 1, 1);
          bodyPivot.rotation.x = 0.1;
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
          kneeL.rotation.x = 0.15;
          kneeR.rotation.x = 0.15;

          // Dribble arm (right): phase-based
          shoulderR.rotation.x = -0.3;
          elbowR.rotation.x = elbowBend;
        }

        // Balance arm (left): OUT to the side, not tucked in
        // LEFT shoulder: NEGATIVE rotation.z = arm goes OUTWARD (away from body)
        shoulderL.rotation.x = -0.1;
        shoulderL.rotation.z = -0.8; // NEGATIVE for left arm = outward
        elbowL.rotation.x = -0.3;
        break;
      }

      case 'guard': {
        // Low defensive stance with arms UP HIGH to block
        bodyPivot.scale.set(1, 1, 1);
        bodyPivot.rotation.x = 0.15; // slight forward lean
        hipL.rotation.x = 0.15; // wide stance
        hipR.rotation.x = -0.15;
        kneeL.rotation.x = 0.4; // deep crouch
        kneeR.rotation.x = 0.4;

        // Arms STRAIGHT UP to block — maximum reach
        shoulderL.rotation.x = -2.8;
        shoulderL.rotation.z = -0.4; // NEGATIVE = left arm spreads outward
        shoulderR.rotation.x = -2.8;
        shoulderR.rotation.z = 0.4; // POSITIVE = right arm spreads outward
        elbowL.rotation.x = -0.1; // nearly straight
        elbowR.rotation.x = -0.1;

        this.group.position.y = -0.08; // lower stance

        // Show/create block screen (semi-transparent plane in front)
        let screen = this.group.getObjectByName('block-screen');
        if (!screen) {
          const screenGeo = new THREE.PlaneGeometry(1.2, 1.5);
          const screenMat = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
          });
          screen = new THREE.Mesh(screenGeo, screenMat);
          screen.name = 'block-screen';
          screen.position.set(0, 1.2, 0.5); // in front of player, chest height
          this.group.add(screen);
        }
        screen.visible = true;
        // Pulse the screen opacity
        const screenMat = (screen as THREE.Mesh).material as THREE.MeshBasicMaterial;
        screenMat.opacity = 0.1 + Math.sin(this.animTime * 6) * 0.08;
        break;
      }

      case 'steal': {
        // SIDE SWIPE: arm pulls back to side, pauses, quick sweep across
        bodyPivot.scale.set(1, 1, 1);
        const stealDuration = 0.5;
        const progress = 1 - (this.stealTimer / stealDuration);

        // Phase 1 (0-0.15): Wind back — arm pulls to the right side
        // Phase 2 (0.15-0.5): Pause — held back, arm grows, anticipation
        // Phase 3 (0.5-0.85): Quick swipe — arm sweeps across low
        // Phase 4 (0.85-1.0): Recovery

        const forearmR = this.group.getObjectByName('forearm-right');
        let forearmScale = 1;

        bodyPivot.rotation.x = 0.05;
        if (progress < 0.15) {
          const wind = progress / 0.15;
          // Arm pulls to the right side
          shoulderR.rotation.x = -0.3 * wind;
          shoulderR.rotation.z = 0.8 * wind; // out to right
          elbowR.rotation.x = -0.3 * wind;
          forearmScale = 1 + wind * 0.4;
          // Torso twists away
          bodyPivot.rotation.y = 0.3 * wind;
        } else if (progress < 0.5) {
          // HOLD: cocked back, big forearm, dramatic pause
          shoulderR.rotation.x = -0.3;
          shoulderR.rotation.z = 0.8;
          elbowR.rotation.x = -0.3;
          forearmScale = 1.6;
          bodyPivot.rotation.y = 0.3;
        } else if (progress < 0.85) {
          // SWIPE: quick sweep from right to left, low
          const swipe = (progress - 0.5) / 0.35;
          shoulderR.rotation.x = -0.3 - swipe * 0.3;
          shoulderR.rotation.z = 0.8 - swipe * 1.6; // right to left
          elbowR.rotation.x = -0.3 + swipe * 0.1;
          forearmScale = 1.6 - swipe * 0.4;
          bodyPivot.rotation.y = 0.3 - swipe * 0.6;
        } else {
          // Recovery
          const recover = (progress - 0.85) / 0.15;
          shoulderR.rotation.x = -0.6 + recover * 0.6;
          shoulderR.rotation.z = -0.8 + recover * 0.8;
          elbowR.rotation.x = -0.2 + recover * 0.1;
          forearmScale = 1.2 - recover * 0.2;
          bodyPivot.rotation.y = -0.3 + recover * 0.3;
        }

        if (forearmR) {
          forearmR.scale.set(forearmScale, forearmScale, forearmScale);
          if (this.stealTimer <= 0) forearmR.scale.set(1, 1, 1);
        }

        // Left arm relaxed at side
        shoulderL.rotation.x = 0;
        elbowL.rotation.x = -0.1;

        // Stable stance
        hipL.rotation.x = -0.05;
        hipR.rotation.x = 0.05;
        kneeL.rotation.x = 0.2;
        kneeR.rotation.x = 0.2;
        break;
      }

      case 'shoot': {
        // Basketball shot: snap ball up to shooting position, release, arms back down
        // Phase 1 (0-0.15): Snap hands up together — ball in right hand (back), left guides (side)
        // Phase 2 (0.15-0.4): Quick release — right arm extends up, left peels away
        // Phase 3 (0.4-1.0): Follow through and arms back down
        bodyPivot.scale.set(1, 1, 1);
        const shootDuration = 0.4;
        const progress = 1 - (this.shootTimer / shootDuration); // 0 to 1

        // Slight hop during shot — quick up, brief hang, land
        let shootHeight: number;
        if (progress < 0.15) {
          // Crouch before jump
          shootHeight = 0;
        } else if (progress < 0.25) {
          // Quick rise
          const rise = (progress - 0.15) / 0.1;
          shootHeight = rise * 0.6;
        } else if (progress < 0.4) {
          // Hang time — release point
          shootHeight = 0.6;
        } else if (progress < 0.55) {
          // Coming down
          const descend = (progress - 0.4) / 0.15;
          shootHeight = 0.6 * (1 - descend);
        } else {
          // On ground, recovering
          shootHeight = 0;
        }
        this.group.position.y = shootHeight;

        if (progress < 0.15) {
          // SNAP: hands come up together to shooting position
          const snap = progress / 0.15; // 0 to 1 fast
          // Right arm (shooting hand): up and back behind head
          shoulderR.rotation.x = -1.8 * snap; // snaps up high
          shoulderR.rotation.z = 0.1 * snap; // slightly outward
          elbowR.rotation.x = -1.2 * snap; // bent, ball behind head
          // Left arm (guide hand): up and to the side of ball
          shoulderL.rotation.x = -1.6 * snap; // up, slightly less than right
          shoulderL.rotation.z = -0.3 * snap; // left arm comes inward toward ball
          elbowL.rotation.x = -0.8 * snap; // bent, hand on side of ball
          // Slight crouch
          bodyPivot.rotation.x = 0.05;
          kneeL.rotation.x = 0.3 * (progress / 0.15); // bend knees for crouch
          kneeR.rotation.x = 0.3 * (progress / 0.15);
        } else if (progress < 0.25) {
          // RISE: arms continue, legs extend
          const rise = (progress - 0.15) / 0.1;
          // Arm positions interpolate from snap-end to release-start
          const subRelease = (progress - 0.15) / 0.25; // partial into release phase
          shoulderR.rotation.x = -1.8 - subRelease * 0.8;
          shoulderR.rotation.z = 0.1;
          elbowR.rotation.x = -1.2 + subRelease * 1.0;
          shoulderL.rotation.x = -1.6 + subRelease * 1.0;
          shoulderL.rotation.z = -0.3 - subRelease * 0.3;
          elbowL.rotation.x = -0.8 + subRelease * 0.5;
          bodyPivot.rotation.x = 0.05 - subRelease * 0.15;
          kneeL.rotation.x = 0.3 * (1 - rise); // legs extend
          kneeR.rotation.x = 0.3 * (1 - rise);
        } else if (progress < 0.4) {
          // HANG TIME + RELEASE: right arm extends up, left peels away
          const subRelease = (progress - 0.15) / 0.25; // 0 to 1
          shoulderR.rotation.x = -1.8 - subRelease * 0.8; // goes higher (-2.6)
          shoulderR.rotation.z = 0.1;
          elbowR.rotation.x = -1.2 + subRelease * 1.0; // straightens out (-0.2)
          shoulderL.rotation.x = -1.6 + subRelease * 1.0; // drops to -0.6
          shoulderL.rotation.z = -0.3 - subRelease * 0.3; // opens outward more
          elbowL.rotation.x = -0.8 + subRelease * 0.5; // relaxes
          bodyPivot.rotation.x = 0.05 - subRelease * 0.15;
          kneeL.rotation.x = 0.05; // slight bend in air
          kneeR.rotation.x = 0.05;
        } else if (progress < 0.55) {
          // COMING DOWN: start recovery
          const descend = (progress - 0.4) / 0.15;
          const recover = (progress - 0.4) / 0.6; // partial into recover
          shoulderR.rotation.x = -2.6 + recover * 2.6;
          shoulderR.rotation.z = 0.1 * (1 - recover);
          elbowR.rotation.x = -0.2 + recover * 0.1;
          shoulderL.rotation.x = -0.6 + recover * 0.6;
          shoulderL.rotation.z = -0.6 + recover * 0.6;
          elbowL.rotation.x = -0.3 + recover * 0.2;
          bodyPivot.rotation.x = -0.1 + recover * 0.1;
          kneeL.rotation.x = descend * 0.2; // absorb landing
          kneeR.rotation.x = descend * 0.2;
        } else {
          // RECOVER: on ground, arms come back down to sides
          const recover = (progress - 0.4) / 0.6; // 0 to 1
          shoulderR.rotation.x = -2.6 + recover * 2.6; // back to 0
          shoulderR.rotation.z = 0.1 * (1 - recover);
          elbowR.rotation.x = -0.2 + recover * 0.1; // back to -0.1
          shoulderL.rotation.x = -0.6 + recover * 0.6; // back to 0
          shoulderL.rotation.z = -0.6 + recover * 0.6; // back to 0
          elbowL.rotation.x = -0.3 + recover * 0.2; // back to -0.1
          bodyPivot.rotation.x = -0.1 + recover * 0.1; // back to 0
          kneeL.rotation.x = 0;
          kneeR.rotation.x = 0;
        }
        hipL.rotation.x = 0;
        hipR.rotation.x = 0;
        break;
      }

      case 'jump': {
        bodyPivot.scale.set(1, 1, 1);
        this.jumpTimer -= dt;
        const jumpDuration = 0.6;
        const progress = 1 - (this.jumpTimer / jumpDuration);

        // Parabolic height
        this.jumpHeight = Math.sin(progress * Math.PI) * 1.8; // higher than before
        this.group.position.y = this.jumpHeight;

        if (progress < 0.15) {
          // WIND-UP: deep crouch, arms pull down gathering energy
          const crouch = progress / 0.15;
          bodyPivot.rotation.x = 0.25 * crouch; // lean forward into crouch
          kneeL.rotation.x = 0.8 * crouch; // deep knee bend
          kneeR.rotation.x = 0.8 * crouch;
          hipL.rotation.x = 0.15 * crouch;
          hipR.rotation.x = 0.15 * crouch;
          // Arms pull down and back
          shoulderL.rotation.x = 0.3 * crouch; // arms go back
          shoulderR.rotation.x = 0.3 * crouch;
          elbowL.rotation.x = -0.4 * crouch;
          elbowR.rotation.x = -0.4 * crouch;
        } else if (progress < 0.3) {
          // LAUNCH: explosive extension
          const launch = (progress - 0.15) / 0.15;
          bodyPivot.rotation.x = 0.25 - launch * 0.35; // snaps to slight back lean (-0.1)
          kneeL.rotation.x = 0.8 * (1 - launch); // legs straighten
          kneeR.rotation.x = 0.8 * (1 - launch);
          hipL.rotation.x = 0.15 * (1 - launch);
          hipR.rotation.x = 0.15 * (1 - launch);
          // Right arm reaches UP (dominant hand for layup/rebound)
          shoulderR.rotation.x = 0.3 - launch * 3.0; // goes from 0.3 to -2.7 (straight up)
          elbowR.rotation.x = -0.4 + launch * 0.3; // straightens to -0.1
          // Left arm out for balance
          shoulderL.rotation.x = 0.3 - launch * 0.8; // goes to -0.5
          shoulderL.rotation.z = -launch * 0.3; // out to side
          elbowL.rotation.x = -0.4 + launch * 0.2;
        } else if (progress < 0.7) {
          // HANG TIME: peak — iconic basketball pose
          bodyPivot.rotation.x = -0.1;
          kneeL.rotation.x = 0.15; // slight natural bend
          kneeR.rotation.x = 0.2;
          hipL.rotation.x = -0.1; // slight split
          hipR.rotation.x = 0.1;
          // Right arm fully extended UP (reaching for rim)
          shoulderR.rotation.x = -2.7;
          elbowR.rotation.x = -0.1;
          // Left arm out for balance
          shoulderL.rotation.x = -0.5;
          shoulderL.rotation.z = -0.3;
          elbowL.rotation.x = -0.2;
        } else if (progress < 0.85) {
          // DESCENT: start tucking
          const tuck = (progress - 0.7) / 0.15;
          bodyPivot.rotation.x = -0.1 + tuck * 0.15;
          shoulderR.rotation.x = -2.7 + tuck * 1.5; // arm comes down to -1.2
          elbowR.rotation.x = -0.1 - tuck * 0.2;
          shoulderL.rotation.x = -0.5 + tuck * 0.3;
          shoulderL.rotation.z = -0.3 + tuck * 0.3;
          elbowL.rotation.x = -0.2;
          kneeL.rotation.x = 0.15 + tuck * 0.2;
          kneeR.rotation.x = 0.2 + tuck * 0.2;
          hipL.rotation.x = -0.1 + tuck * 0.1;
          hipR.rotation.x = 0.1 - tuck * 0.1;
        } else {
          // LAND: deep absorb
          const land = (progress - 0.85) / 0.15;
          bodyPivot.rotation.x = 0.05 + land * 0.15; // lean forward on impact
          kneeL.rotation.x = 0.35 + land * 0.4; // deep bend absorb
          kneeR.rotation.x = 0.4 + land * 0.4;
          hipL.rotation.x = 0.05;
          hipR.rotation.x = 0.05;
          shoulderR.rotation.x = -1.2 + land * 1.1; // arms come down to ~-0.1
          shoulderL.rotation.x = -0.2 + land * 0.1;
          elbowR.rotation.x = -0.3 + land * 0.2;
          elbowL.rotation.x = -0.2 + land * 0.1;
          shoulderL.rotation.z = 0;
        }

        if (this.jumpTimer <= 0) {
          this.isJumping = false;
          this.jumpTimer = 0;
          this.group.position.y = 0;
        }
        break;
      }

      case 'sprint': {
        const t = this.animTime * 8; // faster than walk (5)
        const bounceT = this.animTime * 16; // double for per-foot
        const bouncePhase = (Math.sin(bounceT) + 1) / 2;
        this.group.position.y = Math.pow(bouncePhase, 0.6) * 0.2; // slightly bigger than walk

        const squashStretch = bouncePhase;
        bodyPivot.scale.set(
          1 + (1 - squashStretch) * 0.03,
          1 - (1 - squashStretch) * 0.03 + squashStretch * 0.03,
          1 + (1 - squashStretch) * 0.03
        );

        bodyPivot.rotation.x = 0.2; // more forward lean than walk

        const strideRaw = Math.sin(t);
        const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * 0.8; // bigger stride

        hipL.rotation.x = -stride;
        hipR.rotation.x = stride;
        kneeL.rotation.x = 0.2 + Math.max(0, stride) * 0.7; // deeper knee drive
        kneeR.rotation.x = 0.2 + Math.max(0, -stride) * 0.7;

        // Arms pump hard — elbows tight, fists driving
        shoulderL.rotation.x = stride * 0.7;
        shoulderR.rotation.x = -stride * 0.7;
        elbowL.rotation.x = -0.8; // tight elbow bend throughout
        elbowR.rotation.x = -0.8;

        const torso = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torso && hipMeshNode) {
          hipMeshNode.rotation.y = stride * 0.2; // more twist when sprinting
          torso.rotation.y = -stride * 0.15;
        }
        break;
      }

      case 'dribble-sprint': {
        const t = this.animTime * 7; // between walk and sprint speed
        const bounceT = this.animTime * 14;
        const bouncePhase = (Math.sin(bounceT) + 1) / 2;
        this.group.position.y = Math.pow(bouncePhase, 0.6) * 0.18;

        const squashStretch = bouncePhase;
        bodyPivot.scale.set(
          1 + (1 - squashStretch) * 0.03,
          1 - (1 - squashStretch) * 0.03 + squashStretch * 0.03,
          1 + (1 - squashStretch) * 0.03
        );

        bodyPivot.rotation.x = 0.18;

        const strideRaw = Math.sin(t);
        const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * 0.7;

        hipL.rotation.x = -stride;
        hipR.rotation.x = stride;
        kneeL.rotation.x = 0.2 + Math.max(0, stride) * 0.6;
        kneeR.rotation.x = 0.2 + Math.max(0, -stride) * 0.6;

        // Compute dribble phase (0-1 cycle) — same speed as all dribble modes
        const dribbleSpeed = 2.5; // Hz — cycles per second
        this.dribblePhase = (this.animTime * dribbleSpeed) % 1;

        // Map phase to arm position (same logic as dribble case)
        let elbowBend: number;
        if (this.dribblePhase < 0.3) {
          const pt = this.dribblePhase / 0.3;
          elbowBend = -0.5 - 0.5 * (1 - pt);
        } else if (this.dribblePhase < 0.5) {
          elbowBend = -0.5;
        } else if (this.dribblePhase < 0.8) {
          const pt = (this.dribblePhase - 0.5) / 0.3;
          elbowBend = -0.5 - pt * 0.6;
        } else {
          const pt = (this.dribblePhase - 0.8) / 0.2;
          elbowBend = -1.1 + pt * 0.6;
        }

        // Right arm dribbles — phase-based
        shoulderR.rotation.x = -0.3;
        elbowR.rotation.x = elbowBend;

        // Left arm pumps with stride
        shoulderL.rotation.x = stride * 0.5;
        shoulderL.rotation.z = -0.3; // slightly out
        elbowL.rotation.x = -0.6;

        const torso = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torso && hipMeshNode) {
          hipMeshNode.rotation.y = stride * 0.2;
          torso.rotation.y = -stride * 0.15;
        }
        break;
      }

      case 'jump-block': {
        bodyPivot.scale.set(1, 1, 1);
        this.jumpTimer -= dt;
        const jumpDuration = 0.6;
        const progress = 1 - (this.jumpTimer / jumpDuration);

        this.jumpHeight = Math.sin(progress * Math.PI) * 1.5;
        this.group.position.y = this.jumpHeight;

        if (progress < 0.15) {
          // Crouch
          const crouch = progress / 0.15;
          bodyPivot.rotation.x = 0.2 * crouch;
          kneeL.rotation.x = 0.7 * crouch;
          kneeR.rotation.x = 0.7 * crouch;
          hipL.rotation.x = 0.1 * crouch;
          hipR.rotation.x = 0.1 * crouch;
          shoulderL.rotation.x = 0.2 * crouch;
          shoulderR.rotation.x = 0.2 * crouch;
          elbowL.rotation.x = -0.3 * crouch;
          elbowR.rotation.x = -0.3 * crouch;
        } else if (progress < 0.3) {
          // Launch — BOTH arms shoot up
          const launch = (progress - 0.15) / 0.15;
          bodyPivot.rotation.x = 0.2 - launch * 0.25;
          kneeL.rotation.x = 0.7 * (1 - launch);
          kneeR.rotation.x = 0.7 * (1 - launch);
          hipL.rotation.x = 0.1 * (1 - launch);
          hipR.rotation.x = 0.1 * (1 - launch);
          shoulderL.rotation.x = 0.2 - launch * 2.9; // both arms straight up (-2.7)
          shoulderR.rotation.x = 0.2 - launch * 2.9;
          shoulderL.rotation.z = -launch * 0.3; // spread wide
          shoulderR.rotation.z = launch * 0.3;
          elbowL.rotation.x = -0.3 + launch * 0.2;
          elbowR.rotation.x = -0.3 + launch * 0.2;
        } else if (progress < 0.7) {
          // Hang time — both arms up, wide spread like a wall
          bodyPivot.rotation.x = -0.05;
          kneeL.rotation.x = 0.1;
          kneeR.rotation.x = 0.1;
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
          shoulderL.rotation.x = -2.7;
          shoulderR.rotation.x = -2.7;
          shoulderL.rotation.z = -0.4;
          shoulderR.rotation.z = 0.4;
          elbowL.rotation.x = -0.1;
          elbowR.rotation.x = -0.1;
        } else {
          // Land
          const land = (progress - 0.7) / 0.3;
          bodyPivot.rotation.x = -0.05 + land * 0.15;
          kneeL.rotation.x = 0.1 + land * 0.5;
          kneeR.rotation.x = 0.1 + land * 0.5;
          shoulderL.rotation.x = -2.7 + land * 2.6;
          shoulderR.rotation.x = -2.7 + land * 2.6;
          shoulderL.rotation.z = -0.4 + land * 0.4;
          shoulderR.rotation.z = 0.4 - land * 0.4;
          elbowL.rotation.x = -0.1;
          elbowR.rotation.x = -0.1;
        }

        if (this.jumpTimer <= 0) {
          this.isJumping = false;
          this.jumpTimer = 0;
          this.group.position.y = 0;
        }
        break;
      }

      case 'fall': {
        bodyPivot.scale.set(1, 1, 1);
        const fallDuration = 0.8;
        const progress = 1 - (this.fallTimer / fallDuration);

        if (progress < 0.4) {
          // Stagger back
          const stagger = progress / 0.4;
          bodyPivot.rotation.x = -0.3 * stagger; // lean back
          bodyPivot.rotation.z = 0.2 * stagger; // tilt sideways
          this.group.position.y = 0;
          // Arms flail
          shoulderL.rotation.x = -0.5 * stagger;
          shoulderL.rotation.z = -0.6 * stagger;
          shoulderR.rotation.x = -0.8 * stagger;
          shoulderR.rotation.z = 0.4 * stagger;
          elbowL.rotation.x = -0.3;
          elbowR.rotation.x = -0.5;
          // Legs buckle
          kneeL.rotation.x = 0.3 * stagger;
          kneeR.rotation.x = 0.5 * stagger;
          hipL.rotation.x = 0.1 * stagger;
          hipR.rotation.x = -0.1 * stagger;
        } else if (progress < 0.7) {
          // Hit the ground
          const ground = (progress - 0.4) / 0.3;
          bodyPivot.rotation.x = -0.3 - ground * 1.0; // falls flat back
          bodyPivot.rotation.z = 0.2;
          this.group.position.y = -ground * 0.3; // drops down
          shoulderL.rotation.x = -0.5 - ground * 0.5;
          shoulderL.rotation.z = -0.6 - ground * 0.4;
          shoulderR.rotation.x = -0.8;
          shoulderR.rotation.z = 0.4 + ground * 0.3;
          elbowL.rotation.x = -0.3;
          elbowR.rotation.x = -0.5;
          kneeL.rotation.x = 0.3 + ground * 0.3;
          kneeR.rotation.x = 0.5;
        } else {
          // Lying on ground
          bodyPivot.rotation.x = -1.3;
          bodyPivot.rotation.z = 0.2;
          this.group.position.y = -0.3;
          shoulderL.rotation.x = -1.0;
          shoulderL.rotation.z = -1.0;
          shoulderR.rotation.x = -0.8;
          shoulderR.rotation.z = 0.7;
          elbowL.rotation.x = -0.3;
          elbowR.rotation.x = -0.5;
          kneeL.rotation.x = 0.6;
          kneeR.rotation.x = 0.5;
        }

        if (this.fallTimer <= 0) {
          this.fallTimer = 0;
          this.group.position.y = 0;
        }
        break;
      }

      case 'dunk': {
        bodyPivot.scale.set(1, 1, 1);
        const dunkDuration = 0.7;
        const progress = 1 - (this.dunkTimer / dunkDuration);

        // Height — quick up, hang, quick down
        let height: number;
        if (progress < 0.25) {
          // Quick rise
          height = (progress / 0.25) * 2.5;
        } else if (progress < 0.55) {
          // Hang time at peak
          height = 2.5;
        } else if (progress < 0.75) {
          // Slam down (fast)
          height = 2.5 * (1 - (progress - 0.55) / 0.2);
        } else {
          // On ground
          height = 0;
        }
        this.group.position.y = height;

        if (progress < 0.25) {
          // RISE: both arms bring ball up together
          const rise = progress / 0.25;
          bodyPivot.rotation.x = 0.1 * (1 - rise); // straighten up
          kneeL.rotation.x = 0.4 * (1 - rise); // legs extend
          kneeR.rotation.x = 0.4 * (1 - rise);
          // Both arms sweep up together
          shoulderR.rotation.x = -rise * 2.6;
          shoulderL.rotation.x = -rise * 2.6;
          elbowR.rotation.x = -0.4 * (1 - rise); // straighten
          elbowL.rotation.x = -0.4 * (1 - rise);
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
        } else if (progress < 0.55) {
          // HANG TIME: arms overhead, slight body arch, legs relaxed
          bodyPivot.rotation.x = -0.1; // slight back arch
          shoulderR.rotation.x = -2.6;
          shoulderL.rotation.x = -2.6;
          elbowR.rotation.x = -0.1;
          elbowL.rotation.x = -0.1;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          kneeL.rotation.x = 0.15;
          kneeR.rotation.x = 0.2;
          hipL.rotation.x = -0.05;
          hipR.rotation.x = 0.05;
        } else if (progress < 0.75) {
          // SLAM: both arms drive DOWN, body curls forward
          const slam = (progress - 0.55) / 0.2;
          bodyPivot.rotation.x = -0.1 + slam * 0.4; // curl forward
          shoulderR.rotation.x = -2.6 + slam * 2.0; // to -0.6
          shoulderL.rotation.x = -2.6 + slam * 2.0;
          elbowR.rotation.x = -0.1 - slam * 0.3;
          elbowL.rotation.x = -0.1 - slam * 0.3;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          kneeL.rotation.x = 0.15 + slam * 0.2;
          kneeR.rotation.x = 0.2 + slam * 0.2;
        } else {
          // LAND: absorb impact
          const land = (progress - 0.75) / 0.25;
          bodyPivot.rotation.x = 0.3 * (1 - land);
          shoulderR.rotation.x = -0.6 + land * 0.5;
          shoulderL.rotation.x = -0.6 + land * 0.5;
          elbowR.rotation.x = -0.4 + land * 0.3;
          elbowL.rotation.x = -0.4 + land * 0.3;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          kneeL.rotation.x = 0.35 + land * 0.3; // deep bend absorb
          kneeR.rotation.x = 0.4 + land * 0.3;
        }

        if (this.dunkTimer <= 0) {
          this.dunkTimer = 0;
          this.group.position.y = 0;
        }
        break;
      }
    }

    // Hide block screen when not guarding
    if (this.animState !== 'guard') {
      const screen = this.group.getObjectByName('block-screen');
      if (screen) screen.visible = false;
    }

    // Reset shoulder Z rotation if not in dribble/guard/steal/jump/jump-block/dunk/dribble-sprint/fall
    if (this.animState !== 'dribble' && this.animState !== 'guard' && this.animState !== 'steal' && this.animState !== 'jump' && this.animState !== 'jump-block' && this.animState !== 'dunk' && this.animState !== 'dribble-sprint' && this.animState !== 'fall') {
      shoulderL.rotation.z = 0;
      shoulderR.rotation.z = 0;
    }

    // Reset body twist if not stealing
    if (this.animState !== 'steal') {
      bodyPivot.rotation.y = 0;
    }

    // Reset body tilt if not falling
    if (this.animState !== 'fall') {
      bodyPivot.rotation.z = 0;
    }

    // Reset forearm scale if not stealing
    if (this.animState !== 'steal') {
      const forearmR = this.group.getObjectByName('forearm-right');
      if (forearmR) forearmR.scale.set(1, 1, 1);
    }

    // Reset torso/hip twist for non-locomotion states
    if (this.animState !== 'walk' && this.animState !== 'sprint' && this.animState !== 'dribble' && this.animState !== 'dribble-sprint') {
      const torsoNode = this.group.getObjectByName('torso');
      const hipMeshNode = this.group.getObjectByName('hip-mesh');
      if (torsoNode) torsoNode.rotation.y = 0;
      if (hipMeshNode) hipMeshNode.rotation.y = 0;
    }

    // State transition blending (anticipation + follow-through)
    if (this.stateTransitionTimer > 0) {
      const blend = smoothstep(1 - this.stateTransitionTimer / this.STATE_BLEND_DURATION);
      shoulderL.rotation.x = this.lastShoulderL + (shoulderL.rotation.x - this.lastShoulderL) * blend;
      shoulderR.rotation.x = this.lastShoulderR + (shoulderR.rotation.x - this.lastShoulderR) * blend;
    }

    // Secondary motion: head counter-rotates slightly against body lean
    const neckGroup = this.group.getObjectByName('neck-group');
    if (neckGroup) {
      if (isMoving) {
        neckGroup.rotation.x = -bodyPivot.rotation.x * 0.3;
      } else {
        neckGroup.rotation.x = 0;
      }
    }

    // Hair bounce with slight delay from body (use stored rest position, never accumulate)
    const hair = this.group.getObjectByName('hair');
    if (hair) {
      if (this.hairRestY === undefined) this.hairRestY = hair.position.y;
      if (isMoving) {
        // Tiny bounce synced with walk — hair is attached to the head, minimal independent motion
        hair.position.y = this.hairRestY + Math.sin(this.animTime * 10 - 0.4) * 0.008;
      } else {
        hair.position.y = this.hairRestY;
      }
    }

    this.lastMoving = isMoving;
  }

  private forcedAnimState: string | null = null;

  forceAnimState(state: 'idle' | 'walk' | 'sprint' | 'dribble' | 'dribble-sprint' | 'guard' | 'steal' | 'shoot' | 'jump' | 'jump-block' | 'fall' | 'dunk' | null): void {
    this.forcedAnimState = state;
  }

  triggerSteal(): void {
    this.stealTimer = 0.5; // longer for wind-up + pause + swipe
  }

  triggerShoot(): void {
    this.shootTimer = 0.4;
  }

  triggerFall(): void {
    this.fallTimer = 0.8;
  }

  triggerDunk(): void {
    this.dunkTimer = 0.7;
  }

  jump(): void {
    if (this.isJumping) return;
    this.isJumping = true;
    this.jumpTimer = 0.6;
    this.jumpHeight = 0;
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

    const angle = Math.atan2(direction.x, direction.z);
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
    const speed = this.isSprinting ? this.moveSpeed * 1.6 : this.moveSpeed;
    const step = speed * dt;
    this.velocity.copy(direction).multiplyScalar(step / dt);
    this.group.position.addScaledVector(direction, step);

    // Clamp to court bounds
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -7, 7);
    this.group.position.z = THREE.MathUtils.clamp(
      this.group.position.z,
      GamePlayer.courtBoundsZ[0],
      GamePlayer.courtBoundsZ[1]
    );

    // Face movement direction
    const angle = Math.atan2(direction.x, direction.z);
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
