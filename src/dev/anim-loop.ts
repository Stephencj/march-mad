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

  /** Drive one animation frame. `dt` should already be speed-scaled by the caller. */
  tick(dt: number): void {
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
