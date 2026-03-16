import * as THREE from 'three';
import type { TeamData, Possession, ShotType } from '@/core/types';
import type { EventBus } from '@/core/events';
import type { ControlInput, GestureResult } from './controls';
import type { CameraMode } from './camera';
import { GamePlayer } from './player';
import { Ball } from './ball';
import { MatchEngine } from './match';
import { ShotDetector } from './shot-detector';
import { PlayerAI, type AIContext } from '@/ai/player-ai';
import { TeamAI } from '@/ai/team-ai';
import { COURT_DIMENSIONS } from './court';

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

  private events: EventBus;
  private humanPlayerId: string;
  private shotDetector = new ShotDetector();
  private playerAIs = new Map<string, PlayerAI>();
  private homeTeamAI: TeamAI;
  private awayTeamAI: TeamAI;
  private scene: THREE.Scene | null = null;
  private aiDecisionTimer = 0;
  private readonly AI_DECISION_INTERVAL = 0.5; // seconds between AI decisions
  private lastShooterId: string | null = null;
  private pendingPassTarget: string | null = null;

  constructor(events: EventBus, homeTeam: TeamData, awayTeam: TeamData, humanPlayerId: string) {
    this.events = events;
    this.humanPlayerId = humanPlayerId;
    this.ball = new Ball(new THREE.Vector3(0, 1, 2));
    this.matchEngine = new MatchEngine(events, homeTeam, awayTeam);
    this.homeTeamAI = new TeamAI(homeTeam.archetype);
    this.awayTeamAI = new TeamAI(awayTeam.archetype);

    // Spawn home team players
    const homeColor = parseInt(homeTeam.colors.primary.replace('#', ''), 16) || 0x3498db;
    const homePositions = [
      new THREE.Vector3(-3, 0, 2),
      new THREE.Vector3(3, 0, 2),
      new THREE.Vector3(0, 0, 5),
    ];
    homeTeam.players.forEach((pd, i) => {
      const gp = new GamePlayer(pd, homePositions[i], homeColor);
      this.homePlayers.push(gp);
      if (pd.id !== humanPlayerId) {
        this.playerAIs.set(pd.id, new PlayerAI(pd.stats, pd.personality));
      }
    });

    // Spawn away team players
    const awayColor = parseInt(awayTeam.colors.primary.replace('#', ''), 16) || 0xe74c3c;
    const awayPositions = [
      new THREE.Vector3(-2, 0, -2),
      new THREE.Vector3(2, 0, -2),
      new THREE.Vector3(0, 0, -4),
    ];
    awayTeam.players.forEach((pd, i) => {
      const gp = new GamePlayer(pd, awayPositions[i], awayColor);
      this.awayPlayers.push(gp);
      this.playerAIs.set(pd.id, new PlayerAI(pd.stats, pd.personality));
    });
  }

  addToScene(scene: THREE.Scene): void {
    this.scene = scene;
    scene.add(this.ball.mesh);
    for (const p of this.getAllPlayers()) {
      scene.add(p.group);
    }
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.ball.mesh);
    for (const p of this.getAllPlayers()) {
      scene.remove(p.group);
    }
    this.scene = null;
  }

  start(): void {
    // Give ball to first home player
    this.setBallHolder(this.homePlayers[0].data.id);
    this.matchEngine.state.phase = 'playing';
    this.matchEngine.state.possession = 'home';
  }

  update(dt: number): void {
    // Update ball position
    if (this.ball.heldBy) {
      const holder = this.getPlayerById(this.ball.heldBy);
      if (holder) this.ball.followHolder(holder.position);
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
        const shotType = this.shotDetector.classifyShot(
          shooterId ? this.getPlayerById(shooterId)!.position : this.ball.mesh.position
        );
        this.handleMadeShot(team, shotType);
      }
    }

    // Check for loose ball pickup
    if (!this.ball.heldBy && !this.ball.isInFlight) {
      this.checkBallPickup();
    }

    // AI decisions run every AI_DECISION_INTERVAL seconds
    this.aiDecisionTimer += dt;
    if (this.aiDecisionTimer >= this.AI_DECISION_INTERVAL) {
      this.aiDecisionTimer = 0;
      this.runAIDecisions(dt);
    }

    // Move AI players toward their targets every frame
    this.moveAIPlayers(dt);

    // Update match engine clock
    if (this.matchEngine.state.phase === 'playing') {
      this.matchEngine.tickClock(dt);
    }
  }

  processInput(input: ControlInput, dt: number): void {
    const human = this.getHumanPlayer();
    if (!human) return;

    // Move with joystick
    human.moveByInput(input.joystick.x, input.joystick.y, dt);

    // Process gesture (consume it so it doesn't repeat next frame)
    if (input.gesture) {
      this.handleGesture(input.gesture, human);
      input.gesture = null;
    }
  }

  handleMadeShot(team: Possession, shotType: ShotType): void {
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
    const possession = this.matchEngine.state.possession;
    const humanTeam = this.getPlayerTeam(this.humanPlayerId);
    const human = this.getHumanPlayer();
    const ballHolder = this.getAllPlayers().find(p => p.hasBall);
    const trackTarget = ballHolder?.position ?? human.position;

    let mode: CameraMode;
    if (this.ball.isInFlight) {
      mode = 'offense'; // follow the shot
    } else if (possession === humanTeam) {
      mode = 'offense';
    } else {
      mode = 'defense';
    }

    return {
      mode,
      trackPosition: trackTarget.clone(),
      lookAt: COURT_DIMENSIONS.hoopPosition.clone(),
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

  // --- Private methods ---

  private handleGesture(gesture: GestureResult, human: GamePlayer): void {
    const hasBall = human.hasBall;

    switch (gesture.type) {
      case 'swipe-up':
        if (hasBall) {
          // Shoot
          human.loseBall();
          this.lastShooterId = human.data.id;
          this.ball.shootAt(COURT_DIMENSIONS.hoopPosition, gesture.power);
        }
        break;

      case 'swipe-down':
        if (hasBall && human.distanceTo(COURT_DIMENSIONS.hoopPosition) < 3) {
          // Dunk attempt
          human.loseBall();
          this.lastShooterId = human.data.id;
          this.ball.shootAt(COURT_DIMENSIONS.hoopPosition, 1.0);
        }
        break;

      case 'pass':
        if (hasBall) {
          const teammate = this.findNearestTeammate(human);
          if (teammate) {
            human.loseBall();
            this.ball.passTo(teammate.position);
            this.pendingPassTarget = teammate.data.id;
          }
        }
        break;

      case 'tap':
        if (!hasBall) {
          // Steal attempt
          this.attemptSteal(human);
        }
        break;

      case 'double-tap':
        // Switch controlled player or call screen
        break;
    }
  }

  private resetAfterScore(receivingTeam: Possession): void {
    this.shotDetector.reset();
    // Move ball to check-ball position
    this.ball.mesh.position.set(0, 1, COURT_DIMENSIONS.checkBallLine);
    this.ball.velocity.set(0, 0, 0);
    // Give ball to receiving team's first player
    const receiver = receivingTeam === 'home' ? this.homePlayers[0] : this.awayPlayers[0];
    this.setBallHolder(receiver.data.id);
    this.matchEngine.checkBallComplete(receivingTeam);
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

    for (const player of this.getAllPlayers()) {
      if (player.data.id === this.humanPlayerId) continue; // Skip human

      const ai = this.playerAIs.get(player.data.id);
      if (!ai) continue;

      const ctx: AIContext = {
        hasBall: player.hasBall,
        distanceToHoop: player.distanceTo(COURT_DIMENSIONS.hoopPosition),
        nearestDefenderDist: this.getNearestOpponentDist(player),
        teammateOpenness: this.getTeammateOpenness(player),
        scoreDiff: this.isHomePlayer(player) ? scoreDiff : -scoreDiff,
        clockSeconds: clock,
      };

      const decision = ai.decide(ctx);

      // Execute AI decision
      switch (decision.action) {
        case 'shoot':
          if (player.hasBall) {
            player.loseBall();
            this.lastShooterId = player.data.id;
            this.ball.shootAt(COURT_DIMENSIONS.hoopPosition, 0.5 + Math.random() * 0.3);
          }
          break;
        case 'pass':
          if (player.hasBall && decision.targetIndex !== undefined) {
            const teammates = this.getTeammates(player);
            const target = teammates[decision.targetIndex % teammates.length];
            if (target) {
              player.loseBall();
              this.ball.passTo(target.position);
              this.pendingPassTarget = target.data.id;
            }
          }
          break;
        case 'drive':
          // Move toward hoop
          player.aiTarget = COURT_DIMENSIONS.hoopPosition.clone();
          break;
        case 'dunk':
          if (player.hasBall && player.distanceTo(COURT_DIMENSIONS.hoopPosition) < 3) {
            player.loseBall();
            this.lastShooterId = player.data.id;
            this.ball.shootAt(COURT_DIMENSIONS.hoopPosition, 1.0);
          }
          break;
        case 'steal':
          this.attemptSteal(player);
          break;
        case 'guard':
        case 'block': {
          // Move toward ball holder
          const holder = this.getAllPlayers().find(p => p.hasBall);
          if (holder) {
            player.aiTarget = holder.position.clone();
          }
          break;
        }
        default:
          // idle / screen — move to formation position
          this.moveToFormation(player);
          break;
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
      if (player.aiTarget) {
        player.moveToward(player.aiTarget, dt);
      }
    }
  }

  private moveToFormation(player: GamePlayer): void {
    const isHome = this.isHomePlayer(player);
    const teamAI = isHome ? this.homeTeamAI : this.awayTeamAI;
    const teammates = isHome ? this.homePlayers : this.awayPlayers;
    const idx = teammates.indexOf(player);
    const play = teamAI.choosePlay({
      possession: this.matchEngine.state.possession,
      scoreDiff: this.matchEngine.state.homeScore - this.matchEngine.state.awayScore,
      clockSeconds: this.matchEngine.state.clockSeconds,
    });
    const positions = TeamAI.getFormationPositions(play.formation);
    if (positions[idx]) {
      player.aiTarget = new THREE.Vector3(positions[idx].x, 0, positions[idx].z);
    }
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
