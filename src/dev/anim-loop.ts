// =============================================================================
// Shared animation-loop driver for dev tools (anim-viewer, player-editor, ...).
//
// Wraps a GamePlayer + optional Ball/hoop props in a loopable animation tick:
//   - selects per-anim velocity / hasBall / forced state
//   - re-triggers timed anims (shoot, steal, jump, dunk, fall, pass, jump-block)
//     so they repeat automatically
//   - manages ball release / flight / pickup for shoot, dunk, pass, dribble
//
// This logic was extracted verbatim from anim-viewer.ts — edits here affect
// every dev surface that uses AnimLoop. Keep it GamePlayer-API-only so it
// never depends on any single editor's DOM.
// =============================================================================
import * as THREE from 'three';
import type { GamePlayer } from '../game/player';
import type { Ball } from '../game/ball';
import type { PoseClip, PoseFrame } from './mocap/types';

// Dad-bod rig torso length (shoulder-mid → hip-mid). The bodyPivot sits at
// y=0.78 (player.ts:182) and shoulder-bar / hip-mesh sit ~0.27m above and
// ~0.28m below within bodyPivot — so the rig torso ≈ 0.55m. We scale the
// captured `bodyY` (in real-world meters) by RIG_TORSO_LEN / clip.torsoLength
// so a 0.1m bounce in the capture maps to ~10cm of rig motion regardless of
// the captured subject's actual height.
const RIG_TORSO_LEN = 0.55;
/** Neutral body-pivot height in meters; matches GamePlayer.createMesh. */
const RIG_BASELINE_Y = 0.78;

/**
 * Apply a single retargeted PoseFrame to a player rig. Looks up joints by
 * name each call so it works across rebuilds (setPlayer / body edits).
 *
 * Pure-ish: only mutates player rotations + body-pivot.position.y. Caller is
 * responsible for invoking this AFTER `player.animate(dt)` so it wins.
 *
 * `torsoLength` is the captured torso length recorded on PoseClip; used to
 * normalize the `bodyY` bounce to the rig's torso scale (see RIG_TORSO_LEN).
 */
export function applyPoseFrame(
  player: GamePlayer,
  p: PoseFrame,
  torsoLength: number,
): void {
  const root = player.group;
  const bodyPivot = root.getObjectByName('body-pivot');
  if (!bodyPivot) return; // rig not built yet

  // bodyY scaling: clip is in real-world meters relative to the subject's
  // captured torso. Rescale to rig-meters so the magnitude reads correctly
  // on whatever-sized dad-bod we're driving. Fall back to 1× if torsoLength
  // is degenerate (can happen on very short / occluded captures).
  const bodyYScale = torsoLength > 1e-3 ? RIG_TORSO_LEN / torsoLength : 1;
  bodyPivot.position.y = RIG_BASELINE_Y + p.bodyY * bodyYScale;
  bodyPivot.rotation.set(p.bodyPivot.x, p.bodyPivot.y, p.bodyPivot.z);

  const hipMesh = root.getObjectByName('hip-mesh');
  if (hipMesh) hipMesh.rotation.y = p.hipMeshY;

  const torso = root.getObjectByName('torso');
  if (torso) torso.rotation.y = p.torsoY;

  const neck = root.getObjectByName('neck-group');
  if (neck) neck.rotation.set(p.neck.x, p.neck.y, p.neck.z);

  const shoulderL = root.getObjectByName('shoulder-left');
  if (shoulderL) {
    shoulderL.rotation.x = p.shoulderL.x;
    shoulderL.rotation.z = p.shoulderL.z;
    // Reset y so any prior anim-state writes don't bleed through.
    shoulderL.rotation.y = 0;
  }
  const shoulderR = root.getObjectByName('shoulder-right');
  if (shoulderR) {
    shoulderR.rotation.x = p.shoulderR.x;
    shoulderR.rotation.z = p.shoulderR.z;
    shoulderR.rotation.y = 0;
  }

  const elbowL = root.getObjectByName('elbow-left');
  if (elbowL) elbowL.rotation.x = p.elbowL;
  const elbowR = root.getObjectByName('elbow-right');
  if (elbowR) elbowR.rotation.x = p.elbowR;

  const hipL = root.getObjectByName('hip-left');
  if (hipL) {
    hipL.rotation.x = p.hipL.x;
    hipL.rotation.z = p.hipL.z;
    hipL.rotation.y = 0;
  }
  const hipR = root.getObjectByName('hip-right');
  if (hipR) {
    hipR.rotation.x = p.hipR.x;
    hipR.rotation.z = p.hipR.z;
    hipR.rotation.y = 0;
  }

  const kneeL = root.getObjectByName('knee-left');
  if (kneeL) kneeL.rotation.x = p.kneeL;
  const kneeR = root.getObjectByName('knee-right');
  if (kneeR) kneeR.rotation.x = p.kneeR;
}

/** Linear interpolation of two PoseFrames. α is clamped to [0, 1]. */
function lerpPoseFrame(a: PoseFrame, b: PoseFrame, alpha: number): PoseFrame {
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    t: lerp(a.t, b.t),
    bodyY: lerp(a.bodyY, b.bodyY),
    bodyPivot: {
      x: lerp(a.bodyPivot.x, b.bodyPivot.x),
      y: lerp(a.bodyPivot.y, b.bodyPivot.y),
      z: lerp(a.bodyPivot.z, b.bodyPivot.z),
    },
    hipMeshY: lerp(a.hipMeshY, b.hipMeshY),
    torsoY: lerp(a.torsoY, b.torsoY),
    neck: {
      x: lerp(a.neck.x, b.neck.x),
      y: lerp(a.neck.y, b.neck.y),
      z: lerp(a.neck.z, b.neck.z),
    },
    shoulderL: {
      x: lerp(a.shoulderL.x, b.shoulderL.x),
      z: lerp(a.shoulderL.z, b.shoulderL.z),
    },
    shoulderR: {
      x: lerp(a.shoulderR.x, b.shoulderR.x),
      z: lerp(a.shoulderR.z, b.shoulderR.z),
    },
    elbowL: lerp(a.elbowL, b.elbowL),
    elbowR: lerp(a.elbowR, b.elbowR),
    hipL: { x: lerp(a.hipL.x, b.hipL.x), z: lerp(a.hipL.z, b.hipL.z) },
    hipR: { x: lerp(a.hipR.x, b.hipR.x), z: lerp(a.hipR.z, b.hipR.z) },
    kneeL: lerp(a.kneeL, b.kneeL),
    kneeR: lerp(a.kneeR, b.kneeR),
  };
}

/**
 * Sample a PoseClip at time `t` (seconds) by linearly interpolating between
 * the two bracketing frames. Caller is responsible for wrapping `t` into
 * [0, duration]. Single-frame clips return that frame.
 */
function samplePoseClip(clip: PoseClip, t: number): PoseFrame {
  const frames = clip.frames;
  if (frames.length === 1) return frames[0];
  // Linear scan — clips are short (typically <300 frames), no need for a
  // binary search. If perf becomes an issue we can cache lastIndex.
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i];
    const f1 = frames[i + 1];
    if (t >= f0.t && t <= f1.t) {
      const span = f1.t - f0.t;
      const alpha = span > 1e-9 ? (t - f0.t) / span : 0;
      return lerpPoseFrame(f0, f1, alpha);
    }
  }
  // t past the last frame — clamp.
  return frames[frames.length - 1];
}

export const ANIM_IDS = [
  'idle',
  'walk',
  'dribble',
  'dribble-walk',
  'guard',
  'steal',
  'shoot',
  'jump',
  'sprint',
  'dribble-sprint',
  'jump-block',
  'fall',
  'dunk',
  'pass',
] as const;
export type AnimId = (typeof ANIM_IDS)[number];

interface TimerFields {
  stealTimer: number;
  shootTimer: number;
  fallTimer: number;
  dunkTimer: number;
  passTimer: number;
}

export interface AnimLoopProps {
  /** Ball shown for dribble / shoot / dunk / pass; omit if not needed. */
  ball?: Ball;
  /** World-space rim center for shoot + dunk arcs. Default (0,3.05,2.5). */
  hoopPos?: THREE.Vector3;
  /** Chest-height pass target (e.g. another player). Default (0,1.0,3). */
  passTargetPos?: THREE.Vector3;
}

export class AnimLoop {
  private currentAnim: AnimId = 'idle';
  private ownerId = 'editor';

  // Per-anim release / reset flags (match anim-viewer's variables).
  private shootReleased = false;
  private dunkReleased = false;
  private passReleased = false;
  private shootResetDelay = 0;
  private shootBallFalling = false;
  private shootInIdle = false;
  private shootIdleTimer = 0;

  private readonly hoopPos: THREE.Vector3;
  private readonly passTargetPos: THREE.Vector3;

  // --- Mocap-playback mode (Phase 3) ---
  // When `mocapClip` is non-null, tick() runs an alternate path: still calls
  // `player.animate(dt)` to keep timers/state coherent, but then overwrites
  // every joint rotation from the lerped PoseFrame so the captured motion
  // shows on the rig.
  private mocapClip: PoseClip | null = null;
  private mocapTime = 0;
  private mocapPlaybackSpeed = 1;

  constructor(
    private player: GamePlayer,
    private props: AnimLoopProps = {},
  ) {
    this.hoopPos = props.hoopPos ?? new THREE.Vector3(0, 3.05, 2.5);
    this.passTargetPos = props.passTargetPos ?? new THREE.Vector3(0, 1.0, 3);
  }

  /** Swap the underlying player (e.g. after a body rebuild). */
  setPlayer(player: GamePlayer): void {
    this.player = player;
  }

  getAnim(): AnimId {
    return this.currentAnim;
  }

  /** Change the active animation. Resets all per-anim state so it starts clean. */
  setAnim(anim: AnimId): void {
    this.currentAnim = anim;
    const p = this.player as unknown as TimerFields;
    p.stealTimer = 0;
    p.shootTimer = 0;
    p.fallTimer = 0;
    p.dunkTimer = 0;
    p.passTimer = 0;
    this.player.isJumping = false;
    this.player.isSprinting = false;
    this.shootReleased = false;
    this.dunkReleased = false;
    this.passReleased = false;
    this.shootResetDelay = 0;
    this.shootBallFalling = false;
    this.shootInIdle = false;
    this.shootIdleTimer = 0;
    this.player.group.position.set(0, 0, 0);
    // forceAnimState only for poses that don't flow out of velocity/timers.
    if (anim === 'guard') this.player.forceAnimState('guard');
    else if (anim === 'fall') this.player.forceAnimState('fall');
    else if (anim === 'dunk') this.player.forceAnimState('dunk');
    else this.player.forceAnimState(null);
  }

  // ---------------- Mocap-playback API (Phase 3) ----------------

  /**
   * Begin looping playback of a retargeted mocap clip on this player. Forces
   * the rig into a neutral idle state so the animate() per-state code path
   * doesn't fight the captured rotations — we overwrite the joints AFTER
   * animate() runs in tick().
   */
  playMocap(clip: PoseClip, opts?: { speed?: number }): void {
    this.mocapClip = clip;
    this.mocapTime = 0;
    this.mocapPlaybackSpeed = opts?.speed ?? 1;
    // Hide the ball — captured motion is rig-only, no prop choreography.
    if (this.props.ball) this.props.ball.mesh.visible = false;
    // Pin position; force idle so animate() doesn't drive any locomotion.
    this.player.velocity.set(0, 0, 0);
    this.player.hasBall = false;
    this.player.isJumping = false;
    this.player.isSprinting = false;
    this.player.group.position.set(0, 0, 0);
    this.player.group.rotation.x = 0;
    this.player.forceAnimState('idle');
  }

  /** Stop mocap playback. Caller should re-arm a regular anim via setAnim(). */
  stopMocap(): void {
    this.mocapClip = null;
    this.mocapTime = 0;
    this.player.forceAnimState(null);
  }

  isPlayingMocap(): boolean {
    return this.mocapClip !== null;
  }

  /** Drive one animation frame. `dt` should already be speed-scaled by the caller. */
  tick(dt: number): void {
    // Mocap mode: keep animate() running (it ticks down timers, manages the
    // possession ring, etc.) but override every joint rotation from the
    // captured PoseFrame so the rig shows the captured motion exactly.
    if (this.mocapClip) {
      this.tickMocap(dt);
      return;
    }

    const player = this.player;
    const ball = this.props.ball;
    const anim = this.currentAnim;
    const p = player as unknown as TimerFields;

    // --- Per-anim velocity / hasBall / timer re-trigger ---
    switch (anim) {
      case 'idle':
        player.hasBall = false;
        player.velocity.set(0, 0, 0);
        break;
      case 'walk':
        player.hasBall = false;
        player.velocity.set(0, 0, 2);
        break;
      case 'dribble':
        player.hasBall = true;
        player.velocity.set(0, 0, 0);
        break;
      case 'dribble-walk':
        player.hasBall = true;
        player.velocity.set(0, 0, 2);
        break;
      case 'guard':
        player.hasBall = false;
        player.velocity.set(0, 0, 0);
        break;
      case 'steal':
        player.hasBall = false;
        player.velocity.set(0, 0, 0);
        if (p.stealTimer <= 0) player.triggerSteal();
        break;
      case 'shoot':
        player.velocity.set(0, 0, 0);
        if (this.shootInIdle) {
          player.hasBall = false;
        } else if (this.shootReleased) {
          player.hasBall = false;
        } else {
          player.hasBall = true;
          if (p.shootTimer <= 0 && this.shootResetDelay <= 0) player.triggerShoot();
        }
        break;
      case 'jump':
        player.hasBall = false;
        player.velocity.set(0, 0, 0);
        if (!player.isJumping) player.jump();
        break;
      case 'sprint':
        player.hasBall = false;
        player.isSprinting = true;
        player.velocity.set(0, 0, 3);
        break;
      case 'dribble-sprint':
        player.hasBall = true;
        player.isSprinting = true;
        player.velocity.set(0, 0, 3);
        break;
      case 'jump-block':
        player.hasBall = false;
        player.velocity.set(0, 0, 0);
        if (!player.isJumping) player.jump();
        break;
      case 'fall':
        player.hasBall = false;
        player.velocity.set(0, 0, 0);
        break;
      case 'dunk':
        player.hasBall = true;
        player.velocity.set(0, 0, 0);
        if (p.dunkTimer <= 0) {
          if (ball) {
            ball.pickup(this.ownerId);
            ball.isInFlight = false;
          }
          player.triggerDunk();
          this.dunkReleased = false;
        }
        break;
      case 'pass':
        player.velocity.set(0, 0, 0);
        if (p.passTimer <= 0) {
          if (ball) {
            ball.pickup(this.ownerId);
            ball.isInFlight = false;
          }
          player.hasBall = true;
          player.triggerPass();
          this.passReleased = false;
        }
        if (!this.passReleased) player.hasBall = true;
        break;
    }

    // Force-state refresh each tick (forceAnimState's flag is checked inside animate).
    if (anim === 'guard') player.forceAnimState('guard');
    if (anim === 'fall') {
      player.forceAnimState('fall');
      if (p.fallTimer <= 0) player.triggerFall();
    }
    if (anim === 'dunk') player.forceAnimState('dunk');

    player.animate(dt);

    // Critical: after animate(), force hasBall=false if the ball was released,
    // otherwise GamePlayer would auto-switch back to 'dribble'.
    if (anim === 'shoot' && this.shootReleased) player.hasBall = false;

    // --- Shoot ball handling ---
    if (anim === 'shoot' && ball) {
      const shootTimer = p.shootTimer;

      if (!this.shootReleased && shootTimer > 0 && shootTimer < 0.2) {
        this.shootReleased = true;
        player.hasBall = false;
        ball.release();
        ball.shootAt(this.hoopPos.clone(), 0.8);
        this.shootBallFalling = false;
      }
      if (ball.isInFlight) ball.update(dt);
      if (this.shootReleased && !ball.isInFlight && ball.heldBy !== null) ball.release();
      if (this.shootReleased && !ball.isInFlight && !this.shootBallFalling && ball.heldBy === null) {
        ball.velocity.set(0, -3, 0);
        this.shootBallFalling = true;
      }
      if (this.shootReleased && !ball.isInFlight && ball.heldBy === null) ball.update(dt);
      if (this.shootReleased) player.hasBall = false;

      if (this.shootReleased && !ball.isInFlight && shootTimer <= 0) {
        this.shootResetDelay += dt;
        if (this.shootResetDelay > 1.5) {
          ball.pickup(this.ownerId);
          ball.isInFlight = false;
          this.shootBallFalling = false;
          this.shootReleased = false;
          this.shootResetDelay = 0;
          this.shootInIdle = true;
          this.shootIdleTimer = 1.0;
          player.hasBall = false;
        }
      }
      if (this.shootInIdle) {
        this.shootIdleTimer -= dt;
        player.hasBall = false;
        if (this.shootIdleTimer <= 0) {
          this.shootInIdle = false;
          player.hasBall = true;
          ball.pickup(this.ownerId);
          player.triggerShoot();
        }
      }
      ball.mesh.visible = true;
      if (ball.heldBy) ball.followHolder(player.group, false, 0);
    }

    // --- Dunk ball release + body swing ---
    if (anim === 'dunk' && ball) {
      const dunkTimer = p.dunkTimer;
      const dunkDuration = 1.2;
      const dunkProg = 1 - dunkTimer / dunkDuration;

      if (!this.dunkReleased && dunkProg > 0.38) {
        this.dunkReleased = true;
        player.hasBall = false;
        ball.release();
        ball.mesh.position.set(this.hoopPos.x, this.hoopPos.y + 0.15, this.hoopPos.z);
        ball.velocity.set(0, -4, 0);
      }
      if (!ball.heldBy && this.dunkReleased) ball.update(dt);
      ball.mesh.visible = true;
      if (dunkProg < 0.45 || dunkProg >= 0.65) player.group.rotation.x = 0;
    } else {
      player.group.rotation.x = 0;
    }

    // --- Dribble ball tracking ---
    if (ball && (anim === 'dribble' || anim === 'dribble-walk' || anim === 'dribble-sprint')) {
      ball.mesh.visible = true;
      ball.pickup(this.ownerId);
      ball.followHolder(player.group, true, player.dribblePhase);
    } else if (ball && anim === 'pass') {
      const passTimer = p.passTimer;
      if (!this.passReleased && passTimer > 0 && passTimer < 0.2) {
        this.passReleased = true;
        player.hasBall = false;
        ball.release();
        ball.passTo(this.passTargetPos.clone());
      }
      if (ball.isInFlight || (!ball.heldBy && this.passReleased)) ball.update(dt);
      else if (ball.heldBy) ball.followHolder(player.group, false, 0);
      if (this.passReleased) player.hasBall = false;
      ball.mesh.visible = true;
    } else if (ball && anim !== 'shoot' && anim !== 'dunk') {
      ball.mesh.visible = false;
    }

    // --- Keep player pinned to origin, except during dunk pendulum arc ---
    if (anim !== 'dunk') {
      player.group.position.x = 0;
      player.group.position.z = 0;
    } else {
      this.applyDunkArc();
      if (ball && ball.heldBy && !this.dunkReleased) {
        player.group.updateWorldMatrix(true, true);
        ball.followHolder(player.group, false);
      }
    }
  }

  private tickMocap(dt: number): void {
    const clip = this.mocapClip;
    if (!clip) return;
    const player = this.player;

    // Pin position / state every tick — animate() and prior anim writes can
    // still leave residue (e.g. group.position.y from idle bob).
    player.velocity.set(0, 0, 0);
    player.hasBall = false;
    player.isJumping = false;
    player.isSprinting = false;
    player.forceAnimState('idle');

    // Run animate() so the player's internal state machine stays consistent
    // (timers, possession ring, etc.). We override every joint rotation
    // immediately afterward, so any rotations animate() wrote are discarded.
    player.animate(dt);

    // Pin world transform — animate() may have nudged group.position.y for
    // the idle bob, and the captured bodyY drives our height instead.
    player.group.position.set(0, 0, 0);
    player.group.rotation.set(0, player.group.rotation.y, 0);

    const frames = clip.frames;
    if (frames.length === 0) return;

    if (frames.length === 1) {
      applyPoseFrame(player, frames[0], clip.torsoLength);
      return;
    }

    // Loop. The clip's last frame.t defines the duration (frame 0 is at t=0).
    const duration = frames[frames.length - 1].t;
    if (duration <= 1e-6) {
      applyPoseFrame(player, frames[0], clip.torsoLength);
      return;
    }
    this.mocapTime += dt * this.mocapPlaybackSpeed;
    // Wrap into [0, duration). Use a while-loop to be robust to large dt
    // (e.g. tab backgrounded) and negative speeds.
    while (this.mocapTime >= duration) this.mocapTime -= duration;
    while (this.mocapTime < 0) this.mocapTime += duration;

    const sample = samplePoseClip(clip, this.mocapTime);
    applyPoseFrame(player, sample, clip.torsoLength);
  }

  private applyDunkArc(): void {
    const player = this.player;
    const p = player as unknown as TimerFields;
    const dunkDuration = 1.2;
    const progress = 1 - p.dunkTimer / dunkDuration;
    const hoopZ = this.hoopPos.z;
    const rimY = this.hoopPos.y;
    const pendulumLen = 1.8;

    if (progress < 0.35) {
      const arcT = progress / 0.35;
      player.group.position.z = arcT * hoopZ;
      const endY = rimY - pendulumLen;
      const overshoot = 1.0;
      player.group.position.y = endY * arcT + overshoot * Math.sin(arcT * Math.PI);
    } else if (progress < 0.45) {
      player.group.position.z = hoopZ - 0.4;
      player.group.position.y = rimY - pendulumLen;
      player.group.rotation.x = 0;
    } else if (progress < 0.65) {
      const hangT = (progress - 0.45) / 0.2;
      let angle: number;
      if (hangT < 0.5) angle = hangT * 2 * 0.25;
      else {
        const outT = (hangT - 0.5) / 0.5;
        angle = 0.25 - outT * 0.35;
      }
      const rimFrontZ = hoopZ - 0.4;
      player.group.position.y = rimY - Math.cos(angle) * pendulumLen;
      player.group.position.z = rimFrontZ - Math.sin(angle) * pendulumLen;
      player.group.rotation.x = angle;
    } else if (progress < 0.85) {
      const dropT = (progress - 0.65) / 0.2;
      const startY = rimY - Math.cos(-0.1) * pendulumLen;
      const rimFrontZ2 = hoopZ - 0.4;
      const startZ = rimFrontZ2 - Math.sin(-0.1) * pendulumLen;
      player.group.position.z = startZ + (hoopZ - startZ) * dropT;
      player.group.position.y = startY * (1 - dropT);
      player.group.rotation.x = -0.1 * (1 - dropT);
    } else {
      player.group.position.z = hoopZ;
      player.group.position.y = 0;
    }
    player.group.position.x = 0;
  }
}
