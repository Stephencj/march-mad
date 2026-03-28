import * as THREE from 'three';
import type { TeamData, Possession, ShotType, GameMode, GameOverData } from '@/core/types';
import type { EventBus } from '@/core/events';
import type { ControlInput, GestureResult } from './controls';
import type { CameraMode } from './camera';
import { GamePlayer } from './player';
import { Ball } from './ball';
import { MatchEngine } from './match';
import { ShotDetector } from './shot-detector';
import { PlayerAI, type AIContext } from '@/ai/player-ai';
import { COURT_DIMENSIONS } from './court';
import { FULL_COURT_DIMENSIONS } from './full-court';
import { ProgressionSystem } from '@/meta/progression';
import { PowerupSystem } from '@/systems/powerups';
import { PowerupVisuals } from './powerup-visuals';
import { calculateShotSuccess } from './shot-accuracy';
import { findBestPassTarget, isInPassLane } from './pass-targeting';
import type { HapticManager } from '@/systems/haptics';
import { clampShotTarget, isInDunkZone } from './shot-range';

interface CameraInfo {
  mode: CameraMode;
  trackPosition: THREE.Vector3;
  lookAt: THREE.Vector3;
}

export class GameSession {
  homePlayers: GamePlayer[] = [];
  awayPlayers: GamePlayer[] = [];
  ball: Ball;
  matchEngine: MatchEngine;

  // Fixed per-team hoops — NEVER swap
  private homeAttackHoop: THREE.Vector3;  // hoopAway z=+13 (home SCORES here)
  private homeDefendHoop: THREE.Vector3;  // hoopHome z=-13 (home DEFENDS here)
  private awayAttackHoop: THREE.Vector3;  // hoopHome z=-13 (away SCORES here)
  private awayDefendHoop: THREE.Vector3;  // hoopAway z=+13 (away DEFENDS here)

  // Dead ball state
  private deadBallTimer = 0;
  private deadBallReceivingTeam: 'home' | 'away' | null = null;

  private mode: GameMode;
  private cameraRef: THREE.Camera | null = null;
  private events: EventBus;
  private humanPlayerId: string;
  private shotDetector: ShotDetector;
  private playerAIs = new Map<string, PlayerAI>();
  private scene: THREE.Scene | null = null;
  private lastShooterId: string | null = null;
  private pendingPassTarget: string | null = null;
  private slamCamRequested = false;
  private slamCamPosition: THREE.Vector3 | null = null;
  private powerupSystem: PowerupSystem;
  private powerupVisuals = new PowerupVisuals();
  lastPowerupPickup: string | null = null;
  private aiShootTimer = 0;
  private lastChargeMultiplier = 1.0;
  private tabCycleIndex = 0;
  private inboundTimer = 0;
  private inbounderId: string | null = null;
  private inboundTargetId: string | null = null;
  private hapticManager: HapticManager | null = null;
  private aiDisabledPlayers = new Set<string>();
  private pendingDunkShooterId: string | null = null;


  constructor(events: EventBus, homeTeam: TeamData, awayTeam: TeamData, humanPlayerId: string, mode: GameMode = '3v3') {
    this.events = events;
    this.mode = mode;
    this.humanPlayerId = humanPlayerId;
    this.ball = new Ball(new THREE.Vector3(0, 1, 2));
    this.matchEngine = new MatchEngine(events, homeTeam, awayTeam);
    this.powerupSystem = new PowerupSystem(events);

    this.events.on('shot-clock-violation', (data: { violatingTeam: string }) => {
      // Proper turnover — inbound to the other team
      const receivingTeam: 'home' | 'away' = data.violatingTeam === 'home' ? 'away' : 'home';
      this.enterDeadBall(receivingTeam);
      this.events.emit('splash', { text: 'SHOT CLOCK!', color: '#ff6600' });
    });

    this.events.on('foul', () => {
      this.events.emit('splash', { text: 'FOUL!', color: '#ffaa00' });
    });

    if (mode === '5v5') {
      // Fixed per-team hoops — set once, NEVER change
      this.homeAttackHoop = FULL_COURT_DIMENSIONS.hoopAway.clone();  // z=+13
      this.homeDefendHoop = FULL_COURT_DIMENSIONS.hoopHome.clone();  // z=-13
      this.awayAttackHoop = FULL_COURT_DIMENSIONS.hoopHome.clone();  // z=-13
      this.awayDefendHoop = FULL_COURT_DIMENSIONS.hoopAway.clone();  // z=+13
      this.shotDetector = new ShotDetector(this.homeAttackHoop);
    } else {
      // 3v3: single hoop
      this.homeAttackHoop = COURT_DIMENSIONS.hoopPosition.clone();
      this.homeDefendHoop = COURT_DIMENSIONS.hoopPosition.clone();
      this.awayAttackHoop = COURT_DIMENSIONS.hoopPosition.clone();
      this.awayDefendHoop = COURT_DIMENSIONS.hoopPosition.clone();
      this.shotDetector = new ShotDetector();
    }

    // Spawn home team players
    const homeColor = parseInt(homeTeam.colors.primary.replace('#', ''), 16) || 0x3498db;
    let homePositions: THREE.Vector3[];
    if (mode === '5v5') {
      homePositions = [
        new THREE.Vector3(0, 0, -8),
        new THREE.Vector3(-4, 0, -5),
        new THREE.Vector3(4, 0, -5),
        new THREE.Vector3(-2, 0, -3),
        new THREE.Vector3(2, 0, -3),
      ];
    } else {
      homePositions = [
        new THREE.Vector3(-3, 0, 2),
        new THREE.Vector3(3, 0, 2),
        new THREE.Vector3(0, 0, 5),
      ];
    }
    homeTeam.players.forEach((pd, i) => {
      const gp = new GamePlayer(pd, homePositions[i] ?? homePositions[0], homeColor);
      if (pd.id === humanPlayerId) gp.isHumanControlled = true;
      this.homePlayers.push(gp);
      if (pd.id !== humanPlayerId) {
        this.playerAIs.set(pd.id, new PlayerAI(pd.stats, pd.personality));
      }
    });

    // Spawn away team players
    const awayColor = parseInt(awayTeam.colors.primary.replace('#', ''), 16) || 0xe74c3c;
    let awayPositions: THREE.Vector3[];
    if (mode === '5v5') {
      awayPositions = [
        new THREE.Vector3(0, 0, 8),
        new THREE.Vector3(-4, 0, 5),
        new THREE.Vector3(4, 0, 5),
        new THREE.Vector3(-2, 0, 3),
        new THREE.Vector3(2, 0, 3),
      ];
    } else {
      awayPositions = [
        new THREE.Vector3(-2, 0, -2),
        new THREE.Vector3(2, 0, -2),
        new THREE.Vector3(0, 0, -4),
      ];
    }
    awayTeam.players.forEach((pd, i) => {
      const gp = new GamePlayer(pd, awayPositions[i] ?? awayPositions[0], awayColor);
      this.awayPlayers.push(gp);
      this.playerAIs.set(pd.id, new PlayerAI(pd.stats, pd.personality));
    });
  }

  // --- Per-team hoop helpers ---

  getTeamAttackHoop(team: 'home' | 'away'): THREE.Vector3 {
    return team === 'home' ? this.homeAttackHoop : this.awayAttackHoop;
  }

  getTeamDefendHoop(team: 'home' | 'away'): THREE.Vector3 {
    return team === 'home' ? this.homeDefendHoop : this.awayDefendHoop;
  }

  setCameraRef(camera: THREE.Camera): void {
    this.cameraRef = camera;
  }

  setHapticManager(haptics: HapticManager): void {
    this.hapticManager = haptics;
  }

  disableAI(playerId: string): void {
    this.aiDisabledPlayers.add(playerId);
  }

  enableAI(playerId: string): void {
    this.aiDisabledPlayers.delete(playerId);
  }

  isAIEnabled(playerId: string): boolean {
    return !this.aiDisabledPlayers.has(playerId);
  }

  setFreeplayMode(): void {
    this.matchEngine.freeplay = true;
    this.matchEngine.state.clockSeconds = 99999;
    this.matchEngine.state.shotClockSeconds = 99999;
  }

  addToScene(scene: THREE.Scene): void {
    this.scene = scene;
    scene.add(this.ball.mesh);
    scene.add(this.ball.getTrailGroup());
    for (const p of this.getAllPlayers()) {
      scene.add(p.group);
    }
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.ball.mesh);
    scene.remove(this.ball.getTrailGroup());
    for (const p of this.getAllPlayers()) {
      scene.remove(p.group);
    }
    const orbMesh = this.powerupVisuals.getOrbMesh();
    if (orbMesh) {
      scene.remove(orbMesh);
      this.powerupVisuals.removeOrb();
    }
    this.scene = null;
  }

  start(): void {
    // Give ball to first home player
    this.setBallHolder(this.homePlayers[0].data.id);
    this.matchEngine.state.phase = 'playing';
    this.changePossession('home', 'game start');
  }

  update(dt: number): void {
    // === INBOUND AUTO-PASS ===
    if (this.inboundTimer > 0) {
      this.inboundTimer -= dt;
      if (this.inboundTimer <= 0 && this.inbounderId && this.inboundTargetId) {
        const inbounder = this.getPlayerById(this.inbounderId);
        const target = this.getPlayerById(this.inboundTargetId);
        if (inbounder && target && inbounder.hasBall) {
          inbounder.loseBall();
          this.ball.passTo(target.position);
          this.pendingPassTarget = this.inboundTargetId;
        }
        this.inbounderId = null;
        this.inboundTargetId = null;
      }
    }

    // GLOBAL DESYNC CHECK: runs every frame, not just during runAI
    if (this.ball.heldBy) {
      const holderTeam = this.getPlayerTeam(this.ball.heldBy);
      if (this.matchEngine.state.possession !== holderTeam) {
        this.changePossession(holderTeam, `desync fix — ${this.ball.heldBy} holds ball`);
      }
    }

    // === DEAD BALL PHASE (after score) ===
    if (this.matchEngine.state.phase === 'transitioning') {
      this.deadBallTimer -= dt;
      // All players move toward reset positions
      for (const p of this.getAllPlayers()) {
        if (p.data.id === this.humanPlayerId) continue;
        if (p.aiTarget) p.moveToward(p.aiTarget, dt);
        p.animate(dt);
      }
      // When timer expires, give ball and resume
      if (this.deadBallTimer <= 0) {
        this.resumeAfterDeadBall();
      }
      return;
    }

    // === LIVE PLAY ===

    // Update ball position
    if (this.ball.heldBy) {
      const holder = this.getPlayerById(this.ball.heldBy);
      if (holder) this.ball.followHolder(holder.group, holder.hasBall && !holder.isJumping, holder.dribblePhase);
    } else {
      this.ball.update(dt);
    }

    // Mid-dunk ball release: at the slam phase, release ball directly into hoop
    if (this.pendingDunkShooterId) {
      const dunker = this.getPlayerById(this.pendingDunkShooterId);
      if (dunker && !dunker.isDunking) {
        // Dunk animation finished — release ball if still held
        if (this.ball.heldBy === this.pendingDunkShooterId) {
          const team = this.getPlayerTeam(this.pendingDunkShooterId);
          const hoop = this.getTeamAttackHoop(team);
          dunker.loseBall();
          this.ball.shootAt(hoop, 1.0);
        }
        this.pendingDunkShooterId = null;
      } else if (dunker && dunker.isDunking) {
        // Check if we're past the slam phase (35% = 0.42s elapsed, timer < 0.78)
        // Release ball at slam point so it goes straight down into hoop
        if (dunker.dunkTimer < 0.78 && this.ball.heldBy === this.pendingDunkShooterId) {
          const team = this.getPlayerTeam(this.pendingDunkShooterId);
          const hoop = this.getTeamAttackHoop(team);
          dunker.loseBall();
          // Ball drops straight into hoop from above
          this.ball.mesh.position.set(hoop.x, hoop.y + 0.5, hoop.z);
          this.ball.shootAt(hoop, 0.3);
        }
      }
    }

    // Shot detection: tick cooldown every frame
    this.shotDetector.tick(dt);

    // Check for made shots only when ball is in flight
    if (this.ball.isInFlight) {
      // Determine which hoop the shooter was aiming at
      const shooterTeam = this.getPlayerTeam(this.lastShooterId);
      const targetHoop = this.getTeamAttackHoop(shooterTeam);
      this.shotDetector.setHoopPosition(targetHoop);

      const result = this.shotDetector.check(
        this.ball.mesh.position,
        this.ball.velocity,
        this.ball.isInFlight
      );
      if (result.made) {
        const shooterId = this.lastShooterId;
        const team = this.getPlayerTeam(shooterId);
        const shooter = shooterId ? this.getPlayerById(shooterId) : undefined;
        const shotType = this.shotDetector.classifyShot(
          shooter?.position ?? this.ball.mesh.position
        );

        const distance = shooter ? shooter.distanceTo(targetHoop) : 10;
        const defDist = shooter ? this.getNearestOpponentDist(shooter) : 5;

        // Compute active contest bonus from guarding/blocking defenders
        let contestBonus = 0;
        let isDefenderGuarding = false;
        const shooterPos = shooter?.position ?? this.ball.mesh.position;
        const defTeam = this.getPlayerTeam(this.lastShooterId) === 'home' ? this.awayPlayers : this.homePlayers;
        for (const def of defTeam) {
          const d = def.distanceTo(shooterPos);
          if (def.isGuarding && d < 2) {
            isDefenderGuarding = true;
          }
          if (def.isJumping && def.isBlocking && d < 3) {
            contestBonus = Math.max(contestBonus, 0.3);
          }
        }

        const goesIn = calculateShotSuccess({
          distance,
          shootingStat: shooter?.data.stats.shooting ?? 5,
          defenderDistance: defDist,
          shotType,
          chargeMultiplier: this.lastChargeMultiplier,
          contestBonus,
          isDefenderGuarding,
        });
        this.lastChargeMultiplier = 1.0; // reset after use

        if (goesIn) {
          this.handleMadeShot(team, shotType);
        } else {
          // Miss — ball rebounds off rim in random direction
          this.ball.isInFlight = false;

          // Random rebound direction — more variety
          const rimX = this.getTeamAttackHoop(this.getPlayerTeam(this.lastShooterId)).x;
          const rimZ = this.getTeamAttackHoop(this.getPlayerTeam(this.lastShooterId)).z;

          // Ball bounces in a random direction from the rim
          const reboundAngle = Math.random() * Math.PI * 2;
          const reboundForce = 2 + Math.random() * 3;
          this.ball.velocity.set(
            Math.cos(reboundAngle) * reboundForce,
            1.5 + Math.random() * 2, // upward bounce
            Math.sin(reboundAngle) * reboundForce
          );
          // Position ball near the rim
          this.ball.mesh.position.set(
            rimX + (Math.random() - 0.5) * 0.5,
            3.0, // rim height
            rimZ + (Math.random() - 0.5) * 0.5
          );

          this.events.emit('splash', { text: 'MISS!', color: '#e74c3c' });
        }
      }
    }

    // Pass lane interception: defenders in the path auto-deflect
    if (this.ball.isInFlight && this.pendingPassTarget && this.ball.passTarget) {
      const opponents = this.matchEngine.state.possession === 'home' ? this.awayPlayers : this.homePlayers;
      const ballPos = { x: this.ball.mesh.position.x, z: this.ball.mesh.position.z };
      const targetPos = { x: this.ball.passTarget.x, z: this.ball.passTarget.z };

      for (const def of opponents) {
        if (def.distanceTo(this.ball.mesh.position) > 1.5) continue;
        if (isInPassLane(ballPos, targetPos, { x: def.position.x, z: def.position.z }, 1.0)) {
          if (Math.random() < 0.30) {
            this.ball.isInFlight = false;
            this.ball.clearPassTarget();
            this.ball.velocity.set((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4);
            this.pendingPassTarget = null;
            this.events.emit('splash', { text: 'DEFLECTED!', color: '#f39c12' });
            break;
          }
        }
      }
    }

    // Ball out of bounds detection (in-flight going way out)
    if (this.ball.isInFlight) {
      const ballPos = this.ball.mesh.position;
      const courtHalfWidth = 7.5;
      const courtHalfLength = this.mode === '5v5' ? 14 : 7;

      if (Math.abs(ballPos.x) > courtHalfWidth + 5 || Math.abs(ballPos.z) > courtHalfLength + 5 || ballPos.y < -1) {
        this.ball.isInFlight = false;
        this.ball.velocity.set(0, 0, 0);
      }
    }

    // Check for loose ball pickup
    if (!this.ball.heldBy && !this.ball.isInFlight) {
      this.checkBallPickup();
    }

    // Also check pickup during in-flight passes (receiver catches in stride)
    if (!this.ball.heldBy && this.ball.isInFlight && this.pendingPassTarget) {
      this.checkBallPickup();
    }

    // Ball out of bounds detection (loose ball)
    if (!this.ball.heldBy && !this.ball.isInFlight) {
      const ballPos = this.ball.mesh.position;
      const courtHalfWidth = 7.5;
      const courtHalfLength = this.mode === '5v5' ? 14 : 7;

      if (Math.abs(ballPos.x) > courtHalfWidth || Math.abs(ballPos.z) > courtHalfLength) {
        this.events.emit('splash', { text: 'BALL DROPPED!', color: '#95a5a6' });
        const currentPossession = this.matchEngine.state.possession;
        const otherTeam: 'home' | 'away' = currentPossession === 'home' ? 'away' : 'home';

        const inboundX = THREE.MathUtils.clamp(ballPos.x, -courtHalfWidth + 1, courtHalfWidth - 1);
        const inboundZ = THREE.MathUtils.clamp(ballPos.z, -courtHalfLength + 1, courtHalfLength - 1);
        this.ball.mesh.position.set(inboundX, 1, inboundZ);
        this.ball.velocity.set(0, 0, 0);

        const otherPlayers = otherTeam === 'home' ? this.homePlayers : this.awayPlayers;
        let nearest = otherPlayers[0];
        let nearestDist = Infinity;
        for (const p of otherPlayers) {
          const d = p.distanceTo(this.ball.mesh.position);
          if (d < nearestDist) { nearestDist = d; nearest = p; }
        }
        this.setBallHolder(nearest.data.id);
        this.changePossession(otherTeam, 'ball out of bounds');
      }
    }

    // Loose ball — everyone chases
    if (!this.ball.heldBy && !this.ball.isInFlight) {
      for (const p of this.getAllPlayers()) {
        if (p.data.id === this.humanPlayerId) continue;
        p.aiTarget = this.ball.mesh.position.clone();
        p.moveToward(p.aiTarget, dt);
      }
    } else {
      // Normal AI positioning
      this.runAI(dt);
    }

    // Animate all players
    for (const player of this.getAllPlayers()) {
      player.animate(dt);
    }

    // Make AI players face the ball/ball holder
    this.updateAIFacing();

    // Update match engine clock
    if (this.matchEngine.state.phase === 'playing') {
      this.matchEngine.tickClock(dt);
    }

    // Powerup system
    this.updatePowerups(dt);

    // AI stamina management
    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue;
      if (player.isSprinting && player.stamina > 0 && !player.isExhausted) {
        player.stamina -= 0.3 * dt;
        if (player.stamina <= 0) {
          player.stamina = 0;
          player.isExhausted = true;
          player.isSprinting = false;
        }
      } else if (!player.isSprinting) {
        player.stamina = Math.min(1.0, player.stamina + 0.2 * dt);
        if (player.isExhausted && player.stamina >= 0.3) {
          player.isExhausted = false;
        }
      }
    }
  }

  processInput(input: ControlInput, dt: number): void {
    if (this.matchEngine.state.phase === 'transitioning') return;
    const human = this.getHumanPlayer();
    if (!human) return;

    // Lock movement during dunk — player moves toward hoop via animation
    if (human.isDunking) {
      if (input.gesture) input.gesture = null;
      return;
    }

    // Charge-up: lock in place while charging
    if (human.isCharging) {
      human.chargeTimer = Math.min(human.chargeTimer + dt, 1.5);
      this.hapticManager?.onCharge(human.chargeTimer / 1.5);
      // Still process gesture (for release), but zero movement
      if (input.gesture) {
        this.handleGesture(input.gesture, human);
        input.gesture = null;
      }
      return; // skip all movement
    }

    // Transform joystick input to camera-relative world space
    let worldX = input.joystick.x;
    let worldZ = input.joystick.y; // screen Y -> world Z

    if (this.cameraRef) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cameraRef.quaternion);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.cameraRef.quaternion);
      right.y = 0;
      right.normalize();

      worldX = right.x * input.joystick.x + forward.x * (-input.joystick.y);
      worldZ = right.z * input.joystick.x + forward.z * (-input.joystick.y);
    }

    // Stamina-gated sprinting
    const wantsSprint = input.sprinting ?? false;
    if (wantsSprint && human.stamina > 0 && !human.isExhausted) {
      human.isSprinting = true;
      human.stamina -= 0.3 * dt;
      if (human.stamina <= 0) {
        human.stamina = 0;
        human.isExhausted = true;
        human.isSprinting = false;
      }
    } else {
      human.isSprinting = false;
      human.stamina = Math.min(1.0, human.stamina + 0.2 * dt);
      if (human.isExhausted && human.stamina >= 0.3) {
        human.isExhausted = false;
      }
    }
    human.moveByInput(worldX, worldZ, dt);

    if (input.gesture) {
      this.handleGesture(input.gesture, human);
      input.gesture = null;
    }
  }

  handleMadeShot(team: Possession, shotType: ShotType): void {
    console.log(`[SCORE] ${team} scores ${shotType}`);
    // Trigger slam cam for dunks
    const scoringHoop = this.getTeamAttackHoop(team);
    if (shotType === 'dunk' || shotType === 'alley-oop' || shotType === 'powerup-dunk') {
      this.slamCamRequested = true;
      this.slamCamPosition = scoringHoop.clone();
    }

    // Splash text for scores
    if (shotType === 'dunk' || shotType === 'powerup-dunk') {
      this.events.emit('splash', { text: 'SLAAAAAAMMM DUNK!!!!', color: '#ff4500' });
    } else {
      this.events.emit('splash', { text: 'SCORE!!!', color: '#2ecc71' });
    }

    this.matchEngine.score(team, shotType);
    this.ball.isInFlight = false;

    // Enter dead ball phase — NO HOOP SWAP
    const receivingTeam: 'home' | 'away' = team === 'home' ? 'away' : 'home';
    this.enterDeadBall(receivingTeam);
  }

  setBallHolder(playerId: string): void {
    for (const p of this.getAllPlayers()) {
      p.loseBall();
    }
    const player = this.getPlayerById(playerId);
    if (player) {
      player.giveBall();
      this.ball.pickup(playerId);
      this.pendingPassTarget = null;
    }
  }

  getCameraInfo(): CameraInfo {
    if (this.slamCamRequested) {
      this.slamCamRequested = false;
      return {
        mode: 'slam' as CameraMode,
        trackPosition: this.slamCamPosition!,
        lookAt: this.slamCamPosition!,
      };
    }

    const ballPos = this.ball.heldBy
      ? this.getPlayerById(this.ball.heldBy)?.position ?? this.ball.mesh.position
      : this.ball.mesh.position;

    return {
      mode: 'broadcast' as CameraMode,
      trackPosition: ballPos.clone(),
      lookAt: new THREE.Vector3(0, 1.5, ballPos.z),
    };
  }

  getHumanPlayer(): GamePlayer {
    return this.getAllPlayers().find(p => p.data.id === this.humanPlayerId)!;
  }

  getAllPlayers(): GamePlayer[] {
    return [...this.homePlayers, ...this.awayPlayers];
  }

  getPlayerById(id: string): GamePlayer | undefined {
    return this.getAllPlayers().find(p => p.data.id === id);
  }

  getPlayerTeam(playerId: string | null): Possession {
    if (!playerId) return 'home';
    return this.homePlayers.some(p => p.data.id === playerId) ? 'home' : 'away';
  }

  private changePossession(newTeam: 'home' | 'away', reason: string): void {
    const oldTeam = this.matchEngine.state.possession;
    if (oldTeam !== newTeam) {
      console.log(`[POSSESSION] ${oldTeam} → ${newTeam} (${reason})`);
    }
    this.matchEngine.state.possession = newTeam;
    this.matchEngine.resetShotClock();
    this.aiShootTimer = 0;
    this.tabCycleIndex = 0;
  }

  getGameOverData(): GameOverData {
    const humanPlayer = this.getHumanPlayer();
    const humanTeam = this.getPlayerTeam(this.humanPlayerId);
    const winner: 'home' | 'away' = this.matchEngine.state.homeScore >= this.matchEngine.state.awayScore ? 'home' : 'away';
    const humanWon = winner === humanTeam;

    const xp = ProgressionSystem.calculateXP({
      won: humanWon,
      points: humanPlayer.performanceScore,
      assists: 0,
      subbedIn: false,
    });

    return {
      winner,
      homeScore: this.matchEngine.state.homeScore,
      awayScore: this.matchEngine.state.awayScore,
      humanTeam,
      humanWon,
      humanStats: {
        points: humanTeam === 'home' ? this.matchEngine.state.homeScore : this.matchEngine.state.awayScore,
        assists: 0,
        steals: 0,
      },
      xpEarned: Math.max(0, xp),
      coinsEarned: humanWon ? 50 : 10,
      gameDuration: 180 - this.matchEngine.state.clockSeconds,
    };
  }

  private switchHumanControl(newPlayerId: string): void {
    const oldHuman = this.getHumanPlayer();
    const newHuman = this.getPlayerById(newPlayerId);
    if (!oldHuman || !newHuman || newPlayerId === this.humanPlayerId) return;

    oldHuman.isHumanControlled = false;
    this.playerAIs.set(oldHuman.data.id, new PlayerAI(oldHuman.data.stats, oldHuman.data.personality));

    this.humanPlayerId = newPlayerId;
    newHuman.isHumanControlled = true;
    this.playerAIs.delete(newPlayerId);
  }

  private cyclePlayerControl(): void {
    const humanTeam = this.getPlayerTeam(this.humanPlayerId);
    const teamPlayers = humanTeam === 'home' ? this.homePlayers : this.awayPlayers;
    const possession = this.matchEngine.state.possession;
    const onOffense = possession === humanTeam;
    const humanHasBall = this.getHumanPlayer()?.hasBall ?? false;

    if (onOffense && !humanHasBall) {
      // On offense without ball: switch to ball carrier
      const carrier = teamPlayers.find(p => p.hasBall);
      if (carrier && carrier.data.id !== this.humanPlayerId) {
        this.switchHumanControl(carrier.data.id);
        this.tabCycleIndex = 0;
      }
      return;
    }

    // Defense, loose ball, or offense with ball: cycle through teammates
    const ballPos = this.ball.heldBy
      ? this.getPlayerById(this.ball.heldBy)?.position ?? this.ball.mesh.position
      : this.ball.mesh.position;

    const candidates = teamPlayers
      .filter(p => p.data.id !== this.humanPlayerId)
      .sort((a, b) => a.distanceTo(ballPos) - b.distanceTo(ballPos));

    if (candidates.length === 0) return;

    this.tabCycleIndex = this.tabCycleIndex % candidates.length;
    const target = candidates[this.tabCycleIndex];
    this.switchHumanControl(target.data.id);
    this.tabCycleIndex = (this.tabCycleIndex + 1) % candidates.length;
  }

  // --- Private methods ---

  private handleGesture(gesture: GestureResult, human: GamePlayer): void {
    const hasBall = human.hasBall;

    switch (gesture.type) {
      case 'charge-start':
        if (hasBall) {
          human.isCharging = true;
          human.chargeTimer = 0;
        }
        break;

      case 'block':
        if (!hasBall) {
          human.triggerGuard();
          this.hapticManager?.onBlock();
        }
        break;

      case 'jump-block':
        if (!hasBall) {
          human.jump();
          human.isBlocking = true;
        }
        break;

      case 'cycle-player':
        this.cyclePlayerControl();
        break;

      case 'swipe-up':
        if (hasBall) {
          this.hapticManager?.onShoot();
          const humanTeam = this.getPlayerTeam(this.humanPlayerId);
          const targetHoop = this.getTeamAttackHoop(humanTeam);
          const dist = human.distanceTo(targetHoop);
          const chargeLevel = human.chargeTimer / 1.5;

          // Calculate charge multiplier
          let chargeMultiplier = 1.0;
          if (chargeLevel < 0.5) {
            chargeMultiplier = 0.5 + chargeLevel;
          } else if (chargeLevel >= 0.8) {
            chargeMultiplier = 1.5;
          } else {
            chargeMultiplier = 1.0 + (chargeLevel - 0.5) / 0.3 * 0.5;
          }

          human.isCharging = false;
          human.chargeTimer = 0;

          // DUNK PATH: in the paint close to hoop + stamina threshold
          if (isInDunkZone(human.position, targetHoop) && human.stamina >= 0.1) {
            const opponents = humanTeam === 'home' ? this.awayPlayers : this.homePlayers;

            // Only a jump-block can contest a dunk
            let jumpBlocked = false;
            for (const def of opponents) {
              if (def.isJumping && def.isBlocking && def.distanceTo(targetHoop) < 3) {
                jumpBlocked = true;
                break;
              }
            }

            if (jumpBlocked) {
              human.loseBall();
              human.triggerFall();
              this.ball.release();
              this.ball.velocity.set((Math.random() - 0.5) * 5, 3, (Math.random() - 0.5) * 5);
              this.events.emit('splash', { text: 'BLOCKED!', color: '#e74c3c' });
              break;
            }

            // Knock down any standing defender near the dunker
            for (const def of opponents) {
              if (!def.isJumping && def.distanceTo(human.position) < 2) {
                def.triggerFall();
              }
            }

            // Dunk always succeeds — player carries ball to the rim
            human.triggerDunk({ x: targetHoop.x, z: targetHoop.z });
            this.lastShooterId = human.data.id;
            this.pendingDunkShooterId = human.data.id;
            this.events.emit('splash', { text: 'SLAM DUNK!', color: '#2ecc71' });
          } else {
            // SHOT PATH: normal charge-up shot
            human.loseBall();
            human.triggerShoot();
            this.lastShooterId = human.data.id;
            this.lastChargeMultiplier = chargeMultiplier;

            const { target: shotTarget, clamped } = clampShotTarget(
              human.position, targetHoop, 12
            );
            this.ball.shootAt(shotTarget, gesture.power);

            if (clamped) {
              this.events.emit('splash', { text: 'AIR BALL!', color: '#95a5a6' });
            }
          }
        }
        break;

      case 'pass':
        if (hasBall) {
          const teammates = this.getTeammates(human);
          const candidates = teammates.map(t => ({ id: t.data.id, x: t.position.x, z: t.position.z }));
          const passTarget = findBestPassTarget(
            { x: human.position.x, z: human.position.z, facingAngle: human.group.rotation.y },
            candidates
          );
          const teammate = passTarget ? teammates.find(t => t.data.id === passTarget.id) ?? null : null;
          if (teammate) {
            human.loseBall();
            this.ball.passTo(teammate.position);
            this.pendingPassTarget = teammate.data.id;

            this.switchHumanControl(teammate.data.id);
          }
        }
        break;

      case 'tap':
        if (!hasBall) {
          this.attemptSteal(human);
          this.hapticManager?.onSteal();
        }
        break;

      case 'jump':
        human.jump();
        break;

      case 'double-tap':
        break;
    }
  }

  // --- Dead Ball System (replaces resetAfterScore + hoop swapping) ---

  private enterDeadBall(receivingTeam: 'home' | 'away'): void {
    console.log(`[DEAD BALL] inbound to ${receivingTeam}`);
    this.shotDetector.reset();

    // No pause — instant positioning and resume
    const receivingPlayers = receivingTeam === 'home' ? this.homePlayers : this.awayPlayers;
    const inbounder = receivingPlayers[receivingPlayers.length - 1]; // last player inbounds
    const pg = receivingPlayers[0]; // PG receives

    // Position inbounder OUTSIDE baseline (1.5 units past court)
    const defendHoop = this.getTeamDefendHoop(receivingTeam);
    const baselineZ = defendHoop.z + (defendHoop.z < 0 ? -1.5 : 1.5);
    inbounder.group.position.set(0, 0, baselineZ);

    // Give ball to inbounder
    this.ball.release();
    this.ball.mesh.visible = true;
    this.setBallHolder(inbounder.data.id);

    // PG positions near baseline ON court to receive
    const pgZ = defendHoop.z + (defendHoop.z < 0 ? 2 : -2);
    pg.group.position.set(2, 0, pgZ);

    // Set inbound timer — auto-pass after 0.5s
    this.inboundTimer = 0.5;
    this.inbounderId = inbounder.data.id;
    this.inboundTargetId = pg.data.id;

    // Resume to 'playing' phase immediately — other players move naturally during live play
    this.changePossession(receivingTeam, 'dead ball inbound');
    this.matchEngine.state.phase = 'playing';
    this.deadBallReceivingTeam = null;
  }

  private setTeamPositions(team: 'home' | 'away'): void {
    const players = team === 'home' ? this.homePlayers : this.awayPlayers;
    const attackHoop = this.getTeamAttackHoop(team);
    const possession = this.matchEngine.state.possession;
    const onOffense = possession === team;

    if (onOffense) {
      players.forEach((p) => {
        p.group.position.copy(this.getOffensivePosition(p, attackHoop));
      });
    } else {
      const defendHoop = this.getTeamDefendHoop(team);
      const defSpots: [number, number][] = [[0, 3], [-3, 5], [3, 5], [-5, 7], [5, 7]];
      const dir = defendHoop.z > 0 ? -1 : 1;
      players.forEach((p, i) => {
        const [x, z] = defSpots[i] ?? [0, 5];
        p.group.position.set(x, 0, defendHoop.z + z * dir);
      });
    }
  }

  private resumeAfterDeadBall(): void {
    // No longer used — enterDeadBall handles everything instantly
    // Kept for safety in case transitioning phase is somehow reached
    if (!this.deadBallReceivingTeam) return;

    const receiver = this.deadBallReceivingTeam === 'home' ? this.homePlayers[0] : this.awayPlayers[0];

    const defendHoop = this.getTeamDefendHoop(this.deadBallReceivingTeam);
    const baselineZ = defendHoop.z + (defendHoop.z < 0 ? 1 : -1);

    this.ball.mesh.position.set(0, 1, baselineZ);
    this.ball.velocity.set(0, 0, 0);
    this.ball.mesh.visible = true;
    this.setBallHolder(receiver.data.id);
    this.changePossession(this.deadBallReceivingTeam, 'resume after dead ball');

    this.deadBallReceivingTeam = null;
  }

  // --- New AI System (replaces runAIDecisions, moveAIPlayers, moveToFormation) ---

  private runAI(dt: number): void {
    const possession = this.matchEngine.state.possession;

    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue;
      if (this.aiDisabledPlayers.has(player.data.id)) continue;

      const isHome = this.isHomePlayer(player);
      const myTeam: 'home' | 'away' = isHome ? 'home' : 'away';
      const onOffense = possession === myTeam;
      const attackHoop = this.getTeamAttackHoop(myTeam);
      const defendHoop = this.getTeamDefendHoop(myTeam);

      let target: THREE.Vector3;

      if (onOffense) {
        if (player.hasBall) {
          // BALL HANDLER: always sprint toward attacking hoop
          player.isSprinting = player.stamina > 0 && !player.isExhausted;
          const distToHoop = player.distanceTo(attackHoop);
          if (distToHoop > 4) {
            // Drive toward hoop
            target = attackHoop.clone();
          } else {
            // In range — make a decision
            this.handleBallHandlerAI(player, attackHoop, dt);
            continue;
          }
        } else {
          // OFF-BALL OFFENSE: base position + dynamic drift
          const basePos = this.getOffensivePosition(player, attackHoop);

          // Add periodic drift within ~2 units of base spot
          const time = performance.now() * 0.001;
          const playerSeed = player.data.id.charCodeAt(0); // unique per player
          const driftX = Math.sin(time * 0.8 + playerSeed) * 2;
          const driftZ = Math.cos(time * 0.6 + playerSeed * 1.5) * 1.5;

          target = new THREE.Vector3(
            basePos.x + driftX,
            0,
            basePos.z + driftZ
          );

          // If nearest defender is very close (<2 units), move AWAY from them to get open
          const nearestDefDist = this.getNearestOpponentDist(player);
          if (nearestDefDist < 2) {
            const opponents = this.isHomePlayer(player) ? this.awayPlayers : this.homePlayers;
            let closestOpp: GamePlayer | null = null;
            let closestDist = Infinity;
            for (const opp of opponents) {
              const d = player.distanceTo(opp.position);
              if (d < closestDist) { closestDist = d; closestOpp = opp; }
            }
            if (closestOpp) {
              const awayDir = new THREE.Vector3()
                .subVectors(player.position, closestOpp.position)
                .normalize()
                .multiplyScalar(2);
              target.add(awayDir);
            }
          }
        }
      } else {
        // DEFENSE: zone-based positioning near defending hoop
        target = this.getZoneDefensePosition(player, defendHoop);

        // React to human charging — jump to block
        const humanPlayer = this.getHumanPlayer();
        if (humanPlayer?.isCharging && humanPlayer.chargeTimer > 0.75) {
          const distToShooter = player.distanceTo(humanPlayer.position);
          if (distToShooter < 5) {
            player.jump();
          }
        }
      }

      player.aiTarget = target;
      player.moveToward(target, dt);
    }
  }

  private getOffensivePosition(player: GamePlayer, attackHoop: THREE.Vector3): THREE.Vector3 {
    const team = this.isHomePlayer(player) ? this.homePlayers : this.awayPlayers;
    const idx = team.indexOf(player);

    // Standard basketball offensive spots (spread wider)
    // [xOffset, zOffsetFromHoop (toward center court)]
    const offsets: [number, number][] = [
      [0, 9],    // PG: top of key (further out)
      [-6, 6],   // SG: left wing (wider)
      [6, 6],    // SF: right wing (wider, symmetric)
      [-3, 3],   // PF: left elbow
      [0, 1.5],  // C: deep paint
    ];

    const [xOff, zOff] = offsets[idx] ?? [0, 5];

    // Z direction: toward center court from the hoop
    const zDir = attackHoop.z > 0 ? -1 : 1;

    return new THREE.Vector3(xOff, 0, attackHoop.z + zOff * zDir);
  }

  private getZoneDefensePosition(player: GamePlayer, defendHoop: THREE.Vector3): THREE.Vector3 {
    const team = this.isHomePlayer(player) ? this.homePlayers : this.awayPlayers;
    const idx = team.indexOf(player);

    const zones: [number, number][] = [
      [0, 7],   // PG: top of key
      [-4, 5],  // SG: left wing
      [4, 5],   // SF: right wing
      [-2, 3],  // PF: left block
      [0, 2],   // C: paint
    ];

    const [baseX, baseZ] = zones[idx] ?? [0, 4];
    const zDir = defendHoop.z > 0 ? -1 : 1;

    let targetX = baseX;
    let targetZ = defendHoop.z + baseZ * zDir;

    // Drift 30% toward ball for help defense
    const ballPos = this.ball.heldBy
      ? this.getPlayerById(this.ball.heldBy)?.position ?? this.ball.mesh.position
      : this.ball.mesh.position;
    targetX = targetX * 0.7 + ballPos.x * 0.3;
    targetZ = targetZ * 0.7 + ballPos.z * 0.3;

    // Add subtle sway so defenders aren't statues
    const time = performance.now() * 0.001;
    const seed = player.data.id.charCodeAt(0);
    targetX += Math.sin(time * 0.5 + seed) * 0.5;
    targetZ += Math.cos(time * 0.4 + seed * 2) * 0.5;

    return new THREE.Vector3(targetX, 0, targetZ);
  }

  private handleBallHandlerAI(player: GamePlayer, attackHoop: THREE.Vector3, dt: number): void {
    this.aiShootTimer += dt;
    const dist = player.distanceTo(attackHoop);
    const nearestDef = this.getNearestOpponentDist(player);

    // Always keep driving toward hoop
    player.aiTarget = attackHoop.clone();
    player.moveToward(player.aiTarget, dt);

    // Minimum 0.3s before shooting
    if (this.aiShootTimer < 0.3) return;

    // Close range (< 4) → ALWAYS shoot/dunk regardless of defense
    if (dist < 4) {
      player.loseBall();
      player.triggerShoot();
      this.lastShooterId = player.data.id;
      this.ball.shootAt(attackHoop, 1.0);
      this.aiShootTimer = 0;
      return;
    }

    // Mid-range (< 8) → shoot if somewhat open (defender > 1.5)
    if (dist < 8 && nearestDef > 1.5 && Math.random() < 0.6) {
      player.loseBall();
      player.triggerShoot();
      this.lastShooterId = player.data.id;
      this.ball.shootAt(attackHoop, 0.5 + Math.random() * 0.3);
      this.aiShootTimer = 0;
      return;
    }

    // Three-point range (< 11) → shoot if open (defender > 2)
    if (dist < 11 && nearestDef > 2 && Math.random() < 0.4) {
      player.loseBall();
      player.triggerShoot();
      this.lastShooterId = player.data.id;
      this.ball.shootAt(attackHoop, 0.4 + Math.random() * 0.3);
      this.aiShootTimer = 0;
      return;
    }

    // Been holding too long (> 3 seconds) → force a shot from anywhere
    if (this.aiShootTimer > 3 && dist < 12) {
      player.loseBall();
      player.triggerShoot();
      this.lastShooterId = player.data.id;
      this.ball.shootAt(attackHoop, 0.3 + Math.random() * 0.4);
      this.aiShootTimer = 0;
      return;
    }

    // Contested → try to pass, but if timer > 2s, shoot contested anyway
    if (nearestDef < 1.5) {
      if (this.aiShootTimer > 2 && dist < 8) {
        // Forced contested shot
        player.loseBall();
        player.triggerShoot();
        this.lastShooterId = player.data.id;
        this.ball.shootAt(attackHoop, 0.3 + Math.random() * 0.3);
        this.aiShootTimer = 0;
        return;
      }
      // Try to pass
      const teammates = this.getTeammates(player);
      const openMate = teammates.find(t => this.getNearestOpponentDist(t) > 1.5);
      if (openMate) {
        player.loseBall();
        this.ball.passTo(openMate.position);
        this.pendingPassTarget = openMate.data.id;
        // DO NOT reset aiShootTimer here — let it accumulate
      }
      return;
    }
  }

  // --- Helpers ---

  private updateAIFacing(): void {
    const ballTarget = this.ball.heldBy
      ? this.getPlayerById(this.ball.heldBy)?.position ?? this.ball.mesh.position
      : this.ball.mesh.position;

    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue;
      const dx = ballTarget.x - player.position.x;
      const dz = ballTarget.z - player.position.z;
      if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
        player.group.rotation.y = Math.atan2(dx, dz);
      }
    }
  }

  private updatePowerups(dt: number): void {
    this.powerupSystem.tick(dt);
    const diff = this.matchEngine.getScoreDifferential();
    if (diff) {
      const playerPositions = this.getAllPlayers().map((p) => ({
        x: p.position.x,
        z: p.position.z,
      }));
      this.powerupSystem.update(diff.deficit, dt, playerPositions);
    }

    // Spawn visual orb when powerup system has one
    if (this.powerupSystem.activeOrb && !this.powerupVisuals.hasActiveOrb()) {
      const orb = this.powerupSystem.activeOrb;
      this.powerupVisuals.spawnOrb(orb.type, orb.position);
      if (this.scene) this.scene.add(this.powerupVisuals.getOrbMesh()!);
    }

    // Animate orb
    this.powerupVisuals.update(dt);

    // Check pickup by losing team players
    if (this.powerupVisuals.hasActiveOrb() && diff) {
      const losingPlayers = diff.losingTeam === 'home' ? this.homePlayers : this.awayPlayers;
      for (const p of losingPlayers) {
        if (this.powerupVisuals.checkPickup(p.position)) {
          const type = this.powerupSystem.activeOrb?.type ?? null;
          this.powerupSystem.pickupOrb(diff.losingTeam);
          const orbMesh = this.powerupVisuals.getOrbMesh();
          if (orbMesh && this.scene) this.scene.remove(orbMesh);
          this.powerupVisuals.removeOrb();
          this.lastPowerupPickup = type;
          break;
        }
      }
    }
  }

  private checkBallPickup(): void {
    const ballPos = this.ball.mesh.position;
    let closest: GamePlayer | null = null;
    let closestDist = 1.0; // pickup radius

    for (const p of this.getAllPlayers()) {
      const d = p.distanceTo(ballPos);
      if (d < closestDist) {
        // While a pass is pending, only same-team players can pick up
        if (this.pendingPassTarget) {
          const passTeam = this.getPlayerTeam(this.pendingPassTarget);
          const playerTeam = this.getPlayerTeam(p.data.id);
          if (playerTeam !== passTeam) continue;
        }
        closestDist = d;
        closest = p;
      }
    }

    if (closest) {
      this.setBallHolder(closest.data.id);

      // Update possession to match who actually has the ball
      const pickupTeam = this.getPlayerTeam(closest.data.id);
      if (this.matchEngine.state.possession !== pickupTeam) {
        this.changePossession(pickupTeam, `ball pickup by ${closest.data.id}`);
      }

      // Auto-switch human control on rebound/loose ball pickup
      const humanTeam = this.getPlayerTeam(this.humanPlayerId);
      if (pickupTeam === humanTeam && closest.data.id !== this.humanPlayerId && !this.pendingPassTarget) {
        this.switchHumanControl(closest.data.id);
      }

      if (this.pendingPassTarget === closest.data.id) {
        this.pendingPassTarget = null;
      }
    }
  }

  private attemptSteal(stealer: GamePlayer): void {
    // BRANCH 1: Deflect an in-flight pass
    if (!this.ball.heldBy && this.pendingPassTarget && this.ball.isInFlight) {
      if (stealer.distanceTo(this.ball.mesh.position) > 1.5) return;
      stealer.triggerSteal();
      if (Math.random() < 0.4) {
        // Deflected — ball becomes loose
        this.ball.isInFlight = false;
        this.ball.clearPassTarget();
        this.ball.velocity.set((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4);
        this.pendingPassTarget = null;
        this.events.emit('splash', { text: 'DEFLECTED!', color: '#f39c12' });
      }
      return;
    }

    // BRANCH 2: Normal steal from ball holder
    const ballHolder = this.getAllPlayers().find(p => p.hasBall);
    if (!ballHolder) return;
    if (stealer.distanceTo(ballHolder.position) > 2) return;

    stealer.triggerSteal();

    const roll = Math.random();
    if (roll < 0.3) {
      ballHolder.loseBall();
      ballHolder.recordStat('turnovers', 1);
      this.setBallHolder(stealer.data.id);
      const stealerTeam = this.getPlayerTeam(stealer.data.id);
      if (this.matchEngine.state.possession !== stealerTeam) {
        this.changePossession(stealerTeam, `steal by ${stealer.data.id}`);
      }
      this.events.emit('splash', { text: 'STEAL!', color: '#f39c12' });
    } else if (roll < 0.6) {
      const stealerTeam = this.getPlayerTeam(stealer.data.id);
      this.matchEngine.callFoul(stealerTeam);
      const receivingTeam: 'home' | 'away' = stealerTeam === 'home' ? 'away' : 'home';
      this.enterDeadBall(receivingTeam);
    }
  }

  private findNearestTeammate(player: GamePlayer): GamePlayer | null {
    const teammates = this.getTeammates(player);
    let nearest: GamePlayer | null = null;
    let minDist = Infinity;
    for (const tm of teammates) {
      const d = player.distanceTo(tm.position);
      if (d < minDist) {
        minDist = d;
        nearest = tm;
      }
    }
    return nearest;
  }

  isHomePlayer(player: GamePlayer): boolean {
    return this.homePlayers.includes(player);
  }

  private getTeammates(player: GamePlayer): GamePlayer[] {
    const team = this.isHomePlayer(player) ? this.homePlayers : this.awayPlayers;
    return team.filter(p => p !== player);
  }

  private getNearestOpponentDist(player: GamePlayer): number {
    const opponents = this.isHomePlayer(player) ? this.awayPlayers : this.homePlayers;
    let minDist = Infinity;
    for (const opp of opponents) {
      const d = player.distanceTo(opp.position);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }
}
