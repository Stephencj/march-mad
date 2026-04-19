import { MatchState, Possession, ShotType, TeamData, SHOT_POINTS } from '@/core/types';
import { EventBus } from '@/core/events';
import { balanceConfig } from '@/dev/balance-config';

interface OnFireState {
  active: boolean;
  timer: number;
}

export class MatchEngine {
  public state: MatchState;
  public freeplay = false;
  private events: EventBus;
  private onFire: Record<Possession, OnFireState> = {
    home: { active: false, timer: 0 },
    away: { active: false, timer: 0 },
  };

  constructor(events: EventBus, homeTeam?: TeamData, awayTeam?: TeamData) {
    this.events = events;
    this.state = {
      homeTeam: homeTeam ?? ({} as TeamData),
      awayTeam: awayTeam ?? ({} as TeamData),
      homeScore: 0,
      awayScore: 0,
      possession: 'home',
      phase: 'playing',
      clockSeconds: 180,
      shotClockSeconds: balanceConfig.match.shotClock,
      powerupMeter: 0,
    };
  }

  score(team: Possession, shotType: ShotType): void {
    if (this.state.phase === 'post-game') return;

    const basePoints = SHOT_POINTS[shotType];
    let points: number;

    if (shotType === 'powerup-dunk') {
      // Powerup dunk always awards 3, no multiplier
      points = basePoints;
    } else if (this.onFire[team].active) {
      // On Fire doubles base shots
      points = basePoints * 2;
    } else {
      points = basePoints;
    }

    if (team === 'home') {
      this.state.homeScore += points;
    } else {
      this.state.awayScore += points;
    }

    if (!this.freeplay) this.state.shotClockSeconds = balanceConfig.match.shotClock;

    this.events.emit('score', { team, points, shotType });

    // Check win condition
    const winScore = balanceConfig.match.winScore;
    if (this.state.homeScore >= winScore || this.state.awayScore >= winScore) {
      this.endGame();
      return;
    }

    // Change to check-ball phase after a score
    this.state.phase = 'check-ball';
  }

  tickClock(dt: number): void {
    // Only tick during active play — not during transitions, check-ball, or post-game
    if (this.state.phase !== 'playing') return;
    if (this.freeplay) return; // no clock in freeplay

    this.state.clockSeconds -= dt;

    // Expire On Fire timers
    for (const team of ['home', 'away'] as Possession[]) {
      if (this.onFire[team].active) {
        this.onFire[team].timer -= dt;
        if (this.onFire[team].timer <= 0) {
          this.onFire[team].active = false;
          this.onFire[team].timer = 0;
        }
      }
    }

    // Shot clock
    if (this.state.shotClockSeconds > 0) {
      this.state.shotClockSeconds -= dt;
      if (this.state.shotClockSeconds <= 0) {
        this.state.shotClockSeconds = balanceConfig.match.shotClock;
        const violatingTeam = this.state.possession;
        // Do NOT flip possession here — game-session handles it via the event
        this.events.emit('shot-clock-violation', { violatingTeam });
      }
    }

    // Buzzer
    if (this.state.clockSeconds <= 0) {
      this.state.clockSeconds = 0;
      this.endGame();
    }
  }

  callFoul(team: Possession): void {
    if (this.state.phase === 'post-game') return;

    // Possession change is handled by game-session via enterDeadBall()

    // Charge powerup meter
    this.state.powerupMeter += balanceConfig.match.foulPowerupCharge;

    this.events.emit('foul', { team });
  }

  activateOnFire(team: Possession): void {
    this.onFire[team].active = true;
    this.onFire[team].timer = balanceConfig.match.onFireDuration;
  }

  checkBallComplete(team: Possession): void {
    this.state.possession = team;
    this.state.phase = 'playing';
    if (!this.freeplay) this.state.shotClockSeconds = balanceConfig.match.shotClock;
  }

  resetShotClock(): void {
    if (!this.freeplay) this.state.shotClockSeconds = balanceConfig.match.shotClock;
  }

  getScoreDifferential(): { losingTeam: Possession; deficit: number } | null {
    const diff = this.state.homeScore - this.state.awayScore;
    if (diff === 0) return null;
    if (diff > 0) {
      return { losingTeam: 'away', deficit: diff };
    }
    return { losingTeam: 'home', deficit: -diff };
  }

  private endGame(): void {
    this.state.phase = 'post-game';
    // Home wins ties (>=)
    const winner: Possession = this.state.homeScore >= this.state.awayScore ? 'home' : 'away';
    this.events.emit('game-over', {
      winner,
      homeScore: this.state.homeScore,
      awayScore: this.state.awayScore,
    });
  }
}
