import * as THREE from 'three';
import type { PlayerData } from '@/core/types';
import { POSITION_SCALES } from '@/core/types';
import { playerConfig } from '@/dev/player-config';
import { animConfig } from '@/dev/anim-config';

/**
 * Hair style types for Bobblehead Ballers.
 * Each player gets a deterministic style based on their ID hash.
 */
type HairStyle = 'bald' | 'receding' | 'flat-top' | 'afro' | 'mohawk' | 'headband';

/**
 * Weighted distribution — this is middle-aged-dad pickup-league, so
 * chrome-dome-and-horseshoe combined dominate. Ordered: pick a random
 * integer in [0, total), find the bucket whose cumulative weight contains it.
 */
const HAIR_STYLE_WEIGHTS: Array<{ style: HairStyle; weight: number }> = [
  { style: 'bald',     weight: 40 },
  { style: 'receding', weight: 25 },
  { style: 'flat-top', weight: 15 },
  { style: 'afro',     weight: 5  },
  { style: 'mohawk',   weight: 5  },
  { style: 'headband', weight: 10 },
];
const HAIR_STYLE_TOTAL_WEIGHT = HAIR_STYLE_WEIGHTS.reduce((a, b) => a + b.weight, 0);

function pickHairStyleFromHash(h: number): HairStyle {
  const pick = h % HAIR_STYLE_TOTAL_WEIGHT;
  let cumulative = 0;
  for (const entry of HAIR_STYLE_WEIGHTS) {
    cumulative += entry.weight;
    if (pick < cumulative) return entry.style;
  }
  return HAIR_STYLE_WEIGHTS[HAIR_STYLE_WEIGHTS.length - 1].style;
}

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
  // Middle-aged palette: browns + blacks mixed with grays, salt-and-pepper,
  // and full gray/white for the older guys. Gray variants weighted ~1/3.
  const colors = [
    0x2a1a0a, 0x1a1a1a, 0x4a3728, 0x0a0a0a, 0x3b2314, 0x5c3a1e, // darks
    0x6b5a4a, 0x8a7a6a,                                          // salt-and-pepper
    0xb8b0a8, 0xdad2c8, 0xe8e0d8,                                // gray to near-white
  ];
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
  // Low-pass-filtered version of the current aiTarget, used by AI movement to
  // damp input-jitter feedback (human stick wiggle -> ball pos wiggle -> zone
  // defense target wiggle -> visible AI jitter). Populated from game-session
  // just before each moveToward() call on AI players.
  smoothedAiTarget: THREE.Vector3 | null = null;
  isHumanControlled = false;
  aiMovementState: 'holding' | 'moving' | 'reacting' = 'holding';
  aiHoldTimer = 0; // seconds remaining in hold state

  private stats = { points: 0, assists: 0, turnovers: 0 };
  private moveSpeed: number;
  animTime = 0;
  private lastMoving = false;
  velocity = new THREE.Vector3();
  private prevPosition = new THREE.Vector3();
  private animState: 'idle' | 'walk' | 'sprint' | 'dribble' | 'dribble-sprint' | 'guard' | 'steal' | 'shoot' | 'jump' | 'jump-block' | 'fall' | 'dunk' | 'pass' = 'idle';
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
  isCharging = false;
  chargeTimer = 0;
  stamina = 1.0;
  isExhausted = false;
  isGuarding = false;
  isBlocking = false;
  guardTimer = 0;
  private fallTimer = 0;
  dunkTimer = 0;
  dunkTarget: { x: number; z: number } | null = null;
  private passTimer = 0;
  dribblePhase = 0; // 0-1, exposed for ball sync
  // Sticky flag for forward-vs-backward walk animation. Hysteretic to avoid
  // per-frame flicker when facing direction and move direction are nearly
  // perpendicular. Updated in animate() before the walk anim branch reads it.
  isMovingBackwards = false;

  /**
   * 0 = normal dad, 1 = fully transformed college-athlete mutant.
   * Game-session sets this per-frame based on match.isMutant + elapsed
   * time since the buff activated. Player.applyMutantTransform() consumes
   * it and scales the mesh. Mutation scale layers on top of POSITION_SCALES
   * — we capture the base scale in the constructor so we can compose.
   */
  mutantFactor = 0;
  private baseScale = new THREE.Vector3(1, 1, 1);

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
    }
    this.baseScale.copy(this.group.scale);
  }

  /**
   * Called each frame from game-session when this player is the mutant.
   * `factor` is a 0..1 progress value (the 0.5s transformation ramp + hold
   * at 1 while active + ramp back to 0 on expire). Applies the
   * "college-athlete self" look: bigger overall + proportional emphasis.
   */
  applyMutantTransform(factor: number): void {
    this.mutantFactor = factor;
    // Overall scale: 1.0 baseline → 1.6 peak, biased toward Y (taller) and X (wider)
    const mul = 1 + factor * 0.6;
    this.group.scale.set(
      this.baseScale.x * mul,
      this.baseScale.y * (1 + factor * 0.75), // extra height
      this.baseScale.z * mul,
    );
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
    const cfg = playerConfig;
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.body.torsoWidth, cfg.body.torsoHeight, cfg.body.torsoDepth),
      jerseyMat,
    );
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
    const head = new THREE.Mesh(new THREE.SphereGeometry(cfg.head.radius, 8, 6), skinMat);
    head.position.set(0, cfg.head.positionY, 0);
    head.name = 'head';
    neckGroup.add(head);

    // Eyes on head (relative to neck group)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    const eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(cfg.head.eyeRadius, 4, 4), eyeMat);
    eyeLeft.position.set(-cfg.head.eyeOffsetX, cfg.head.eyeOffsetY, cfg.head.eyeOffsetZ);
    eyeLeft.name = 'eye-left';
    neckGroup.add(eyeLeft);
    const eyeRight = eyeLeft.clone();
    eyeRight.position.set(cfg.head.eyeOffsetX, cfg.head.eyeOffsetY, cfg.head.eyeOffsetZ);
    eyeRight.name = 'eye-right';
    neckGroup.add(eyeRight);

    // ========== HAIR (added to neckGroup) ==========
    // hairOverride (0..5) maps to the style list in HAIR_STYLE_WEIGHTS order;
    // otherwise the weighted distribution picks a style from the hash.
    const hairOverride = (this.data as any).hairOverride as number | undefined;
    const style = hairOverride !== undefined
      ? (HAIR_STYLE_WEIGHTS[hairOverride % HAIR_STYLE_WEIGHTS.length].style)
      : pickHairStyleFromHash(h);
    const hair = this.createHair(style, hairColor);
    hair.name = 'hair';
    neckGroup.add(hair);

    // ========== BROAD SHOULDERS (connecting torso to arms) ==========
    // Shoulder cap meshes to bridge torso to arm joints
    const shoulderCapGeo = new THREE.SphereGeometry(cfg.body.shoulderCapRadius, 6, 4);
    const shoulderCapLeft = new THREE.Mesh(shoulderCapGeo, jerseyMat);
    shoulderCapLeft.position.set(-0.16, cfg.body.shoulderCapY, 0);
    shoulderCapLeft.name = 'shoulder-cap-left';
    bodyPivot.add(shoulderCapLeft);

    const shoulderCapRight = new THREE.Mesh(shoulderCapGeo, jerseyMat);
    shoulderCapRight.position.set(0.16, cfg.body.shoulderCapY, 0);
    shoulderCapRight.name = 'shoulder-cap-right';
    bodyPivot.add(shoulderCapRight);

    // Shoulder bar connecting across the top of the torso
    const shoulderBarGeo = new THREE.BoxGeometry(
      cfg.body.shoulderBarWidth, cfg.body.shoulderBarHeight, cfg.body.shoulderBarDepth,
    );
    const shoulderBar = new THREE.Mesh(shoulderBarGeo, jerseyMat);
    shoulderBar.position.set(0, cfg.body.shoulderBarY, 0);
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
    const armGeo = new THREE.CylinderGeometry(
      cfg.limbs.upperArmRadiusTop, cfg.limbs.upperArmRadiusBottom, cfg.limbs.upperArmLength, 4,
    );
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
    const forearmGeo = new THREE.CylinderGeometry(
      cfg.limbs.forearmRadiusTop, cfg.limbs.forearmRadiusBottom, cfg.limbs.forearmLength, 4,
    );
    const forearmLeft = new THREE.Mesh(forearmGeo, skinMat);
    forearmLeft.position.set(0, -0.11, 0);
    forearmLeft.name = 'forearm-left';
    elbowLeft.add(forearmLeft);

    // ========== BEER (off-hand accessory) ==========
    // Every player gets a beer in their non-dribble (left) hand. It hides
    // while they're on the ground (knockdown = spilled beer), comes back
    // once they're upright. Also hidden during the `guard` stance so the
    // arms-up defensive pose doesn't look like they're waving a drink.
    const beerCanBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.16, 14),
      new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.75, roughness: 0.3 }),
    );
    const beerLabel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.057, 0.057, 0.08, 14),
      new THREE.MeshStandardMaterial({ color: 0xf59f2d }), // amber label
    );
    const beer = new THREE.Group();
    beer.add(beerCanBody);
    beer.add(beerLabel);
    // Sit the can just past the fist, popped out toward the viewer's side
    // so it reads even from the front default camera angle.
    beer.position.set(-0.06, -0.24, 0.08);
    beer.rotation.z = 0.25; // slight wrist cock outward
    beer.name = 'beer';
    elbowLeft.add(beer);

    const forearmRight = new THREE.Mesh(forearmGeo, skinMat);
    forearmRight.position.set(0, -0.11, 0);
    forearmRight.name = 'forearm-right';
    elbowRight.add(forearmRight);

    // ========== HIP/GROIN (bridges torso bottom to leg tops) ==========
    const hipGeo = new THREE.BoxGeometry(cfg.body.hipWidth, cfg.body.hipHeight, cfg.body.hipDepth);
    const hipMesh = new THREE.Mesh(hipGeo, jerseyMat); // same color as jersey
    hipMesh.position.set(0, cfg.body.hipMeshY, 0);
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
    const upperLegGeo = new THREE.CylinderGeometry(
      cfg.limbs.upperLegRadiusTop, cfg.limbs.upperLegRadiusBottom, cfg.limbs.upperLegLength, 5,
    );
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
    const lowerLegGeo = new THREE.CylinderGeometry(
      cfg.limbs.lowerLegRadiusTop, cfg.limbs.lowerLegRadiusBottom, cfg.limbs.lowerLegLength, 5,
    );
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
    const shoeGeo = new THREE.BoxGeometry(cfg.shoes.width, cfg.shoes.height, cfg.shoes.depth);
    const shoeMat = new THREE.MeshStandardMaterial({ color: cfg.shoes.color });
    const shoeLeft = new THREE.Mesh(shoeGeo, shoeMat);
    shoeLeft.position.set(0, cfg.shoes.offsetY, cfg.shoes.offsetZ);
    shoeLeft.name = 'shoe-left';
    ankleLeft.add(shoeLeft);

    const shoeRight = new THREE.Mesh(shoeGeo, shoeMat);
    shoeRight.position.set(0, cfg.shoes.offsetY, cfg.shoes.offsetZ);
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
    const h = playerConfig.hair;

    // Hair positions relative to neckGroup.
    // Head center at y=0.35, head top at ~0.63, eyes at y=0.39 z=0.24 (front).
    // Hair should sit ON TOP and BEHIND the head, never covering the eyes.
    switch (style) {
      case 'bald': {
        // No hair at all — return an empty group so the mesh anchor exists
        // but contributes nothing visible. Skin shows through.
        return new THREE.Group();
      }

      case 'receding': {
        // Horseshoe: three tufts placed at the sides and back of the head,
        // with the top crown and forehead bare. Each tuft is a flattened
        // sphere that clings to the head at ear-to-nape level.
        const group = new THREE.Group();
        const headR = playerConfig.head.radius;
        const tuftY = playerConfig.head.positionY - headR * 0.15; // just below ear level
        const ringR = headR * 0.9; // how far out from center
        const tuftGeo = new THREE.SphereGeometry(headR * 0.35, 8, 6);
        // Left side
        const tuftL = new THREE.Mesh(tuftGeo, hairMat);
        tuftL.position.set(-ringR, tuftY, 0);
        tuftL.scale.set(0.6, 0.7, 1.0); // hug the head — flat, tall-ish, front-back stretch
        group.add(tuftL);
        // Right side
        const tuftR = new THREE.Mesh(tuftGeo, hairMat);
        tuftR.position.set(ringR, tuftY, 0);
        tuftR.scale.set(0.6, 0.7, 1.0);
        group.add(tuftR);
        // Back (covers nape + crown-back)
        const tuftB = new THREE.Mesh(tuftGeo, hairMat);
        tuftB.position.set(0, tuftY + headR * 0.05, -ringR);
        tuftB.scale.set(1.4, 0.6, 0.6); // wide across the back
        group.add(tuftB);
        return group;
      }

      case 'flat-top': {
        const geo = new THREE.BoxGeometry(h.flatTopWidth, h.flatTopHeight, h.flatTopDepth);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, h.flatTopY, h.flatTopZ);
        return mesh;
      }

      case 'afro': {
        const geo = new THREE.SphereGeometry(h.afroRadius, 8, 6);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, h.afroY, h.afroZ);
        return mesh;
      }

      case 'mohawk': {
        const geo = new THREE.BoxGeometry(h.mohawkWidth, h.mohawkHeight, h.mohawkDepth);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, h.mohawkY, h.mohawkZ);
        return mesh;
      }

      case 'headband': {
        const geo = new THREE.CylinderGeometry(h.headbandRadius, h.headbandRadius, h.headbandThickness, 16, 1, true);
        const mat = new THREE.MeshStandardMaterial({ color: h.headbandColor, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, h.headbandY, 0);
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

    // Guard timer
    if (this.isGuarding) {
      this.guardTimer -= dt;
      if (this.guardTimer <= 0) {
        this.isGuarding = false;
        this.guardTimer = 0;
        // Hide block-screen mesh if it exists
        const blockScreen = this.group.getObjectByName('block-screen');
        if (blockScreen) blockScreen.visible = false;
      }
    }

    // Clear blocking flag on landing
    if (this.isBlocking && !this.isJumping) {
      this.isBlocking = false;
    }

    // Determine animation state (forced state overrides auto-detection)
    if (this.forcedAnimState) {
      this.animState = this.forcedAnimState as typeof this.animState;
      // Still tick timers even when forced
      if (this.stealTimer > 0) this.stealTimer -= dt;
      if (this.shootTimer > 0) this.shootTimer -= dt;
      if (this.fallTimer > 0) this.fallTimer -= dt;
      if (this.dunkTimer > 0) this.dunkTimer -= dt;
      if (this.passTimer > 0) this.passTimer -= dt;
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
    } else if (this.passTimer > 0) {
      this.animState = 'pass';
      this.passTimer -= dt;
    } else if (this.hasBall && isMoving && this.isSprinting) {
      this.animState = 'dribble-sprint';
    } else if (this.hasBall) {
      this.animState = 'dribble';
    } else if (isMoving && this.isSprinting) {
      this.animState = 'sprint';
    } else if (isMoving) {
      this.animState = 'walk';
    } else if (this.isGuarding) {
      this.animState = 'guard';
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
      ring.visible = this.isHumanControlled;
      if (this.hasBall) {
        const pulse = 1 + Math.sin(this.animTime * animConfig.durations.possessionRingPulse) * 0.15;
        ring.scale.set(pulse, 1, pulse);
      }
    }

    // Player indicator bob
    const indicator = this.group.getObjectByName('player-indicator');
    if (indicator) {
      indicator.visible = this.isHumanControlled;
      if (this.isHumanControlled) {
        indicator.position.y = 2.25 + Math.sin(this.animTime * animConfig.durations.indicatorBob) * 0.08;
      }
    }

    // Beer visibility — spills on knockdown (fall), hidden during guard
    // (arms-up pose would have the beer up in the air, awkward).
    const beer = this.group.getObjectByName('beer');
    if (beer) {
      beer.visible = this.fallTimer <= 0 && !this.isGuarding;
    }

    if (isMoving) {
      const facingDir = new THREE.Vector3(0, 0, 1);
      facingDir.applyQuaternion(this.group.quaternion);
      facingDir.y = 0;
      facingDir.normalize();
      const moveDir = this.velocity.clone();
      moveDir.y = 0;
      moveDir.normalize();
      const dot = facingDir.dot(moveDir);
      // Hysteresis: once true, require dot > -0.1 to clear; once false,
      // require dot < -0.5 to set. Keeps the walk-anim branch stable when
      // facing wobbles (e.g. AI smooth-lerp while moving).
      if (this.isMovingBackwards) {
        if (dot > -0.1) this.isMovingBackwards = false;
      } else {
        if (dot < -0.5) this.isMovingBackwards = true;
      }
    } else {
      this.isMovingBackwards = false;
    }
    const isMovingBackwards = this.isMovingBackwards;

    switch (this.animState) {
      case 'idle': {
        // Gentle breathing/sway
        const p = animConfig.poses.idle;
        bodyPivot.rotation.x = p.bodyPivotRotX;
        bodyPivot.scale.set(1, 1, 1);
        hipL.rotation.x = p.hipLRotX;
        hipR.rotation.x = p.hipRRotX;
        kneeL.rotation.x = p.kneeLRotX;
        kneeR.rotation.x = p.kneeRRotX;
        shoulderL.rotation.x = p.shoulderLRotX;
        shoulderR.rotation.x = p.shoulderRRotX;
        elbowL.rotation.x = p.elbowLRotX;
        elbowR.rotation.x = p.elbowRRotX;
        // Gentle idle bob
        this.group.position.y = Math.sin(this.animTime * animConfig.durations.idleBob) * animConfig.amplitudes.idle.swayHeight;
        break;
      }

      case 'walk': {
        if (isMovingBackwards) {
          // BACKWARDS SHUFFLE: slower, shorter strides, defensive stance
          const t = this.animTime * animConfig.durations.backwardStride;
          const bounceT = this.animTime * animConfig.durations.backwardBounce;
          const bouncePhase = (Math.sin(bounceT) + 1) / 2;
          this.group.position.y = Math.pow(bouncePhase, 0.6) * animConfig.amplitudes.walkBackward.bounceHeight;

          const pb = animConfig.poses.walkBackward;
          bodyPivot.rotation.x = pb.bodyPivotRotX;
          bodyPivot.scale.set(1, 1, 1);

          const strideRaw = Math.sin(t);
          const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * animConfig.amplitudes.walkBackward.strideAmp;

          hipL.rotation.x = -stride;
          hipR.rotation.x = stride;
          kneeL.rotation.x = animConfig.amplitudes.walkBackward.kneeBase + Math.max(0, stride) * animConfig.amplitudes.walkBackward.kneeSwing;
          kneeR.rotation.x = animConfig.amplitudes.walkBackward.kneeBase + Math.max(0, -stride) * animConfig.amplitudes.walkBackward.kneeSwing;

          // Arms in defensive ready position
          shoulderL.rotation.x = pb.shoulderLRotX;
          shoulderL.rotation.z = pb.shoulderLRotZ;
          shoulderR.rotation.x = pb.shoulderRRotX;
          shoulderR.rotation.z = pb.shoulderRRotZ;
          elbowL.rotation.x = pb.elbowLRotX;
          elbowR.rotation.x = pb.elbowRRotX;
          break;
        }

        // Bouncy stride — faster pace, subtler bounce
        const t = this.animTime * animConfig.durations.walkStride;
        const bounceT = this.animTime * animConfig.durations.walkBounce;
        const bouncePhase = (Math.sin(bounceT) + 1) / 2;
        this.group.position.y = Math.pow(bouncePhase, 0.6) * animConfig.amplitudes.walk.bounceHeight;

        // Squash-stretch on body pivot
        const pw = animConfig.poses.walk;
        const squashStretch = bouncePhase; // 0 = ground contact, 1 = peak
        bodyPivot.scale.set(
          1 + (1 - squashStretch) * pw.squashStretchAmount,   // wider at ground
          1 - (1 - squashStretch) * pw.squashStretchAmount + squashStretch * pw.squashStretchAmount, // shorter at ground, taller at peak
          1 + (1 - squashStretch) * pw.squashStretchAmount    // wider at ground
        );

        // Forward lean
        bodyPivot.rotation.x = pw.bodyPivotRotX;

        // Leg stride — floaty power curve
        const strideRaw = Math.sin(t);
        const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * animConfig.amplitudes.walk.strideAmp;

        hipL.rotation.x = -stride; // negative = forward swing
        hipR.rotation.x = stride;

        // Knee bend: more when leg is back (pushing off)
        kneeL.rotation.x = animConfig.amplitudes.walk.kneeBase + Math.max(0, stride) * animConfig.amplitudes.walk.kneeSwing;
        kneeR.rotation.x = animConfig.amplitudes.walk.kneeBase + Math.max(0, -stride) * animConfig.amplitudes.walk.kneeSwing;

        // Arms swing opposite to their OPPOSITE legs
        shoulderL.rotation.x = stride * animConfig.amplitudes.walk.armSwingRatio;
        shoulderR.rotation.x = -stride * animConfig.amplitudes.walk.armSwingRatio;
        elbowL.rotation.x = -animConfig.amplitudes.walk.elbowBend - Math.max(0, stride) * animConfig.amplitudes.walk.elbowBend;
        elbowR.rotation.x = -animConfig.amplitudes.walk.elbowBend - Math.max(0, -stride) * animConfig.amplitudes.walk.elbowBend;

        // Torso/hip counter-rotation for natural walk
        const torso = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torso && hipMeshNode) {
          // Hips twist WITH the leading leg, torso twists OPPOSITE
          hipMeshNode.rotation.y = stride * animConfig.amplitudes.walk.hipTwist;
          torso.rotation.y = -stride * animConfig.amplitudes.walk.torsoTwist;
        }
        break;
      }

      case 'dribble': {
        const t = this.animTime * animConfig.durations.walkStride; // match walk speed

        // Compute dribble phase (0-1 cycle) — same speed for all modes
        const dribbleSpeed = animConfig.durations.dribbleCycle; // Hz — cycles per second
        this.dribblePhase = (this.animTime * dribbleSpeed) % 1;

        // Arm synced with ball phase
        const armPhase = (this.dribblePhase + 0.75) % 1;
        let elbowBend: number;
        let shoulderPump: number;
        if (armPhase < 0.45) {
          // Arm up — ball in hand
          elbowBend = -0.5;
          shoulderPump = -0.2; // shoulder back (arm up/back)
        } else if (armPhase < 0.6) {
          // Arm pushes down — ball releasing
          const t = (armPhase - 0.45) / 0.15;
          elbowBend = -0.5 - t * 0.6; // -0.5 to -1.1
          shoulderPump = -0.2 - t * 0.4; // -0.2 to -0.6
        } else if (armPhase < 0.8) {
          // Arm at bottom — ball at floor
          elbowBend = -1.1;
          shoulderPump = -0.6; // shoulder most forward (arm reaching down)
        } else {
          // Arm returns up — ball rising
          const t = (armPhase - 0.8) / 0.2;
          elbowBend = -1.1 + t * 0.6; // -1.1 to -0.5
          shoulderPump = -0.6 + t * 0.4; // -0.6 to -0.2
        }

        const pd = animConfig.poses.dribble;
        const pds = animConfig.poses.dribbleStationary;
        if (this.velocity.lengthSq() > 0.01) {
          // Moving with ball — walk legs + phase-based dribble arm
          const bounceT = this.animTime * animConfig.durations.walkBounce; // match walk double-bounce
          const bouncePhase = (Math.sin(bounceT) + 1) / 2;
          this.group.position.y = Math.pow(bouncePhase, 0.6) * animConfig.amplitudes.dribble.bounceHeight;

          // Squash-stretch on body pivot (subtle)
          const squashStretch = bouncePhase;
          bodyPivot.scale.set(
            1 + (1 - squashStretch) * pd.squashStretchAmount,
            1 - (1 - squashStretch) * pd.squashStretchAmount + squashStretch * pd.squashStretchAmount,
            1 + (1 - squashStretch) * pd.squashStretchAmount
          );

          bodyPivot.rotation.x = pd.bodyPivotRotX;

          const strideRaw = Math.sin(t);
          const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * animConfig.amplitudes.dribble.strideAmp;
          hipL.rotation.x = -stride;
          hipR.rotation.x = stride;
          kneeL.rotation.x = animConfig.amplitudes.dribble.kneeBase + Math.max(0, stride) * animConfig.amplitudes.dribble.kneeSwing;
          kneeR.rotation.x = animConfig.amplitudes.dribble.kneeBase + Math.max(0, -stride) * animConfig.amplitudes.dribble.kneeSwing;

          // Dribble arm (right): phase-based with shoulder pump
          shoulderR.rotation.x = shoulderPump;
          elbowR.rotation.x = elbowBend;

          // Torso/hip counter-rotation for natural walk
          const torso = this.group.getObjectByName('torso');
          const hipMeshNode = this.group.getObjectByName('hip-mesh');
          if (torso && hipMeshNode) {
            hipMeshNode.rotation.y = stride * pd.hipTwistFactor;
            torso.rotation.y = -stride * pd.torsoTwistFactor;
          }
        } else {
          // Stationary dribble
          this.group.position.y = Math.sin(this.animTime * animConfig.durations.idleBob) * animConfig.amplitudes.idle.swayHeight;
          bodyPivot.scale.set(1, 1, 1);
          bodyPivot.rotation.x = pds.bodyPivotRotX;
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
          kneeL.rotation.x = pds.kneeBase;
          kneeR.rotation.x = pds.kneeBase;

          // Dribble arm (right): phase-based with shoulder pump
          shoulderR.rotation.x = shoulderPump;
          elbowR.rotation.x = elbowBend;
        }

        // Balance arm (left): OUT to the side, not tucked in
        // LEFT shoulder: NEGATIVE rotation.z = arm goes OUTWARD (away from body)
        shoulderL.rotation.x = pd.leftArmShoulderX;
        shoulderL.rotation.z = pd.leftArmShoulderZ;
        elbowL.rotation.x = pd.leftArmElbow;
        break;
      }

      case 'guard': {
        // Low defensive stance with arms UP HIGH to block
        const pg = animConfig.poses.guard;
        bodyPivot.scale.set(1, 1, 1);
        bodyPivot.rotation.x = pg.bodyPivotRotX;
        hipL.rotation.x = pg.hipLRotX;
        hipR.rotation.x = pg.hipRRotX;
        kneeL.rotation.x = pg.kneeLRotX;
        kneeR.rotation.x = pg.kneeRRotX;

        // Arms STRAIGHT UP to block — maximum reach
        shoulderL.rotation.x = pg.shoulderLRotX;
        shoulderL.rotation.z = pg.shoulderLRotZ;
        shoulderR.rotation.x = pg.shoulderRRotX;
        shoulderR.rotation.z = pg.shoulderRRotZ;
        elbowL.rotation.x = pg.elbowLRotX;
        elbowR.rotation.x = pg.elbowRRotX;

        this.group.position.y = pg.stanceDropY;

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
        screenMat.opacity = animConfig.amplitudes.guard.blockOpacityMin + Math.sin(this.animTime * animConfig.durations.guardPulse) * animConfig.amplitudes.guard.blockOpacitySwing;
        break;
      }

      case 'steal': {
        // SIDE SWIPE: arm pulls back to side, pauses, quick sweep across
        // Now with guard-like crouch throughout
        const stealDuration = animConfig.durations.stealDuration;
        const progress = 1 - (this.stealTimer / stealDuration);

        // Phase 1 (0-0.2): Wind back — arm pulls to the right side
        // Phase 2 (0.2-0.55): Pause — held back, arm grows, anticipation
        // Phase 3 (0.55-0.85): Quick swipe — arm sweeps across low
        // Phase 4 (0.85-1.0): Recovery

        const forearmR = this.group.getObjectByName('forearm-right');
        let forearmScale = 1;

        const pst = animConfig.poses.steal;
        // Lower stance like guard
        this.group.position.y = pst.stanceDropY;

        if (progress < 0.2) {
          const wind = progress / 0.2;
          bodyPivot.rotation.x = pst.windBodyPivotRotX;
          shoulderR.rotation.x = pst.windShoulderRRotX * wind;
          shoulderR.rotation.z = pst.windShoulderRRotZ * wind;
          elbowR.rotation.x = pst.windElbowRRotX * wind;
          forearmScale = 1 + wind * 0.4;
          bodyPivot.rotation.y = pst.windBodyRotY * wind;
          bodyPivot.scale.set(pst.windSquashX, pst.windSquashY, pst.windSquashX);
        } else if (progress < 0.55) {
          // HOLD: cocked back, big forearm, dramatic pause
          bodyPivot.rotation.x = pst.holdBodyPivotRotX;
          shoulderR.rotation.x = pst.holdShoulderRRotX;
          shoulderR.rotation.z = pst.holdShoulderRRotZ;
          elbowR.rotation.x = pst.holdElbowRRotX;
          forearmScale = 1.6;
          bodyPivot.rotation.y = pst.holdBodyRotY;
          bodyPivot.scale.set(pst.holdSquashX, pst.holdSquashY, pst.holdSquashX);
        } else if (progress < 0.85) {
          // SWIPE: quick sweep from right to left, low
          bodyPivot.rotation.x = pst.swipeBodyPivotRotX;
          const swipe = (progress - 0.55) / 0.3;
          shoulderR.rotation.x = pst.swipeShoulderRXBase + swipe * pst.swipeShoulderRXSwing;
          shoulderR.rotation.z = pst.swipeShoulderRZBase + swipe * pst.swipeShoulderRZSwing;
          elbowR.rotation.x = pst.swipeElbowRXBase + swipe * pst.swipeElbowRXSwing;
          forearmScale = 1.6 - swipe * 0.4;
          bodyPivot.rotation.y = pst.swipeBodyRotYBase + swipe * pst.swipeBodyRotYSwing;
          // Stretch horizontally as the arm sweeps
          const stretchX = 1.06 - swipe * 0.06 + Math.sin(swipe * Math.PI) * 0.1;
          const squashY = 0.94 + swipe * 0.06 - Math.sin(swipe * Math.PI) * 0.08;
          bodyPivot.scale.set(stretchX, squashY, 1);
        } else {
          // Recovery
          const recover = (progress - 0.85) / 0.15;
          bodyPivot.rotation.x = pst.holdBodyPivotRotX * (1 - recover);
          shoulderR.rotation.x = -0.6 + recover * 0.6;
          shoulderR.rotation.z = -0.8 + recover * 0.8;
          elbowR.rotation.x = -0.2 + recover * 0.1;
          forearmScale = 1.2 - recover * 0.2;
          bodyPivot.rotation.y = -0.3 + recover * 0.3;
          bodyPivot.scale.set(
            1 + (1 - recover) * 0.04,
            1 - (1 - recover) * 0.04,
            1
          );
          this.group.position.y = pst.stanceDropY * (1 - recover);
        }

        if (forearmR) {
          forearmR.scale.set(forearmScale, forearmScale, forearmScale);
          if (this.stealTimer <= 0) forearmR.scale.set(1, 1, 1);
        }

        // Left arm relaxed at side
        shoulderL.rotation.x = pst.shoulderLRotX;
        elbowL.rotation.x = pst.elbowLRotX;

        // Deep crouched stance like guard
        hipL.rotation.x = pst.hipLRotX;
        hipR.rotation.x = pst.hipRRotX;
        kneeL.rotation.x = pst.kneeLRotX;
        kneeR.rotation.x = pst.kneeRRotX;
        break;
      }

      case 'shoot': {
        // Basketball shot: snap ball up to shooting position, release, arms back down
        // Phase 1 (0-0.15): Snap hands up together — ball in right hand (back), left guides (side)
        // Phase 2 (0.15-0.4): Quick release — right arm extends up, left peels away
        // Phase 3 (0.4-1.0): Follow through and arms back down
        bodyPivot.scale.set(1, 1, 1);
        const shootDuration = animConfig.durations.shootDuration;
        const progress = 1 - (this.shootTimer / shootDuration); // 0 to 1

        const psh = animConfig.poses.shoot;
        const hopHeight = animConfig.amplitudes.shoot.hopHeight;
        // Slight hop during shot — quick up, brief hang, land
        let shootHeight: number;
        if (progress < 0.15) {
          shootHeight = 0;
        } else if (progress < 0.25) {
          const rise = (progress - 0.15) / 0.1;
          shootHeight = rise * hopHeight;
        } else if (progress < 0.4) {
          shootHeight = hopHeight;
        } else if (progress < 0.55) {
          const descend = (progress - 0.4) / 0.15;
          shootHeight = hopHeight * (1 - descend);
        } else {
          shootHeight = 0;
        }
        this.group.position.y = shootHeight;

        if (progress < 0.15) {
          // SNAP: hands come up together to shooting position
          const snap = progress / 0.15;
          shoulderR.rotation.x = psh.snapShoulderR * snap;
          shoulderR.rotation.z = psh.snapShoulderRZ * snap;
          elbowR.rotation.x = psh.snapElbowR * snap;
          shoulderL.rotation.x = psh.snapShoulderL * snap;
          shoulderL.rotation.z = psh.snapShoulderLZ * snap;
          elbowL.rotation.x = psh.snapElbowL * snap;
          bodyPivot.rotation.x = psh.snapBodyPivotRotX;
          kneeL.rotation.x = psh.snapKneeBend * (progress / 0.15);
          kneeR.rotation.x = psh.snapKneeBend * (progress / 0.15);
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
        } else if (progress < 0.25) {
          // RISE: arms continue, legs extend
          const rise = (progress - 0.15) / 0.1;
          const subRelease = (progress - 0.15) / 0.25;
          shoulderR.rotation.x = psh.snapShoulderR - subRelease * 0.8;
          shoulderR.rotation.z = psh.snapShoulderRZ;
          elbowR.rotation.x = psh.snapElbowR + subRelease * 1.0;
          shoulderL.rotation.x = psh.snapShoulderL + subRelease * 1.0;
          shoulderL.rotation.z = psh.snapShoulderLZ - subRelease * 0.3;
          elbowL.rotation.x = psh.snapElbowL + subRelease * 0.5;
          bodyPivot.rotation.x = psh.snapBodyPivotRotX - subRelease * 0.15;
          kneeL.rotation.x = psh.snapKneeBend * (1 - rise);
          kneeR.rotation.x = psh.snapKneeBend * (1 - rise);
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
        } else if (progress < 0.4) {
          // HANG TIME + RELEASE: right arm extends up, left peels away
          const subRelease = (progress - 0.15) / 0.25;
          shoulderR.rotation.x = psh.snapShoulderR - subRelease * 0.8;
          shoulderR.rotation.z = psh.snapShoulderRZ;
          elbowR.rotation.x = psh.snapElbowR + subRelease * 1.0;
          shoulderL.rotation.x = psh.snapShoulderL + subRelease * 1.0;
          shoulderL.rotation.z = psh.snapShoulderLZ - subRelease * 0.3;
          elbowL.rotation.x = psh.snapElbowL + subRelease * 0.5;
          bodyPivot.rotation.x = psh.snapBodyPivotRotX - subRelease * 0.15;
          kneeL.rotation.x = psh.hangKnee;
          kneeR.rotation.x = psh.hangKnee;
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
        } else if (progress < 0.55) {
          // COMING DOWN: start recovery
          const descend = (progress - 0.4) / 0.15;
          const recover = (progress - 0.4) / 0.6;
          shoulderR.rotation.x = psh.releaseShoulderR + recover * 2.6;
          shoulderR.rotation.z = psh.snapShoulderRZ * (1 - recover);
          elbowR.rotation.x = psh.releaseElbowR + recover * 0.1;
          shoulderL.rotation.x = psh.releaseShoulderL + recover * 0.6;
          shoulderL.rotation.z = psh.releaseShoulderLZ + recover * 0.6;
          elbowL.rotation.x = psh.releaseElbowL + recover * 0.2;
          bodyPivot.rotation.x = psh.releaseBodyPivotRotX + recover * 0.1;
          const land = descend;
          hipR.rotation.x = psh.landHipR * land;
          hipL.rotation.x = psh.landHipL * land;
          kneeR.rotation.x = psh.landKneeR * land;
          kneeL.rotation.x = psh.landKneeL * land;
        } else {
          // RECOVER: on ground, arms come back down to sides
          const recover = (progress - 0.4) / 0.6;
          shoulderR.rotation.x = psh.releaseShoulderR + recover * 2.6;
          shoulderR.rotation.z = psh.snapShoulderRZ * (1 - recover);
          elbowR.rotation.x = psh.releaseElbowR + recover * 0.1;
          shoulderL.rotation.x = psh.releaseShoulderL + recover * 0.6;
          shoulderL.rotation.z = psh.releaseShoulderLZ + recover * 0.6;
          elbowL.rotation.x = psh.releaseElbowL + recover * 0.2;
          bodyPivot.rotation.x = psh.releaseBodyPivotRotX + recover * 0.1;
          if (progress >= 0.55) {
            const land = (progress - 0.55) / 0.45;
            hipR.rotation.x = psh.recoverHipR;
            hipL.rotation.x = psh.recoverHipL;
            kneeR.rotation.x = psh.recoverKneeR * (1 - land * 0.7);
            kneeL.rotation.x = psh.recoverKneeL * (1 - land * 0.5);
          } else {
            hipR.rotation.x = psh.landHipR;
            hipL.rotation.x = psh.landHipL;
            kneeR.rotation.x = psh.landKneeR;
            kneeL.rotation.x = psh.landKneeL;
          }
        }

        // Torso/hip twist during shot
        const torsoNode = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torsoNode && hipMeshNode) {
          if (progress < 0.15) {
            const snap = progress / 0.15;
            hipMeshNode.rotation.y = psh.hipTwistSnap * snap;
            torsoNode.rotation.y = psh.torsoTwistSnap * snap;
          } else if (progress < 0.4) {
            const release = (progress - 0.15) / 0.25;
            hipMeshNode.rotation.y = psh.hipTwistSnap + release * psh.hipTwistRelease;
            torsoNode.rotation.y = psh.torsoTwistSnap + release * psh.torsoTwistRelease;
          } else {
            const recover = (progress - 0.4) / 0.6;
            hipMeshNode.rotation.y = -psh.hipTwistSnap * (1 - recover);
            torsoNode.rotation.y = -psh.torsoTwistSnap * (1 - recover);
          }
        }
        break;
      }

      case 'jump': {
        bodyPivot.scale.set(1, 1, 1);
        this.jumpTimer -= dt;
        const jumpDuration = animConfig.durations.jumpDuration;
        const progress = 1 - (this.jumpTimer / jumpDuration);

        // Parabolic height
        this.jumpHeight = Math.sin(progress * Math.PI) * animConfig.amplitudes.jump.apexHeight;
        this.group.position.y = this.jumpHeight;

        const pj = animConfig.poses.jump;
        if (progress < 0.15) {
          // WIND-UP: deep crouch, arms pull down gathering energy
          const crouch = progress / 0.15;
          bodyPivot.rotation.x = pj.crouchBodyPivotRotX * crouch;
          kneeL.rotation.x = pj.crouchKnee * crouch;
          kneeR.rotation.x = pj.crouchKnee * crouch;
          hipL.rotation.x = pj.crouchHip * crouch;
          hipR.rotation.x = pj.crouchHip * crouch;
          shoulderL.rotation.x = pj.crouchShoulder * crouch;
          shoulderR.rotation.x = pj.crouchShoulder * crouch;
          elbowL.rotation.x = pj.crouchElbow * crouch;
          elbowR.rotation.x = pj.crouchElbow * crouch;
        } else if (progress < 0.3) {
          // LAUNCH: explosive extension
          const launch = (progress - 0.15) / 0.15;
          bodyPivot.rotation.x = pj.crouchBodyPivotRotX - launch * 0.35;
          kneeL.rotation.x = pj.crouchKnee * (1 - launch);
          kneeR.rotation.x = pj.crouchKnee * (1 - launch);
          hipL.rotation.x = pj.crouchHip * (1 - launch);
          hipR.rotation.x = pj.crouchHip * (1 - launch);
          shoulderR.rotation.x = pj.crouchShoulder - launch * pj.launchShoulderR;
          elbowR.rotation.x = pj.crouchElbow + launch * pj.launchElbowRDelta;
          shoulderL.rotation.x = pj.crouchShoulder - launch * pj.launchShoulderL;
          shoulderL.rotation.z = -launch * pj.launchShoulderLZ;
          elbowL.rotation.x = pj.crouchElbow + launch * pj.launchElbowLDelta;
        } else if (progress < 0.7) {
          // HANG TIME: peak — iconic basketball pose
          bodyPivot.rotation.x = pj.hangBodyPivotRotX;
          kneeL.rotation.x = pj.hangKneeL;
          kneeR.rotation.x = pj.hangKneeR;
          hipL.rotation.x = pj.hangHipL;
          hipR.rotation.x = pj.hangHipR;
          shoulderR.rotation.x = pj.hangShoulderR;
          elbowR.rotation.x = pj.hangElbowR;
          shoulderL.rotation.x = pj.hangShoulderL;
          shoulderL.rotation.z = pj.hangShoulderLZ;
          elbowL.rotation.x = pj.hangElbowL;
        } else if (progress < 0.85) {
          // DESCENT: start tucking
          const tuck = (progress - 0.7) / 0.15;
          bodyPivot.rotation.x = pj.hangBodyPivotRotX + tuck * pj.descentBodyLeanDelta;
          shoulderR.rotation.x = pj.hangShoulderR + tuck * pj.descentShoulderRDelta;
          elbowR.rotation.x = pj.hangElbowR - tuck * 0.2;
          shoulderL.rotation.x = pj.hangShoulderL + tuck * 0.3;
          shoulderL.rotation.z = pj.hangShoulderLZ + tuck * 0.3;
          elbowL.rotation.x = pj.hangElbowL;
          kneeL.rotation.x = pj.hangKneeL + tuck * pj.descentKneeDelta;
          kneeR.rotation.x = pj.hangKneeR + tuck * pj.descentKneeDelta;
          hipL.rotation.x = pj.hangHipL + tuck * 0.1;
          hipR.rotation.x = pj.hangHipR - tuck * 0.1;
        } else {
          // LAND: deep absorb
          const land = (progress - 0.85) / 0.15;
          bodyPivot.rotation.x = pj.landBodyPivotRotX + land * 0.15;
          kneeL.rotation.x = pj.landKneeLBase + land * 0.4;
          kneeR.rotation.x = pj.landKneeRBase + land * 0.4;
          hipL.rotation.x = pj.landHipL;
          hipR.rotation.x = pj.landHipR;
          shoulderR.rotation.x = pj.landShoulderR + land * 1.1;
          shoulderL.rotation.x = pj.landShoulderL + land * 0.1;
          elbowR.rotation.x = pj.landElbowR + land * 0.2;
          elbowL.rotation.x = pj.landElbowL + land * 0.1;
          shoulderL.rotation.z = 0;
        }

        // Torso/hip twist during jump
        {
          const torsoNode = this.group.getObjectByName('torso');
          const hipMeshNode = this.group.getObjectByName('hip-mesh');
          if (torsoNode && hipMeshNode) {
            if (progress < 0.3) {
              // Launch — twist from crouch
              const launch = progress / 0.3;
              hipMeshNode.rotation.y = pj.hipTwistLaunch * launch;
              torsoNode.rotation.y = pj.torsoTwistLaunch * launch;
            } else if (progress < 0.7) {
              // Hang — slight twist held
              hipMeshNode.rotation.y = pj.hipTwistLaunch;
              torsoNode.rotation.y = pj.torsoTwistLaunch;
            } else {
              // Land — untwist
              const land = (progress - 0.7) / 0.3;
              hipMeshNode.rotation.y = pj.hipTwistLaunch * (1 - land);
              torsoNode.rotation.y = pj.torsoTwistLaunch * (1 - land);
            }
          }
        }

        if (this.jumpTimer <= 0) {
          this.isJumping = false;
          this.jumpTimer = 0;
          this.group.position.y = 0;
        }
        break;
      }

      case 'sprint': {
        const t = this.animTime * animConfig.durations.sprintStride;
        const bounceT = this.animTime * animConfig.durations.sprintBounce;
        const bouncePhase = (Math.sin(bounceT) + 1) / 2;
        this.group.position.y = Math.pow(bouncePhase, 0.6) * animConfig.amplitudes.sprint.bounceHeight;

        const ps = animConfig.poses.sprint;
        const squashStretch = bouncePhase;
        bodyPivot.scale.set(
          1 + (1 - squashStretch) * ps.squashStretchAmount,
          1 - (1 - squashStretch) * ps.squashStretchAmount + squashStretch * ps.squashStretchAmount,
          1 + (1 - squashStretch) * ps.squashStretchAmount
        );

        bodyPivot.rotation.x = ps.bodyPivotRotX;

        const strideRaw = Math.sin(t);
        const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * animConfig.amplitudes.sprint.strideAmp;

        hipL.rotation.x = -stride;
        hipR.rotation.x = stride;
        kneeL.rotation.x = animConfig.amplitudes.sprint.kneeBase + Math.max(0, stride) * animConfig.amplitudes.sprint.kneeDrive;
        kneeR.rotation.x = animConfig.amplitudes.sprint.kneeBase + Math.max(0, -stride) * animConfig.amplitudes.sprint.kneeDrive;

        // Arms pump hard — elbows tight, fists driving
        shoulderL.rotation.x = stride * animConfig.amplitudes.sprint.shoulderSwing;
        shoulderR.rotation.x = -stride * animConfig.amplitudes.sprint.shoulderSwing;
        elbowL.rotation.x = -animConfig.amplitudes.sprint.elbowBend;
        elbowR.rotation.x = -animConfig.amplitudes.sprint.elbowBend;

        const torso = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torso && hipMeshNode) {
          hipMeshNode.rotation.y = stride * animConfig.amplitudes.sprint.hipTwist;
          torso.rotation.y = -stride * animConfig.amplitudes.sprint.torsoTwist;
        }
        break;
      }

      case 'dribble-sprint': {
        const t = this.animTime * animConfig.durations.dribbleSprintStride;
        const bounceT = this.animTime * animConfig.durations.dribbleSprintBounce;
        const bouncePhase = (Math.sin(bounceT) + 1) / 2;
        this.group.position.y = Math.pow(bouncePhase, 0.6) * animConfig.amplitudes.dribbleSprint.bounceHeight;

        const pds2 = animConfig.poses.dribbleSprint;
        const squashStretch = bouncePhase;
        bodyPivot.scale.set(
          1 + (1 - squashStretch) * pds2.squashStretchAmount,
          1 - (1 - squashStretch) * pds2.squashStretchAmount + squashStretch * pds2.squashStretchAmount,
          1 + (1 - squashStretch) * pds2.squashStretchAmount
        );

        bodyPivot.rotation.x = pds2.bodyPivotRotX;

        const strideRaw = Math.sin(t);
        const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * animConfig.amplitudes.dribbleSprint.strideAmp;

        hipL.rotation.x = -stride;
        hipR.rotation.x = stride;
        kneeL.rotation.x = animConfig.amplitudes.dribbleSprint.kneeBase + Math.max(0, stride) * animConfig.amplitudes.dribbleSprint.kneeSwing;
        kneeR.rotation.x = animConfig.amplitudes.dribbleSprint.kneeBase + Math.max(0, -stride) * animConfig.amplitudes.dribbleSprint.kneeSwing;

        // Compute dribble phase (0-1 cycle) — same speed as all dribble modes
        const dribbleSpeed = animConfig.durations.dribbleCycle; // Hz — cycles per second
        this.dribblePhase = (this.animTime * dribbleSpeed) % 1;

        // Arm synced with ball phase
        const armPhase = (this.dribblePhase + 0.75) % 1;
        let elbowBend: number;
        let shoulderPump: number;
        if (armPhase < 0.45) {
          // Arm up — ball in hand
          elbowBend = -0.5;
          shoulderPump = -0.2; // shoulder back (arm up/back)
        } else if (armPhase < 0.6) {
          // Arm pushes down — ball releasing
          const t = (armPhase - 0.45) / 0.15;
          elbowBend = -0.5 - t * 0.6; // -0.5 to -1.1
          shoulderPump = -0.2 - t * 0.4; // -0.2 to -0.6
        } else if (armPhase < 0.8) {
          // Arm at bottom — ball at floor
          elbowBend = -1.1;
          shoulderPump = -0.6; // shoulder most forward (arm reaching down)
        } else {
          // Arm returns up — ball rising
          const t = (armPhase - 0.8) / 0.2;
          elbowBend = -1.1 + t * 0.6; // -1.1 to -0.5
          shoulderPump = -0.6 + t * 0.4; // -0.6 to -0.2
        }

        // Right arm dribbles — phase-based with shoulder pump
        shoulderR.rotation.x = shoulderPump;
        elbowR.rotation.x = elbowBend;

        // Left arm pumps with stride
        shoulderL.rotation.x = stride * 0.5;
        shoulderL.rotation.z = pds2.leftArmShoulderZ;
        elbowL.rotation.x = pds2.leftArmElbow;

        const torso = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torso && hipMeshNode) {
          hipMeshNode.rotation.y = stride * pds2.hipTwistFactor;
          torso.rotation.y = -stride * pds2.torsoTwistFactor;
        }
        break;
      }

      case 'jump-block': {
        bodyPivot.scale.set(1, 1, 1);
        this.jumpTimer -= dt;
        const jumpDuration = animConfig.durations.jumpBlockDuration;
        const progress = 1 - (this.jumpTimer / jumpDuration);

        this.jumpHeight = Math.sin(progress * Math.PI) * animConfig.amplitudes.jumpBlock.apexHeight;
        this.group.position.y = this.jumpHeight;

        const pjb = animConfig.poses.jumpBlock;
        if (progress < 0.15) {
          // Crouch
          const crouch = progress / 0.15;
          bodyPivot.rotation.x = pjb.crouchBodyPivotRotX * crouch;
          kneeL.rotation.x = pjb.crouchKnee * crouch;
          kneeR.rotation.x = pjb.crouchKnee * crouch;
          hipL.rotation.x = pjb.crouchHip * crouch;
          hipR.rotation.x = pjb.crouchHip * crouch;
          shoulderL.rotation.x = pjb.crouchShoulder * crouch;
          shoulderR.rotation.x = pjb.crouchShoulder * crouch;
          elbowL.rotation.x = pjb.crouchElbow * crouch;
          elbowR.rotation.x = pjb.crouchElbow * crouch;
        } else if (progress < 0.3) {
          // Launch — BOTH arms shoot up
          const launch = (progress - 0.15) / 0.15;
          bodyPivot.rotation.x = pjb.crouchBodyPivotRotX - launch * 0.25;
          kneeL.rotation.x = pjb.crouchKnee * (1 - launch);
          kneeR.rotation.x = pjb.crouchKnee * (1 - launch);
          hipL.rotation.x = pjb.crouchHip * (1 - launch);
          hipR.rotation.x = pjb.crouchHip * (1 - launch);
          shoulderL.rotation.x = pjb.crouchShoulder - launch * pjb.launchShoulder;
          shoulderR.rotation.x = pjb.crouchShoulder - launch * pjb.launchShoulder;
          shoulderL.rotation.z = -launch * pjb.launchShoulderSpread;
          shoulderR.rotation.z = launch * pjb.launchShoulderSpread;
          elbowL.rotation.x = pjb.crouchElbow + launch * pjb.launchElbowDelta;
          elbowR.rotation.x = pjb.crouchElbow + launch * pjb.launchElbowDelta;
        } else if (progress < 0.7) {
          // Hang time — both arms up, wide spread like a wall
          bodyPivot.rotation.x = pjb.hangBodyPivotRotX;
          kneeL.rotation.x = pjb.hangKneeL;
          kneeR.rotation.x = pjb.hangKneeR;
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
          shoulderL.rotation.x = pjb.hangShoulderL;
          shoulderR.rotation.x = pjb.hangShoulderR;
          shoulderL.rotation.z = pjb.hangShoulderLZ;
          shoulderR.rotation.z = pjb.hangShoulderRZ;
          elbowL.rotation.x = pjb.hangElbowL;
          elbowR.rotation.x = pjb.hangElbowR;
        } else {
          // Land
          const land = (progress - 0.7) / 0.3;
          bodyPivot.rotation.x = pjb.hangBodyPivotRotX + land * 0.15;
          kneeL.rotation.x = pjb.hangKneeL + land * 0.5;
          kneeR.rotation.x = pjb.hangKneeR + land * 0.5;
          shoulderL.rotation.x = pjb.hangShoulderL + land * 2.6;
          shoulderR.rotation.x = pjb.hangShoulderR + land * 2.6;
          shoulderL.rotation.z = pjb.hangShoulderLZ + land * 0.4;
          shoulderR.rotation.z = pjb.hangShoulderRZ - land * 0.4;
          elbowL.rotation.x = pjb.hangElbowL;
          elbowR.rotation.x = pjb.hangElbowR;
        }

        // Torso/hip twist during jump-block (same as jump)
        {
          const torsoNode = this.group.getObjectByName('torso');
          const hipMeshNode = this.group.getObjectByName('hip-mesh');
          if (torsoNode && hipMeshNode) {
            if (progress < 0.3) {
              const launch = progress / 0.3;
              hipMeshNode.rotation.y = pjb.hipTwistLaunch * launch;
              torsoNode.rotation.y = pjb.torsoTwistLaunch * launch;
            } else if (progress < 0.7) {
              hipMeshNode.rotation.y = pjb.hipTwistLaunch;
              torsoNode.rotation.y = pjb.torsoTwistLaunch;
            } else {
              const land = (progress - 0.7) / 0.3;
              hipMeshNode.rotation.y = pjb.hipTwistLaunch * (1 - land);
              torsoNode.rotation.y = pjb.torsoTwistLaunch * (1 - land);
            }
          }
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
        const fallDuration = animConfig.durations.fallDuration;
        const progress = 1 - (this.fallTimer / fallDuration);

        const pf = animConfig.poses.fall;
        if (progress < 0.4) {
          // Stagger back
          const stagger = progress / 0.4;
          bodyPivot.rotation.x = pf.staggerBodyPivotRotX * stagger;
          bodyPivot.rotation.z = pf.staggerBodyPivotRotZ * stagger;
          this.group.position.y = 0;
          // Arms flail
          shoulderL.rotation.x = pf.staggerShoulderLRotX * stagger;
          shoulderL.rotation.z = pf.staggerShoulderLRotZ * stagger;
          shoulderR.rotation.x = pf.staggerShoulderRRotX * stagger;
          shoulderR.rotation.z = pf.staggerShoulderRRotZ * stagger;
          elbowL.rotation.x = pf.staggerElbowL;
          elbowR.rotation.x = pf.staggerElbowR;
          // Legs buckle
          kneeL.rotation.x = pf.staggerKneeL * stagger;
          kneeR.rotation.x = pf.staggerKneeR * stagger;
          hipL.rotation.x = pf.staggerHipL * stagger;
          hipR.rotation.x = pf.staggerHipR * stagger;
        } else if (progress < 0.7) {
          // Hit the ground
          const ground = (progress - 0.4) / 0.3;
          bodyPivot.rotation.x = pf.staggerBodyPivotRotX + ground * pf.groundBodyPivotRotX;
          bodyPivot.rotation.z = pf.staggerBodyPivotRotZ;
          this.group.position.y = ground * pf.groundPosY;
          shoulderL.rotation.x = pf.staggerShoulderLRotX + ground * pf.groundShoulderLRotX;
          shoulderL.rotation.z = pf.staggerShoulderLRotZ + ground * pf.groundShoulderLRotZ;
          shoulderR.rotation.x = pf.staggerShoulderRRotX;
          shoulderR.rotation.z = pf.staggerShoulderRRotZ + ground * pf.groundShoulderRRotZ;
          elbowL.rotation.x = pf.groundElbowL;
          elbowR.rotation.x = pf.groundElbowR;
          kneeL.rotation.x = pf.staggerKneeL + ground * pf.groundKneeL;
          kneeR.rotation.x = pf.groundKneeR;
        } else {
          // Lying on ground
          bodyPivot.rotation.x = pf.lyingBodyPivotRotX;
          bodyPivot.rotation.z = pf.lyingBodyPivotRotZ;
          this.group.position.y = pf.lyingPosY;
          shoulderL.rotation.x = pf.lyingShoulderL;
          shoulderL.rotation.z = pf.lyingShoulderLZ;
          shoulderR.rotation.x = pf.lyingShoulderR;
          shoulderR.rotation.z = pf.lyingShoulderRZ;
          elbowL.rotation.x = pf.lyingElbowL;
          elbowR.rotation.x = pf.lyingElbowR;
          kneeL.rotation.x = pf.lyingKneeL;
          kneeR.rotation.x = pf.lyingKneeR;
        }

        if (this.fallTimer <= 0) {
          this.fallTimer = 0;
          this.group.position.y = 0;
        }
        break;
      }

      case 'dunk': {
        bodyPivot.scale.set(1, 1, 1);
        const dunkDuration = animConfig.durations.dunkDuration;
        const progress = 1 - (this.dunkTimer / dunkDuration);

        // Height curve — feet at apexHeight means hand reaches ~3.2 (rim height).
        // Phase boundaries (0.15/0.45/0.65/0.85) are structural timing ratios
        // shared across the dunk state's pose code; only the apex height varies.
        const dunkApex = animConfig.amplitudes.dunk.apexHeight;
        let height: number;
        if (progress < 0.15) {
          height = (progress / 0.15) * dunkApex; // quick rise
        } else if (progress < 0.45) {
          height = dunkApex; // hang at peak (includes slam)
        } else if (progress < 0.65) {
          height = dunkApex; // still at rim height during hang
        } else if (progress < 0.85) {
          const drop = (progress - 0.65) / 0.2;
          height = dunkApex * (1 - drop); // drop to ground
        } else {
          height = 0; // on ground
        }
        this.group.position.y = height;

        // Reset arm scale for non-rim-hang phases
        {
          const upperArmR = this.group.getObjectByName('upper-arm-right');
          const forearmR = this.group.getObjectByName('forearm-right');
          if (progress < 0.45 || progress >= 0.65) {
            if (upperArmR) upperArmR.scale.set(1, 1, 1);
            if (forearmR) forearmR.scale.set(1, 1, 1);
          }
        }

        const pdk = animConfig.poses.dunk;
        if (progress < 0.15) {
          // RISE: crouch extends, legs start spreading, arms bring ball up
          const rise = progress / 0.15;
          bodyPivot.rotation.x = pdk.riseBodyPivotRotX * (1 - rise);
          kneeL.rotation.x = pdk.riseKneeLStart * (1 - rise) + pdk.riseKneeLEnd * rise;
          kneeR.rotation.x = pdk.riseKneeRStart * (1 - rise) + pdk.riseKneeREnd * rise;
          hipL.rotation.x = pdk.riseHipL * rise;
          hipR.rotation.x = pdk.riseHipR * rise;
          hipL.rotation.z = pdk.riseHipLZ * rise;
          hipR.rotation.z = pdk.riseHipRZ * rise;
          shoulderR.rotation.x = rise * pdk.riseShoulderR;
          shoulderL.rotation.x = rise * pdk.riseShoulderL;
          elbowR.rotation.x = pdk.riseElbowR * (1 - rise);
          elbowL.rotation.x = pdk.riseElbowL * (1 - rise);
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
        } else if (progress < 0.35) {
          // HANG TIME: MJ pose — RIGHT arm stretches UP with ball, getting bigger
          const hangT = (progress - 0.15) / 0.2;
          bodyPivot.rotation.x = pdk.hangBodyPivotRotX;
          shoulderR.rotation.x = pdk.hangShoulderRBase + hangT * pdk.hangShoulderROffset;
          elbowR.rotation.x = pdk.hangElbowR;
          shoulderL.rotation.x = pdk.hangShoulderL;
          shoulderL.rotation.z = pdk.hangShoulderLZ;
          elbowL.rotation.x = pdk.hangElbowL;
          shoulderR.rotation.z = 0;
          const armScale = 1 + hangT * animConfig.amplitudes.dunk.armScalePeak;
          const upperArmR = this.group.getObjectByName('upper-arm-right');
          const forearmR = this.group.getObjectByName('forearm-right');
          if (upperArmR) upperArmR.scale.set(armScale, armScale * animConfig.amplitudes.dunk.armThickness, armScale);
          if (forearmR) forearmR.scale.set(armScale * animConfig.amplitudes.dunk.armThickness, armScale * 1.2, armScale * animConfig.amplitudes.dunk.armThickness);
          kneeL.rotation.x = pdk.hangKneeL;
          kneeR.rotation.x = pdk.hangKneeR;
          hipL.rotation.x = pdk.hangHipL;
          hipR.rotation.x = pdk.hangHipR;
          hipL.rotation.z = pdk.hangHipLZ;
          hipR.rotation.z = pdk.hangHipRZ;
        } else if (progress < 0.45) {
          // SLAM: arms drive down, body curls forward
          const slam = (progress - 0.35) / 0.1;
          bodyPivot.rotation.x = pdk.slamBodyPivotRotXBase + slam * pdk.slamBodyPivotRotXSwing;
          shoulderR.rotation.x = pdk.slamShoulderRBase + slam * pdk.slamShoulderRSwing;
          shoulderL.rotation.x = pdk.slamShoulderLBase + slam * pdk.slamShoulderLSwing;
          elbowR.rotation.x = pdk.slamElbowRBase + slam * pdk.slamElbowRSwing;
          elbowL.rotation.x = pdk.slamElbowLBase + slam * pdk.slamElbowLSwing;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          kneeL.rotation.x = pdk.slamKneeLBase + slam * pdk.slamKneeLSwing;
          kneeR.rotation.x = pdk.slamKneeRBase + slam * pdk.slamKneeRSwing;
          hipL.rotation.x = pdk.slamHipLBase + slam * pdk.slamHipLSwing;
          hipR.rotation.x = pdk.slamHipRBase + slam * pdk.slamHipRSwing;
          hipL.rotation.z = pdk.hangHipLZ * (1 - slam);
          hipR.rotation.z = pdk.hangHipRZ * (1 - slam);
        } else if (progress < 0.65) {
          // RIM HANG: one arm up (hanging on rim), legs dangle, slight sway
          shoulderR.rotation.x = pdk.rimHangShoulderR;
          elbowR.rotation.x = pdk.rimHangElbowR;
          shoulderL.rotation.x = pdk.rimHangShoulderL;
          elbowL.rotation.x = pdk.rimHangElbowL;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          kneeL.rotation.x = pdk.rimHangKneeL;
          kneeR.rotation.x = pdk.rimHangKneeR;
          hipL.rotation.x = pdk.rimHangHipL;
          hipR.rotation.x = pdk.rimHangHipR;
          hipL.rotation.z = 0;
          hipR.rotation.z = 0;
          bodyPivot.rotation.x = 0;
          const sway = (progress - 0.45) / 0.2;
          bodyPivot.rotation.z = Math.sin(sway * Math.PI * 2) * pdk.rimHangSwayAmp;

          const upperArmR = this.group.getObjectByName('upper-arm-right');
          const forearmR = this.group.getObjectByName('forearm-right');
          if (upperArmR) upperArmR.scale.set(animConfig.amplitudes.dunk.rimHangArmScaleU, animConfig.amplitudes.dunk.rimHangArmScaleF, animConfig.amplitudes.dunk.rimHangArmScaleU);
          if (forearmR) forearmR.scale.set(animConfig.amplitudes.dunk.rimHangArmScaleF, animConfig.amplitudes.dunk.rimHangArmScaleF + 0.1, animConfig.amplitudes.dunk.rimHangArmScaleF);
        } else if (progress < 0.85) {
          // DROP FROM RIM: fall to ground
          const drop = (progress - 0.65) / 0.2;
          bodyPivot.rotation.x = pdk.dropBodyPivotRotXFactor * drop;
          bodyPivot.rotation.z = 0;
          shoulderR.rotation.x = pdk.dropShoulderRFrom + drop * pdk.dropShoulderRDelta;
          shoulderL.rotation.x = pdk.dropShoulderLFrom + drop * pdk.dropShoulderLDelta;
          elbowR.rotation.x = pdk.dropElbowRFrom + drop * pdk.dropElbowRDelta;
          elbowL.rotation.x = pdk.dropElbowLFrom + drop * pdk.dropElbowLDelta;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          kneeL.rotation.x = pdk.dropKneeLFrom + drop * pdk.dropKneeLDelta;
          kneeR.rotation.x = pdk.dropKneeRFrom + drop * pdk.dropKneeRDelta;
          hipL.rotation.x = pdk.rimHangHipL;
          hipR.rotation.x = pdk.rimHangHipR;
          hipL.rotation.z = 0;
          hipR.rotation.z = 0;
        } else {
          // DRAMATIC LANDING: deep knee bend, right foot forward, left behind, slowly stand
          const land = (progress - 0.85) / 0.15;
          bodyPivot.rotation.x = pdk.landBodyPivotRotX * (1 - land);
          bodyPivot.rotation.z = 0;
          hipR.rotation.x = pdk.landHipR;
          hipL.rotation.x = pdk.landHipL;
          kneeR.rotation.x = pdk.landKneeR * (1 - land * 0.5);
          kneeL.rotation.x = pdk.landKneeL * (1 - land * 0.5);
          shoulderR.rotation.x = pdk.landShoulderR;
          shoulderL.rotation.x = pdk.landShoulderL;
          elbowR.rotation.x = pdk.landElbowR;
          elbowL.rotation.x = pdk.landElbowL;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          hipL.rotation.z = 0;
          hipR.rotation.z = 0;
        }

        // Torso/hip twist during dunk — bigger twist for drama
        {
          const torsoNode = this.group.getObjectByName('torso');
          const hipMeshNode = this.group.getObjectByName('hip-mesh');
          if (torsoNode && hipMeshNode) {
            const hipTw = animConfig.amplitudes.dunk.hipTwist;
            const torsoTw = animConfig.amplitudes.dunk.torsoTwist;
            const slamThru = animConfig.amplitudes.dunk.slamTwistThrough;
            if (progress < 0.15) {
              const rise = progress / 0.15;
              hipMeshNode.rotation.y = hipTw * rise;
              torsoNode.rotation.y = -torsoTw * rise;
            } else if (progress < 0.35) {
              hipMeshNode.rotation.y = hipTw;
              torsoNode.rotation.y = -torsoTw;
            } else if (progress < 0.45) {
              const slam = (progress - 0.35) / 0.1;
              hipMeshNode.rotation.y = hipTw - slam * slamThru;
              torsoNode.rotation.y = -torsoTw + slam * (slamThru - 0.15);
            } else if (progress < 0.65) {
              hipMeshNode.rotation.y = -(hipTw + slamThru - hipTw); // -0.3 at defaults
              torsoNode.rotation.y = torsoTw + 0.05; // 0.2 at defaults
            } else {
              const recover = progress < 0.85 ? (progress - 0.65) / 0.2 : 1;
              hipMeshNode.rotation.y = -0.3 * (1 - recover);
              torsoNode.rotation.y = 0.2 * (1 - recover);
            }
          }
        }

        // Move toward hoop during rise and hang phases (progress < 0.45)
        if (this.dunkTarget && progress < 0.45) {
          const dx = this.dunkTarget.x - this.group.position.x;
          const dz = this.dunkTarget.z - this.group.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > animConfig.amplitudes.dunk.approachDist) {
            const speed = animConfig.amplitudes.dunk.approachSpeed; // fast lunge
            const step = Math.min(speed * dt, dist);
            this.group.position.x += (dx / dist) * step;
            this.group.position.z += (dz / dist) * step;
            // Face the hoop
            this.group.rotation.y = Math.atan2(dx, dz);
          }
        }

        if (this.dunkTimer <= 0) {
          this.dunkTimer = 0;
          this.group.position.y = 0;
          this.dunkTarget = null;
        }
        break;
      }

      case 'pass': {
        bodyPivot.scale.set(1, 1, 1);
        const passDuration = animConfig.durations.passDuration;
        const progress = 1 - (this.passTimer / passDuration);

        const pp = animConfig.poses.pass;
        if (progress < 0.25) {
          // PULL IN: both hands come together at chest, pull ball toward body
          const pull = progress / 0.25;
          shoulderR.rotation.x = pp.pullShoulderR * pull;
          shoulderL.rotation.x = pp.pullShoulderL * pull;
          shoulderR.rotation.z = pp.pullShoulderRZ * pull;
          shoulderL.rotation.z = pp.pullShoulderLZ * pull;
          elbowR.rotation.x = pp.pullElbowR * pull;
          elbowL.rotation.x = pp.pullElbowL * pull;
          bodyPivot.rotation.x = pp.pullBodyPivotRotX * pull;
        } else if (progress < 0.5) {
          // THROW: both arms thrust forward together, extending
          const push = (progress - 0.25) / 0.25;
          shoulderR.rotation.x = pp.pullShoulderR + push * pp.throwShoulderR;
          shoulderL.rotation.x = pp.pullShoulderL + push * pp.throwShoulderL;
          shoulderR.rotation.z = pp.pullShoulderRZ + push * pp.throwShoulderRZ;
          shoulderL.rotation.z = pp.pullShoulderLZ + push * pp.throwShoulderLZ;
          elbowR.rotation.x = pp.pullElbowR + push * pp.throwElbowR;
          elbowL.rotation.x = pp.pullElbowL + push * pp.throwElbowL;
          bodyPivot.rotation.x = pp.pullBodyPivotRotX + push * pp.throwBodyPivotRotX;
          hipR.rotation.x = pp.throwHipR * push;
          kneeR.rotation.x = pp.throwKneeR * push;
        } else {
          // FOLLOW THROUGH: arms stay extended briefly, then return
          const recover = (progress - 0.5) / 0.5;
          shoulderR.rotation.x = pp.ftShoulderRBase + recover * pp.ftShoulderRSwing;
          shoulderL.rotation.x = pp.ftShoulderLBase + recover * pp.ftShoulderLSwing;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          elbowR.rotation.x = -0.1;
          elbowL.rotation.x = -0.1;
          bodyPivot.rotation.x = pp.ftBodyPivotRotX * (1 - recover);
          hipR.rotation.x = pp.ftHipR * (1 - recover);
          kneeR.rotation.x = pp.ftKneeR * (1 - recover);
        }
        hipL.rotation.x = pp.hipL;
        kneeL.rotation.x = pp.kneeL;
        break;
      }
    }

    // Hide block screen when not guarding
    if (this.animState !== 'guard') {
      const screen = this.group.getObjectByName('block-screen');
      if (screen) screen.visible = false;
    }

    // Reset shoulder Z rotation if not in dribble/guard/steal/jump/jump-block/dunk/dribble-sprint/fall/pass
    if (this.animState !== 'dribble' && this.animState !== 'guard' && this.animState !== 'steal' && this.animState !== 'jump' && this.animState !== 'jump-block' && this.animState !== 'dunk' && this.animState !== 'dribble-sprint' && this.animState !== 'fall' && this.animState !== 'pass') {
      shoulderL.rotation.z = 0;
      shoulderR.rotation.z = 0;
    }

    // Reset body twist if not stealing
    if (this.animState !== 'steal') {
      bodyPivot.rotation.y = 0;
    }

    // Reset body tilt if not falling or dunking
    if (this.animState !== 'fall' && this.animState !== 'dunk') {
      bodyPivot.rotation.z = 0;
    }

    // Reset forearm scale if not stealing and not dunking
    if (this.animState !== 'steal' && this.animState !== 'dunk') {
      const forearmR = this.group.getObjectByName('forearm-right');
      if (forearmR) forearmR.scale.set(1, 1, 1);
    }

    // Reset upper arm scale if not dunking
    if (this.animState !== 'dunk') {
      const upperArmR = this.group.getObjectByName('upper-arm-right');
      if (upperArmR) upperArmR.scale.set(1, 1, 1);
    }

    // Reset hip Z spread if not dunking
    if (this.animState !== 'dunk') {
      hipL.rotation.z = 0;
      hipR.rotation.z = 0;
    }

    // Reset torso/hip twist for non-locomotion states (exclude states that handle their own twist)
    if (this.animState !== 'walk' && this.animState !== 'sprint' && this.animState !== 'dribble' && this.animState !== 'dribble-sprint' && this.animState !== 'shoot' && this.animState !== 'jump' && this.animState !== 'jump-block' && this.animState !== 'dunk') {
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

  forceAnimState(state: 'idle' | 'walk' | 'sprint' | 'dribble' | 'dribble-sprint' | 'guard' | 'steal' | 'shoot' | 'jump' | 'jump-block' | 'fall' | 'dunk' | 'pass' | null): void {
    this.forcedAnimState = state;
  }

  triggerSteal(): void {
    this.stealTimer = 0.6; // longer for wind-up + pause + swipe
  }

  triggerShoot(): void {
    this.shootTimer = 0.4;
  }

  triggerGuard(): void {
    this.isGuarding = true;
    this.guardTimer = 1.0;
    this.animState = 'guard';
    this.animTime = 0;
  }

  triggerFall(): void {
    this.fallTimer = 0.8;
  }

  triggerDunk(target?: { x: number; z: number }): void {
    this.dunkTimer = 1.2; // longer for hang + dramatic landing
    this.dunkTarget = target ?? null;
  }

  get isDunking(): boolean {
    return this.dunkTimer > 0;
  }

  triggerPass(): void {
    this.passTimer = 0.35;
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

    // Clamp to court bounds (same as moveByInput)
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -7, 7);
    this.group.position.z = THREE.MathUtils.clamp(
      this.group.position.z,
      GamePlayer.courtBoundsZ[0],
      GamePlayer.courtBoundsZ[1]
    );

    if (this.isHumanControlled) {
      // Human stays instant-turn for responsive feel.
      const angle = Math.atan2(direction.x, direction.z);
      this.group.rotation.y = angle;
    }
    // AI rotation is owned by GameSession.updateAIFacing() which lerps smoothly.
    // Skipping the instant-snap write here avoids fighting that lerp (which
    // otherwise produces per-frame rotation flicker when the AI target moves).

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
    const speed = this.isSprinting ? this.moveSpeed * 2.0 : this.moveSpeed;
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
