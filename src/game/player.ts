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
  private animState: 'idle' | 'walk' | 'dribble' | 'guard' | 'steal' | 'shoot' | 'jump' = 'idle';
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
    const style = hairStyles[h % hairStyles.length];
    const hair = this.createHair(style, hairColor);
    hair.name = 'hair';
    neckGroup.add(hair);

    // ========== SHOULDERS (groups at shoulder joints) ==========
    const shoulderLeft = new THREE.Group();
    shoulderLeft.position.set(-0.18, 0.35, 0);
    shoulderLeft.name = 'shoulder-left';
    bodyPivot.add(shoulderLeft);

    const shoulderRight = new THREE.Group();
    shoulderRight.position.set(0.18, 0.35, 0);
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

    // Hair positions are relative to neckGroup (which is at body-pivot y=0.4)
    // Head center is at 0.35 relative to neckGroup, head top at ~0.63
    switch (style) {
      case 'flat-top': {
        // Box sitting on top of head — classic flat-top look
        const geo = new THREE.BoxGeometry(0.36, 0.16, 0.36);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, 0.71, 0); // just above head top
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
        mesh.position.set(0, 0.55, 0); // around head center-top
        return mesh;
      }

      case 'mohawk': {
        // Thin tall box running along the center of the head
        const geo = new THREE.BoxGeometry(0.06, 0.3, 0.32);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, 0.78, 0); // above head top
        return mesh;
      }

      case 'headband': {
        // Torus around the head at forehead height
        const geo = new THREE.TorusGeometry(0.29, 0.03, 6, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff2222 }); // bright red headband
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 0.43, 0); // at forehead level
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

    // Determine animation state
    if (this.isJumping) {
      this.animState = 'jump';
    } else if (this.stealTimer > 0) {
      this.animState = 'steal';
      this.stealTimer -= dt;
    } else if (this.shootTimer > 0) {
      this.animState = 'shoot';
      this.shootTimer -= dt;
    } else if (this.hasBall) {
      this.animState = 'dribble';
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
          1 + (1 - squashStretch) * 0.08,   // wider at ground
          1 - (1 - squashStretch) * 0.08 + squashStretch * 0.08, // shorter at ground, taller at peak
          1 + (1 - squashStretch) * 0.08    // wider at ground
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
        break;
      }

      case 'dribble': {
        const t = this.animTime * 5; // match walk speed

        if (this.velocity.lengthSq() > 0.01) {
          // Moving with ball — walk + dribble arm
          const bounceT = this.animTime * 10; // match walk double-bounce
          const bouncePhase = (Math.sin(bounceT) + 1) / 2;
          this.group.position.y = Math.pow(bouncePhase, 0.6) * 0.12; // subtler than walk

          // Squash-stretch on body pivot
          const squashStretch = bouncePhase; // 0 = ground contact, 1 = peak
          bodyPivot.scale.set(
            1 + (1 - squashStretch) * 0.08,   // wider at ground
            1 - (1 - squashStretch) * 0.08 + squashStretch * 0.08, // shorter at ground, taller at peak
            1 + (1 - squashStretch) * 0.08    // wider at ground
          );

          bodyPivot.rotation.x = 0.15; // slight crouch

          const strideRaw = Math.sin(t);
          const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * 0.5;
          hipL.rotation.x = -stride;
          hipR.rotation.x = stride;
          kneeL.rotation.x = 0.2 + Math.max(0, stride) * 0.5;
          kneeR.rotation.x = 0.2 + Math.max(0, -stride) * 0.5;
        } else {
          // Stationary dribble
          this.group.position.y = Math.sin(this.animTime * 1.5) * 0.03;
          bodyPivot.scale.set(1, 1, 1);
          bodyPivot.rotation.x = 0.1;
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
          kneeL.rotation.x = 0.15;
          kneeR.rotation.x = 0.15;
        }

        // Dribble arm (right): pumps DOWN to bounce ball
        const dribbleT = this.animTime * 4; // faster dribble
        shoulderR.rotation.x = -0.3;
        elbowR.rotation.x = -0.5 - Math.abs(Math.sin(dribbleT)) * 0.6;

        // Balance arm (left): OUT to the side and slightly forward, NOT tucked in
        shoulderL.rotation.x = -0.1; // barely forward
        shoulderL.rotation.z = 0.8; // OUT wide to the side (big z = more outward)
        elbowL.rotation.x = -0.3; // gentle natural bend
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
        shoulderL.rotation.x = -2.8; // nearly vertical (PI/2 = 1.57, go past it)
        shoulderL.rotation.z = 0.3; // spread slightly
        shoulderR.rotation.x = -2.8;
        shoulderR.rotation.z = -0.3;
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
        // SWORD SWING style: wind up HIGH, pause at crest, swipe DOWN
        bodyPivot.scale.set(1, 1, 1);
        const stealDuration = 0.5;
        const progress = 1 - (this.stealTimer / stealDuration); // 0 to 1

        // Phase 1 (0-0.4): Wind up — arm goes HIGH
        // Phase 2 (0.4-0.6): Pause at crest — arm big, dramatic hold
        // Phase 3 (0.6-1.0): Swipe DOWN fast
        let shoulderAngle: number;
        let elbowAngle: number;
        let forearmScale: number;

        if (progress < 0.4) {
          // Wind up: arm raises high
          const windUp = progress / 0.4; // 0 to 1
          shoulderAngle = -0.3 - windUp * 2.2; // goes from -0.3 to -2.5 (high up)
          elbowAngle = -0.1;
          forearmScale = 1 + windUp * 0.6; // starts growing
        } else if (progress < 0.6) {
          // Crest pause: hold high, arm at maximum size
          shoulderAngle = -2.5; // held high
          elbowAngle = -0.1;
          forearmScale = 1.8; // maximum size
        } else {
          // Swipe down: fast downward slash
          const swipeDown = (progress - 0.6) / 0.4; // 0 to 1
          shoulderAngle = -2.5 + swipeDown * 3.0; // swings from -2.5 to +0.5 (down past neutral)
          elbowAngle = -0.3 * (1 - swipeDown); // extends
          forearmScale = 1.8 - swipeDown * 0.8; // shrinks back
        }

        // Slight lean only, not dramatic lunge
        bodyPivot.rotation.x = 0.1;

        shoulderR.rotation.x = shoulderAngle;
        shoulderR.rotation.z = -0.2;
        elbowR.rotation.x = elbowAngle;

        // Forearm scales
        const forearmR = this.group.getObjectByName('forearm-right');
        if (forearmR) {
          forearmR.scale.set(forearmScale, forearmScale, forearmScale);
        }

        // Left arm: relaxed at side (NOT up their butt)
        shoulderL.rotation.x = 0; // neutral, hanging
        elbowL.rotation.x = -0.1; // slight natural bend

        // Slight step forward, not a lunge
        hipL.rotation.x = -0.1;
        hipR.rotation.x = 0.1;
        kneeL.rotation.x = 0.15;
        kneeR.rotation.x = 0.15;

        if (this.stealTimer <= 0 && forearmR) {
          forearmR.scale.set(1, 1, 1);
        }
        break;
      }

      case 'shoot': {
        // Shooting motion — arms push up, body extends
        bodyPivot.scale.set(1, 1, 1);
        const progress = 1 - (this.shootTimer / 0.4); // 0 to 1 over 0.4s
        bodyPivot.rotation.x = -0.1 * (1 - progress); // lean back then straighten
        // Both arms push up
        shoulderL.rotation.x = -0.5 - progress * 1.0;
        shoulderR.rotation.x = -0.5 - progress * 1.0;
        elbowL.rotation.x = -0.8 * (1 - progress); // NEGATIVE, extends to 0 at release
        elbowR.rotation.x = -0.8 * (1 - progress); // NEGATIVE
        // Legs straighten from crouch
        hipL.rotation.x = 0;
        hipR.rotation.x = 0;
        kneeL.rotation.x = 0.3 * (1 - progress);
        kneeR.rotation.x = 0.3 * (1 - progress);
        break;
      }

      case 'jump': {
        // Jump animation
        bodyPivot.scale.set(1, 1, 1);
        this.jumpTimer -= dt;
        const jumpDuration = 0.6;
        const progress = 1 - (this.jumpTimer / jumpDuration);

        // Parabolic height
        this.jumpHeight = Math.sin(progress * Math.PI) * 1.5;
        this.group.position.y = this.jumpHeight;

        if (progress < 0.3) {
          // Crouch at takeoff
          bodyPivot.rotation.x = 0.2;
          kneeL.rotation.x = 0.6 * (1 - progress / 0.3);
          kneeR.rotation.x = 0.6 * (1 - progress / 0.3);
          hipL.rotation.x = 0.1;
          hipR.rotation.x = 0.1;
          shoulderL.rotation.x = 0;
          shoulderR.rotation.x = 0;
          elbowL.rotation.x = -0.1;
          elbowR.rotation.x = -0.1;
        } else if (progress < 0.7) {
          // Extended in air
          bodyPivot.rotation.x = -0.1;
          kneeL.rotation.x = 0.05;
          kneeR.rotation.x = 0.05;
          hipL.rotation.x = -0.1;
          hipR.rotation.x = 0.1;
          // Arms up
          shoulderL.rotation.x = -1.2;
          shoulderR.rotation.x = -1.2;
          elbowL.rotation.x = -0.1;
          elbowR.rotation.x = -0.1;
        } else {
          // Landing
          bodyPivot.rotation.x = 0.15;
          kneeL.rotation.x = 0.4 * ((progress - 0.7) / 0.3);
          kneeR.rotation.x = 0.4 * ((progress - 0.7) / 0.3);
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
          shoulderL.rotation.x = 0;
          shoulderR.rotation.x = 0;
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
    }

    // Hide block screen when not guarding
    if (this.animState !== 'guard') {
      const screen = this.group.getObjectByName('block-screen');
      if (screen) screen.visible = false;
    }

    // Reset shoulder Z rotation if not in dribble/guard/steal
    if (this.animState !== 'dribble' && this.animState !== 'guard' && this.animState !== 'steal') {
      shoulderL.rotation.z = 0;
      shoulderR.rotation.z = 0;
    }

    // Reset forearm scale if not stealing
    if (this.animState !== 'steal') {
      const forearmR = this.group.getObjectByName('forearm-right');
      if (forearmR) forearmR.scale.set(1, 1, 1);
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
      if (this.hairRestY === undefined) this.hairRestY = hair.position.y; // capture once
      if (isMoving) {
        hair.position.y = this.hairRestY + Math.sin(this.animTime * 4 - 0.3) * 0.04;
      } else {
        hair.position.y = this.hairRestY;
      }
    }

    this.lastMoving = isMoving;
  }

  forceAnimState(state: 'idle' | 'walk' | 'dribble' | 'guard' | 'steal' | 'shoot' | 'jump'): void {
    this.animState = state;
  }

  triggerSteal(): void {
    this.stealTimer = 0.5; // longer for wind-up + pause + swipe
  }

  triggerShoot(): void {
    this.shootTimer = 0.4;
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
    const step = this.moveSpeed * dt;
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
