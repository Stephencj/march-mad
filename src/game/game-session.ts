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
import { TeamAI, type TeamPlay } from '@/ai/team-ai';
import { COURT_DIMENSIONS } from './court';
import { FULL_COURT_DIMENSIONS } from './full-court';
import { getFormation5v5 } from '@/ai/formations-5v5';
import { ProgressionSystem } from '@/meta/progression';
import { PowerupSystem } from '@/systems/powerups';
import { PowerupVisuals } from './powerup-visuals';
import { calculateShotSuccess } from './shot-accuracy';

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
  attackingHoop: THREE.Vector3;
  defendingHoop: THREE.Vector3;

  private mode: GameMode;
  private cameraRef: THREE.Camera | null = null;
  private events: EventBus;
  private humanPlayerId: string;
  private shotDetector: ShotDetector;
  private playerAIs = new Map<string, PlayerAI>();
  private homeTeamAI: TeamAI;
  private awayTeamAI: TeamAI;
  private scene: THREE.Scene | null = null;
  private aiDecisionTimer = 0;
  private readonly AI_DECISION_INTERVAL = 0.2; // seconds between AI decisions (5/sec for responsiveness)
  private lastShooterId: string | null = null;
  private pendingPassTarget: string | null = null;
  private cachedPlays: Record<string, { play: TeamPlay; timestamp: number }> = {};
  private playRefreshInterval = 3; // seconds
  private lastPossession: Possession | null = null;
  private autoSwitchCooldown = 0;
  private slamCamRequested = false;
  private slamCamPosition: THREE.Vector3 | null = null;
  private powerupSystem: PowerupSystem;
  private powerupVisuals = new PowerupVisuals();
  lastPowerupPickup: string | null = null;
  private transitionTimer = 0;
  private pendingReceivingTeam: 'home' | 'away' | null = null;

  constructor(events: EventBus, homeTeam: TeamData, awayTeam: TeamData, humanPlayerId: string, mode: GameMode = '3v3') {
    this.events = events;
    this.mode = mode;
    this.humanPlayerId = humanPlayerId;
    this.ball = new Ball(new THREE.Vector3(0, 1, 2));
    this.matchEngine = new MatchEngine(events, homeTeam, awayTeam);
    this.powerupSystem = new PowerupSystem(events);
    this.homeTeamAI = new TeamAI(homeTeam.archetype);
    this.awayTeamAI = new TeamAI(awayTeam.archetype);

    if (mode === '5v5') {
      this.attackingHoop = FULL_COURT_DIMENSIONS.hoopHome.clone();
      this.defendingHoop = FULL_COURT_DIMENSIONS.hoopAway.clone();
      this.shotDetector = new ShotDetector(this.attackingHoop);
    } else {
      this.attackingHoop = COURT_DIMENSIONS.hoopPosition.clone();
      this.defendingHoop = COURT_DIMENSIONS.hoopPosition.clone();
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

  setCameraRef(camera: THREE.Camera): void {
    this.cameraRef = camera;
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
    this.matchEngine.state.possession = 'home';

    // Initialize AI movement states — stagger initial holds
    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue;
      player.aiMovementState = 'holding';
      player.aiHoldTimer = 0.5 + Math.random() * 1.5;
    }
  }

  update(dt: number): void {
    // Handle transition phase (after score)
    if (this.matchEngine.state.phase === 'transitioning') {
      this.transitionTimer -= dt;

      // Move all players toward their targets
      for (const p of this.getAllPlayers()) {
        if (p.aiTarget) {
          p.moveToward(p.aiTarget, dt);
        }
        p.animate(dt);
      }

      // When transition completes
      if (this.transitionTimer <= 0) {
        if (this.pendingReceivingTeam) {
          const receiver = this.pendingReceivingTeam === 'home' ? this.homePlayers[0] : this.awayPlayers[0];

          // Position ball for inbound
          if (this.mode === '5v5') {
            const baselineZ = this.pendingReceivingTeam === 'home' ? -13 : 13;
            this.ball.mesh.position.set(0, 1, baselineZ * 0.8);
          } else {
            this.ball.mesh.position.set(0, 1, 5); // check-ball line
          }
          this.ball.velocity.set(0, 0, 0);
          this.ball.mesh.visible = true;
          this.setBallHolder(receiver.data.id);
          this.matchEngine.checkBallComplete(this.pendingReceivingTeam);
          this.matchEngine.resetShotClock();
          this.pendingReceivingTeam = null;
        }

        // Stop sprinting, go to holding
        for (const p of this.getAllPlayers()) {
          p.isSprinting = false;
          p.aiMovementState = 'holding';
          p.aiHoldTimer = 0.5;
        }
      }
      return; // Skip normal game logic during transition
    }

    // Update ball position
    if (this.ball.heldBy) {
      const holder = this.getPlayerById(this.ball.heldBy);
      if (holder) this.ball.followHolder(holder.group, holder.hasBall && !holder.isJumping, holder.dribblePhase);
    } else {
      this.ball.update(dt);
    }

    // Shot detection: tick cooldown every frame
    this.shotDetector.tick(dt);

    // Check for made shots only when ball is in flight
    if (this.ball.isInFlight) {
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

        const distance = shooter ? shooter.distanceTo(this.attackingHoop) : 10;
        const defDist = shooter ? this.getNearestOpponentDist(shooter) : 5;

        const goesIn = calculateShotSuccess({
          distance,
          shootingStat: shooter?.data.stats.shooting ?? 5,
          defenderDistance: defDist,
          shotType,
        });

        if (goesIn) {
          this.handleMadeShot(team, shotType);
        } else {
          // Miss — ball bounces off rim
          this.ball.isInFlight = false;
          this.ball.velocity.set(
            (Math.random() - 0.5) * 3,
            2,
            (Math.random() - 0.5) * 3
          );
        }
      }
    }

    // Check for loose ball pickup
    if (!this.ball.heldBy && !this.ball.isInFlight) {
      this.checkBallPickup();
    }

    // Ball out of bounds detection (in-flight going way out)
    if (this.ball.isInFlight) {
      const ballPos = this.ball.mesh.position;
      const courtHalfWidth = 7.5;
      const courtHalfLength = this.mode === '5v5' ? 14 : 7;

      if (Math.abs(ballPos.x) > courtHalfWidth + 5 || Math.abs(ballPos.z) > courtHalfLength + 5 || ballPos.y < -1) {
        // Ball went way out — cancel flight and treat as out of bounds
        this.ball.isInFlight = false;
        this.ball.velocity.set(0, 0, 0);
        // Will be caught by the loose ball OOB check next frame
      }
    }

    // Ball out of bounds detection (loose ball)
    if (!this.ball.heldBy && !this.ball.isInFlight) {
      const ballPos = this.ball.mesh.position;
      const courtHalfWidth = 7.5;
      const courtHalfLength = this.mode === '5v5' ? 14 : 7;

      if (Math.abs(ballPos.x) > courtHalfWidth || Math.abs(ballPos.z) > courtHalfLength) {
        // Ball went out of bounds — give to the other team
        const currentPossession = this.matchEngine.state.possession;
        const otherTeam: 'home' | 'away' = currentPossession === 'home' ? 'away' : 'home';

        // Reset ball to sideline
        const inboundX = THREE.MathUtils.clamp(ballPos.x, -courtHalfWidth + 1, courtHalfWidth - 1);
        const inboundZ = THREE.MathUtils.clamp(ballPos.z, -courtHalfLength + 1, courtHalfLength - 1);
        this.ball.mesh.position.set(inboundX, 1, inboundZ);
        this.ball.velocity.set(0, 0, 0);

        // Give to other team's nearest player
        const otherPlayers = otherTeam === 'home' ? this.homePlayers : this.awayPlayers;
        let nearest = otherPlayers[0];
        let nearestDist = Infinity;
        for (const p of otherPlayers) {
          const d = p.distanceTo(this.ball.mesh.position);
          if (d < nearestDist) { nearestDist = d; nearest = p; }
        }
        this.setBallHolder(nearest.data.id);
        this.matchEngine.state.possession = otherTeam;
      }
    }

    // AI decisions run every AI_DECISION_INTERVAL seconds
    this.aiDecisionTimer += dt;
    if (this.aiDecisionTimer >= this.AI_DECISION_INTERVAL) {
      this.aiDecisionTimer = 0;
      this.runAIDecisions(dt);
    }

    // Move AI players toward their targets every frame
    this.moveAIPlayers(dt);

    // Animate all players (dribble, walk cycle, idle)
    for (const player of this.getAllPlayers()) {
      player.animate(dt);
    }

    // Make AI players face the ball/ball holder
    const ballTarget = this.ball.heldBy
      ? this.getPlayerById(this.ball.heldBy)?.position ?? this.ball.mesh.position
      : this.ball.mesh.position;

    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue;
      // Face toward ball holder
      const dx = ballTarget.x - player.position.x;
      const dz = ballTarget.z - player.position.z;
      if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
        player.group.rotation.y = Math.atan2(dx, dz);
      }
    }

    // Auto-switch human control on defense (with cooldown to prevent jitter)
    this.autoSwitchCooldown = Math.max(0, this.autoSwitchCooldown - dt);
    if (this.matchEngine.state.phase === 'playing' && this.autoSwitchCooldown <= 0) {
      const humanTeam = this.getPlayerTeam(this.humanPlayerId);
      const isOnDefense = this.matchEngine.state.possession !== humanTeam;

      if (isOnDefense) {
        const ballHolder = this.getAllPlayers().find(p => p.hasBall);
        if (ballHolder) {
          const humanTeamPlayers = humanTeam === 'home' ? this.homePlayers : this.awayPlayers;
          let nearestId = this.humanPlayerId;
          let nearestDist = Infinity;
          for (const p of humanTeamPlayers) {
            const d = p.distanceTo(ballHolder.position);
            if (d < nearestDist) { nearestDist = d; nearestId = p.data.id; }
          }
          if (nearestId !== this.humanPlayerId) {
            this.switchHumanControl(nearestId);
            this.autoSwitchCooldown = 0.5; // prevent rapid toggling
          }
        }
      }
    }

    // Update match engine clock
    if (this.matchEngine.state.phase === 'playing') {
      this.matchEngine.tickClock(dt);
    }

    // Powerup system
    this.powerupSystem.tick(dt);
    const diff = this.matchEngine.getScoreDifferential();
    if (diff) {
      this.powerupSystem.update(diff.deficit, dt);
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
          // Store last picked up powerup for HUD
          this.lastPowerupPickup = type;
          break;
        }
      }
    }
  }

  processInput(input: ControlInput, dt: number): void {
    if (this.matchEngine.state.phase === 'transitioning') return;
    const human = this.getHumanPlayer();
    if (!human) return;

    // Transform joystick input to camera-relative world space
    let worldX = input.joystick.x;
    let worldZ = input.joystick.y; // screen Y → world Z

    if (this.cameraRef) {
      // Get camera's forward and right vectors projected onto XZ plane
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cameraRef.quaternion);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.cameraRef.quaternion);
      right.y = 0;
      right.normalize();

      // Transform input: joystick X = camera right, joystick Y = camera forward
      worldX = right.x * input.joystick.x + forward.x * (-input.joystick.y);
      worldZ = right.z * input.joystick.x + forward.z * (-input.joystick.y);
    }

    human.isSprinting = input.sprinting ?? false;
    human.moveByInput(worldX, worldZ, dt);

    // Process gesture (consume it so it doesn't repeat next frame)
    if (input.gesture) {
      this.handleGesture(input.gesture, human);
      input.gesture = null;
    }
  }

  handleMadeShot(team: Possession, shotType: ShotType): void {
    // Trigger slam cam for dunks
    if (shotType === 'dunk' || shotType === 'alley-oop' || shotType === 'powerup-dunk') {
      this.slamCamRequested = true;
      this.slamCamPosition = this.attackingHoop.clone();
    }

    this.matchEngine.score(team, shotType);
    this.ball.isInFlight = false;
    // Reset for check-ball: other team gets the ball
    this.resetAfterScore(team === 'home' ? 'away' : 'home');
  }

  setBallHolder(playerId: string): void {
    // Clear old holder
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

    // Track the ball (wherever it is)
    const ballPos = this.ball.heldBy
      ? this.getPlayerById(this.ball.heldBy)?.position ?? this.ball.mesh.position
      : this.ball.mesh.position;

    return {
      mode: 'broadcast' as CameraMode,
      trackPosition: ballPos.clone(),
      lookAt: this.attackingHoop.clone(),
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
        points: humanPlayer.performanceScore,
        assists: 0,
        steals: 0,
      },
      xpEarned: xp,
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

  // --- Private methods ---

  private handleGesture(gesture: GestureResult, human: GamePlayer): void {
    const hasBall = human.hasBall;

    switch (gesture.type) {
      case 'swipe-up':
        if (hasBall) {
          // Shoot
          human.loseBall();
          human.triggerShoot();
          this.lastShooterId = human.data.id;
          this.ball.shootAt(this.attackingHoop, gesture.power);
        }
        break;

      case 'swipe-down':
        if (hasBall && human.distanceTo(this.attackingHoop) < 4.5) {
          // Dunk attempt
          human.loseBall();
          human.triggerShoot();
          this.lastShooterId = human.data.id;
          this.ball.shootAt(this.attackingHoop, 1.0);
        }
        break;

      case 'pass':
        if (hasBall) {
          const teammate = this.findNearestTeammate(human);
          if (teammate) {
            human.loseBall();
            this.ball.passTo(teammate.position);
            this.pendingPassTarget = teammate.data.id;

            // Switch control to the pass target
            human.isHumanControlled = false;
            this.playerAIs.set(human.data.id, new PlayerAI(human.data.stats, human.data.personality));

            this.humanPlayerId = teammate.data.id;
            teammate.isHumanControlled = true;
            this.playerAIs.delete(teammate.data.id);
          }
        }
        break;

      case 'tap':
        if (!hasBall) {
          // Steal attempt
          this.attemptSteal(human);
        }
        break;

      case 'jump':
        human.jump();
        break;

      case 'double-tap':
        // Switch controlled player or call screen
        break;
    }
  }

  private resetAfterScore(receivingTeam: Possession): void {
    this.shotDetector.reset();
    this.matchEngine.state.phase = 'transitioning';
    this.transitionTimer = 2.0;
    this.pendingReceivingTeam = receivingTeam;

    // Swap hoops in 5v5
    if (this.mode === '5v5') {
      const temp = this.attackingHoop.clone();
      this.attackingHoop.copy(this.defendingHoop);
      this.defendingHoop.copy(temp);
      this.shotDetector.setHoopPosition(this.attackingHoop);
    }

    // Set target positions for all players to sprint to
    const homeTargets = this.mode === '5v5'
      ? [new THREE.Vector3(0,0,-8), new THREE.Vector3(-4,0,-5), new THREE.Vector3(4,0,-5), new THREE.Vector3(-2,0,-3), new THREE.Vector3(2,0,-3)]
      : [new THREE.Vector3(-3,0,2), new THREE.Vector3(3,0,2), new THREE.Vector3(0,0,5)];
    const awayTargets = this.mode === '5v5'
      ? [new THREE.Vector3(0,0,8), new THREE.Vector3(-4,0,5), new THREE.Vector3(4,0,5), new THREE.Vector3(-2,0,3), new THREE.Vector3(2,0,3)]
      : [new THREE.Vector3(-2,0,-2), new THREE.Vector3(2,0,-2), new THREE.Vector3(0,0,-4)];

    this.homePlayers.forEach((p, i) => {
      p.aiTarget = homeTargets[i] ?? homeTargets[0];
      p.aiMovementState = 'reacting';
      p.isSprinting = true;
    });
    this.awayPlayers.forEach((p, i) => {
      p.aiTarget = awayTargets[i] ?? awayTargets[0];
      p.aiMovementState = 'reacting';
      p.isSprinting = true;
    });

    // Release ball temporarily
    this.ball.release();
    this.ball.mesh.visible = false; // hide during transition
  }

  private checkBallPickup(): void {
    for (const p of this.getAllPlayers()) {
      if (p.distanceTo(this.ball.mesh.position) < 1.0) {
        this.setBallHolder(p.data.id);

        // Clear pending pass target on pickup
        if (this.pendingPassTarget === p.data.id) {
          this.pendingPassTarget = null;
        }
        break;
      }
    }
  }

  private attemptSteal(stealer: GamePlayer): void {
    const ballHolder = this.getAllPlayers().find(p => p.hasBall);
    if (!ballHolder) return;
    if (stealer.distanceTo(ballHolder.position) > 2) return;

    stealer.triggerSteal();

    // 30% chance of steal, 30% chance of foul, 40% nothing
    const roll = Math.random();
    if (roll < 0.3) {
      // Successful steal
      ballHolder.loseBall();
      ballHolder.recordStat('turnovers', 1);
      this.setBallHolder(stealer.data.id);
    } else if (roll < 0.6) {
      // Foul
      const stealerTeam = this.getPlayerTeam(stealer.data.id);
      this.matchEngine.callFoul(stealerTeam);
    }
    // else: failed attempt, nothing happens
  }

  private runAIDecisions(_dt: number): void {
    const scoreDiff = this.matchEngine.state.homeScore - this.matchEngine.state.awayScore;
    const clock = this.matchEngine.state.clockSeconds;
    const possession = this.matchEngine.state.possession;

    // Invalidate cached plays when possession changes
    if (this.lastPossession !== null && this.lastPossession !== possession) {
      this.cachedPlays = {};
    }
    this.lastPossession = possession;

    // LOOSE BALL — everyone chases it
    const ballIsLoose = !this.ball.heldBy && !this.ball.isInFlight;

    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue; // Skip human

      if (ballIsLoose) {
        // ALL AI players chase the loose ball
        player.aiTarget = this.ball.mesh.position.clone();
        player.aiMovementState = 'reacting'; // urgent movement
        continue; // skip normal offense/defense logic
      }

      // Determine if this player's team has possession (on offense)
      const isHome = this.isHomePlayer(player);
      const isOnOffense = (isHome && possession === 'home') || (!isHome && possession === 'away');

      // --- DEFENSIVE AI: man-to-man ball pressure ---
      if (!isOnOffense) {
        const assignment = this.getDefensiveAssignment(player);
        if (!assignment) { this.moveToFormation(player); continue; }

        const isGuardingBallHandler = assignment.hasBall;
        const distToAssignment = player.distanceTo(assignment.position);

        if (isGuardingBallHandler) {
          // BALL PRESSURE DEFENSE
          // Position between ball handler and hoop, ~2 units from handler
          const handlerPos = assignment.position;
          const hoopPos = this.defendingHoop;

          // Direction from handler to hoop
          const toHoop = new THREE.Vector3().subVectors(hoopPos, handlerPos).normalize();

          // Position 2 units toward hoop from handler (between them and basket)
          const defensePos = new THREE.Vector3(
            handlerPos.x + toHoop.x * 2,
            0,
            handlerPos.z + toHoop.z * 2
          );

          // Mirror handler's lateral movement
          defensePos.x = handlerPos.x * 0.8; // track 80% of their x-movement

          player.aiTarget = defensePos;
          player.aiMovementState = 'reacting'; // always responsive to ball handler

          // Attempt steal if very close and handler is driving
          if (distToAssignment < 1.5) {
            const ai = this.playerAIs.get(player.data.id);
            if (ai && Math.random() < 0.05) { // 5% chance per decision tick
              this.attemptSteal(player);
            }
          }
        } else {
          // OFF-BALL DEFENSE
          // Position 2/3 of the way between assignment and hoop (closer to their man)
          const assignPos = assignment.position;
          const hoopPos = this.defendingHoop;

          player.aiTarget = new THREE.Vector3(
            assignPos.x * 0.7 + hoopPos.x * 0.3,
            0,
            assignPos.z * 0.7 + hoopPos.z * 0.3
          );

          // Always track their man — use reacting for close tracking, moving for distant
          if (assignment.velocity && assignment.velocity.lengthSq() > 0.5) {
            player.aiMovementState = 'reacting'; // man is cutting, react fast
          } else if (player.aiMovementState === 'holding' && player.aiHoldTimer <= 0) {
            player.aiMovementState = 'moving'; // done holding, follow man
          }
        }
        continue; // Skip the offensive decision tree
      }

      // --- OFFENSIVE AI WITHOUT BALL: V-Cuts and patience ---
      if (isOnOffense && !player.hasBall) {
        // First: get to the offensive end of the court
        const distToHoopOffBall = player.distanceTo(this.attackingHoop);

        if (distToHoopOffBall > 10) {
          // Too far from the hoop — advance down court
          player.aiTarget = new THREE.Vector3(
            this.attackingHoop.x + (Math.random() - 0.5) * 6, // spread across width
            0,
            this.attackingHoop.z + (this.attackingHoop.z > 0 ? -5 : 5) // approach from behind arc
          );
          player.aiMovementState = 'moving';
          continue;
        }

        // In offensive zone — do V-cuts
        // V-Cut system: hold position, then cut, then return
        if (player.aiMovementState === 'holding' && player.aiHoldTimer <= 0) {
          // Time to make a move — pick a V-cut or reposition
          const roll = Math.random();
          if (roll < 0.4) {
            // V-CUT TOWARD HOOP: fake toward basket
            player.aiTarget = new THREE.Vector3(
              this.attackingHoop.x + (Math.random() - 0.5) * 3,
              0,
              this.attackingHoop.z + 2 + Math.random() * 2
            );
            player.aiMovementState = 'moving';
          } else if (roll < 0.7) {
            // V-CUT TO WING: move to open perimeter spot
            const side = player.position.x > 0 ? -1 : 1;
            player.aiTarget = new THREE.Vector3(
              side * (4 + Math.random() * 2),
              0,
              1 + Math.random() * 3
            );
            player.aiMovementState = 'moving';
          } else {
            // HOLD AND WAIT: stay at current spot longer
            player.aiHoldTimer = 1 + Math.random() * 1.5;
          }
        } else if (player.aiMovementState !== 'holding' && player.aiMovementState !== 'moving') {
          // Just arrived or no state — get a formation position and hold
          this.moveToFormation(player);
          player.aiMovementState = 'holding';
          player.aiHoldTimer = 0.8 + Math.random() * 1.2;
        }
        continue; // Skip the old decision tree
      }

      // --- OFFENSIVE AI WITH BALL: patience then act ---
      if (isOnOffense && player.hasBall) {
        const distToHoopBallHandler = player.distanceTo(this.attackingHoop);

        // If far from hoop, advance first before shooting
        if (distToHoopBallHandler > 8) {
          player.aiTarget = this.attackingHoop.clone();
          player.aiMovementState = 'moving';
          continue; // don't shoot from too far
        }

        // Close enough — survey and decide
        // Ball handler — survey for 0.5-1s then act
        if (player.aiMovementState === 'holding' && player.aiHoldTimer > 0) {
          // Holding ball, surveying — don't move, let timer run
          continue;
        }

        // Now decide what to do
        const ai = this.playerAIs.get(player.data.id);
        if (!ai) continue;

        const ctx: AIContext = {
          hasBall: player.hasBall,
          isOnOffense,
          distanceToHoop: player.distanceTo(this.attackingHoop),
          nearestDefenderDist: this.getNearestOpponentDist(player),
          teammateOpenness: this.getTeammateOpenness(player),
          scoreDiff: isHome ? scoreDiff : -scoreDiff,
          clockSeconds: clock,
        };

        const decision = ai.decide(ctx);

        switch (decision.action) {
          case 'shoot':
            if (player.distanceTo(this.attackingHoop) < 8) {
              player.loseBall();
              player.triggerShoot();
              this.lastShooterId = player.data.id;
              this.ball.shootAt(this.attackingHoop, 0.5 + Math.random() * 0.3);
            }
            // After shooting, go back to holding
            player.aiMovementState = 'holding';
            player.aiHoldTimer = 1;
            break;
          case 'pass':
            if (decision.targetIndex !== undefined) {
              const teammates = this.getTeammates(player);
              const target = teammates[decision.targetIndex % teammates.length];
              if (target) {
                player.loseBall();
                this.ball.passTo(target.position);
                this.pendingPassTarget = target.data.id;
              }
            }
            player.aiMovementState = 'holding';
            player.aiHoldTimer = 0.5;
            break;
          case 'drive':
            player.aiTarget = this.attackingHoop.clone();
            player.aiMovementState = 'moving';
            break;
          case 'dunk':
            if (player.distanceTo(this.attackingHoop) < 4.5) {
              player.loseBall();
              player.triggerShoot();
              this.lastShooterId = player.data.id;
              this.ball.shootAt(this.attackingHoop, 1.0);
            }
            break;
          default:
            // Hold and survey
            player.aiMovementState = 'holding';
            player.aiHoldTimer = 0.5 + Math.random();
            break;
        }
        continue;
      }
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

  private moveAIPlayers(dt: number): void {
    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue;

      switch (player.aiMovementState) {
        case 'holding':
          // Stand still, face the ball, countdown timer
          player.aiHoldTimer -= dt;
          if (player.aiHoldTimer <= 0) {
            // Timer expired — if we have a target, start moving; otherwise stay holding briefly
            if (player.aiTarget) {
              player.aiMovementState = 'moving';
            } else {
              // No target yet — give a formation target as fallback
              this.moveToFormation(player);
              player.aiMovementState = 'moving';
            }
          }
          // Don't move — just animate idle
          player.velocity.set(0, 0, 0);
          break;

        case 'moving': {
          if (!player.aiTarget) {
            // No target — get a formation position and keep moving
            this.moveToFormation(player);
          }
          const dist = player.distanceTo(player.aiTarget!);
          if (dist < 0.3) {
            // Reached target — switch to holding for 1-2 seconds
            player.aiMovementState = 'holding';
            player.aiHoldTimer = 0.8 + Math.random() * 1.2;
          } else {
            player.moveToward(player.aiTarget!, dt);
          }
          break;
        }

        case 'reacting': {
          if (!player.aiTarget) break;
          // Quick burst movement — no holding, just go
          player.moveToward(player.aiTarget, dt);
          const reactDist = player.distanceTo(player.aiTarget);
          if (reactDist < 0.5) {
            player.aiMovementState = 'holding';
            player.aiHoldTimer = 0.3 + Math.random() * 0.7;
          }
          break;
        }
      }
    }
  }

  private moveToFormation(player: GamePlayer): void {
    const isHome = this.isHomePlayer(player);
    const teamKey = isHome ? 'home' : 'away';
    const teamAI = isHome ? this.homeTeamAI : this.awayTeamAI;
    const teammates = isHome ? this.homePlayers : this.awayPlayers;
    const idx = teammates.indexOf(player);

    const isOnOffense = (isHome && this.matchEngine.state.possession === 'home') ||
                        (!isHome && this.matchEngine.state.possession === 'away');

    // Use cached play to prevent jittering from random deviation each tick
    const now = this.matchEngine.state.clockSeconds;
    const cached = this.cachedPlays[teamKey];
    let play: TeamPlay;
    if (cached && Math.abs(cached.timestamp - now) < this.playRefreshInterval) {
      play = cached.play;
    } else {
      play = teamAI.choosePlay({
        possession: this.matchEngine.state.possession,
        scoreDiff: this.matchEngine.state.homeScore - this.matchEngine.state.awayScore,
        clockSeconds: now,
      });
      this.cachedPlays[teamKey] = { play, timestamp: now };
    }

    if (this.mode === '5v5') {
      const positions = getFormation5v5(play.formation, !isOnOffense);
      if (positions[idx]) {
        // Position relative to the hoop we're attacking/defending
        const refHoop = isOnOffense ? this.attackingHoop : this.defendingHoop;
        const dir = refHoop.z < 0 ? -1 : 1;
        player.aiTarget = new THREE.Vector3(
          positions[idx].x,
          0,
          refHoop.z + positions[idx].z * dir
        );
      }
    } else {
      // Existing 3v3 formation logic
      const positions = TeamAI.getFormationPositions(play.formation);
      if (positions[idx]) {
        player.aiTarget = new THREE.Vector3(positions[idx].x, 0, positions[idx].z);
      }
    }
  }

  private getDefensiveAssignment(player: GamePlayer): GamePlayer | null {
    const opponents = this.isHomePlayer(player) ? this.awayPlayers : this.homePlayers;
    const playerIdx = (this.isHomePlayer(player) ? this.homePlayers : this.awayPlayers).indexOf(player);
    // Simple 1-to-1 matching by index
    return opponents[playerIdx] ?? opponents[0];
  }

  private isHomePlayer(player: GamePlayer): boolean {
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

  private getTeammateOpenness(player: GamePlayer): number[] {
    const teammates = this.getTeammates(player);
    const opponents = this.isHomePlayer(player) ? this.awayPlayers : this.homePlayers;
    return teammates.map(tm => {
      let minOppDist = Infinity;
      for (const opp of opponents) {
        const d = tm.distanceTo(opp.position);
        if (d < minOppDist) minOppDist = d;
      }
      return Math.min(1, minOppDist / 5); // 0-1 openness
    });
  }
}
