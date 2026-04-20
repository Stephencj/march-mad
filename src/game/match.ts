import { MatchState, Possession, ShotType, TeamData, SHOT_POINTS } from '@/core/types';
import { EventBus } from '@/core/events';
import { balanceConfig } from '@/dev/balance-config';

interface OnFireState {
  active: boolean;
  timer: number;
}

interface InvincibilityState {
  active: boolean;
  timer: number;
  /** Player that has 5-knockdown MUTANT form active (subset of invincibility). */
  mutantPlayerId: string | null;
}

export class MatchEngine {
  public state: MatchState;
  public freeplay = false;
  private events: EventBus;
  private onFire: Record<Possession, OnFireState> = {
    home: { active: false, timer: 0 },
    away: { active: false, timer: 0 },
  };
  /**
   * Per-team running count of knockdowns SUFFERED. Unlocks invincibility
   * at 3 (manual spend) and MUTANT mode at 5 (auto-activate).
   */
  public knockdownCount: Record<Possession, number> = { home: 0, away: 0 };
  public invincibility: Record<Possession, InvincibilityState> = {
    home: { active: false, timer: 0, mutantPlayerId: null },
    away: { active: false, timer: 0, mutantPlayerId: null },
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

    // MUTANT doubles points on top of anything else — it's the user-earned
    // top-tier buff at 5 knockdowns.
    if (this.invincibility[team].active && this.invincibility[team].mutantPlayerId) {
      points *= 2;
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

    // Expire Invincibility / Mutant buffs (shared 30s timer per team)
    for (const team of ['home', 'away'] as Possession[]) {
      const inv = this.invincibility[team];
      if (inv.active) {
        inv.timer -= dt;
        if (inv.timer <= 0) {
          const wasMutant = inv.mutantPlayerId;
          inv.active = false;
          inv.timer = 0;
          inv.mutantPlayerId = null;
          this.events.emit('buff-expired', { team, wasMutant: wasMutant !== null, playerId: wasMutant });
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

  /**
   * The defender shoved the ball-handler; count it against the victim's team.
   * At 3 the team CAN manually spend for 30s invincibility. At 5 the team
   * auto-activates MUTANT mode on their chosen player. Used-up resets the
   * counter to 0.
   */
  recordKnockdown(victimTeam: Possession): void {
    if (this.state.phase === 'post-game') return;
    this.knockdownCount[victimTeam]++;
    this.events.emit('knockdown', { victimTeam, count: this.knockdownCount[victimTeam] });
    if (this.knockdownCount[victimTeam] === 3) {
      this.events.emit('buff-available', { team: victimTeam, type: 'invincibility' });
    }
    if (this.knockdownCount[victimTeam] >= 5) {
      this.events.emit('buff-available', { team: victimTeam, type: 'mutant' });
    }
  }

  /** Spend the 3-knockdown invincibility buff. No-op if not eligible. */
  activateInvincibility(team: Possession): boolean {
    if (this.knockdownCount[team] < 3) return false;
    if (this.invincibility[team].active) return false;
    this.invincibility[team].active = true;
    this.invincibility[team].timer = 30;
    this.invincibility[team].mutantPlayerId = null;
    this.knockdownCount[team] = 0;
    this.events.emit('buff-activated', { team, type: 'invincibility' });
    return true;
  }

  /** Auto-spend MUTANT on a specific player of the given team. */
  activateMutant(team: Possession, playerId: string): boolean {
    if (this.knockdownCount[team] < 5) return false;
    if (this.invincibility[team].active && this.invincibility[team].mutantPlayerId) return false;
    this.invincibility[team].active = true;
    this.invincibility[team].timer = 30;
    this.invincibility[team].mutantPlayerId = playerId;
    this.knockdownCount[team] = 0;
    this.events.emit('buff-activated', { team, type: 'mutant', playerId });
    return true;
  }

  isInvincible(team: Possession): boolean {
    return this.invincibility[team].active;
  }

  isMutant(playerId: string, team: Possession): boolean {
    return this.invincibility[team].active && this.invincibility[team].mutantPlayerId === playerId;
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
