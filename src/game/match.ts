import { MatchState, Possession, ShotType, TeamData, SHOT_POINTS } from '@/core/types';
import { EventBus } from '@/core/events';

const WIN_SCORE = 21;
const ON_FIRE_DURATION = 15; // seconds
const FOUL_POWERUP_CHARGE = 15;

interface OnFireState {
  active: boolean;
  timer: number;
}

export class MatchEngine {
  public state: MatchState;
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
      shotClockSeconds: 24,
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

    this.state.shotClockSeconds = 24;

    this.events.emit('score', { team, points, shotType });

    // Check win condition
    if (this.state.homeScore >= WIN_SCORE || this.state.awayScore >= WIN_SCORE) {
      this.endGame();
      return;
    }

    // Change to check-ball phase after a score
    this.state.phase = 'check-ball';
  }

  tickClock(dt: number): void {
    // Only tick during active play — not during transitions, check-ball, or post-game
    if (this.state.phase !== 'playing') return;

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
        this.state.shotClockSeconds = 24;
        const violatingTeam = this.state.possession;
        this.state.possession = this.state.possession === 'home' ? 'away' : 'home';
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

    // Swap possession: fouling team loses possession
    this.state.possession = team === 'home' ? 'away' : 'home';

    // Charge powerup meter
    this.state.powerupMeter += FOUL_POWERUP_CHARGE;

    this.events.emit('foul', { team });
  }

  activateOnFire(team: Possession): void {
    this.onFire[team].active = true;
    this.onFire[team].timer = ON_FIRE_DURATION;
  }

  checkBallComplete(team: Possession): void {
    this.state.possession = team;
    this.state.phase = 'playing';
    this.state.shotClockSeconds = 24;
  }

  resetShotClock(): void {
    this.state.shotClockSeconds = 24;
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
