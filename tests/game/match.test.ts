import { describe, it, expect, vi } from 'vitest';
import { MatchEngine } from '@/game/match';
import { EventBus } from '@/core/events';

describe('MatchEngine', () => {
  function createMatch() {
    const events = new EventBus();
    return { match: new MatchEngine(events), events };
  }

  it('starts with 0-0 score and 180 second clock', () => {
    const { match } = createMatch();
    expect(match.state.homeScore).toBe(0);
    expect(match.state.awayScore).toBe(0);
    expect(match.state.clockSeconds).toBe(180);
  });

  it('scores correct points for inside shot (1 pt)', () => {
    const { match, events } = createMatch();
    const handler = vi.fn();
    events.on('score', handler);
    match.score('home', 'layup');
    expect(match.state.homeScore).toBe(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ team: 'home', points: 1 }));
  });

  it('scores correct points for three-pointer (2 pts)', () => {
    const { match } = createMatch();
    match.score('away', 'three-pointer');
    expect(match.state.awayScore).toBe(2);
  });

  it('scores correct points for powerup dunk (3 pts)', () => {
    const { match } = createMatch();
    match.score('home', 'powerup-dunk');
    expect(match.state.homeScore).toBe(3);
  });

  it('applies On Fire multiplier to base shots only', () => {
    const { match } = createMatch();
    match.activateOnFire('home');
    match.score('home', 'three-pointer'); // base 2 × 2 = 4
    expect(match.state.homeScore).toBe(4);
    match.score('home', 'powerup-dunk'); // always 3, no multiplier
    expect(match.state.homeScore).toBe(7);
  });

  it('ends game when a team reaches 21', () => {
    const { match, events } = createMatch();
    const gameOver = vi.fn();
    events.on('game-over', gameOver);
    for (let i = 0; i < 11; i++) {
      match.score('home', 'three-pointer');
    }
    expect(gameOver).toHaveBeenCalled();
    expect(match.state.phase).toBe('post-game');
  });

  it('ends game at buzzer with highest score winning', () => {
    const { match, events } = createMatch();
    const gameOver = vi.fn();
    events.on('game-over', gameOver);
    match.score('home', 'three-pointer');
    match.tickClock(180);
    expect(gameOver).toHaveBeenCalledWith(expect.objectContaining({ winner: 'home' }));
  });

  it('changes possession after a score', () => {
    const { match } = createMatch();
    match.state.possession = 'home';
    match.score('home', 'layup');
    expect(match.state.phase).toBe('check-ball');
  });

  it('charges powerup meter on foul', () => {
    const { match } = createMatch();
    const initial = match.state.powerupMeter;
    match.callFoul('away');
    expect(match.state.powerupMeter).toBeGreaterThan(initial);
  });

  it('changes possession on foul', () => {
    const { match } = createMatch();
    match.state.possession = 'home';
    match.callFoul('home');
    expect(match.state.possession).toBe('away');
  });

  it('handles tied game at buzzer (home wins tiebreak)', () => {
    const { match, events } = createMatch();
    const gameOver = vi.fn();
    events.on('game-over', gameOver);
    match.tickClock(180);
    expect(gameOver).toHaveBeenCalledWith(expect.objectContaining({ winner: 'home' }));
  });

  it('shot clock violation causes turnover after 24 seconds', () => {
    const { match } = createMatch();
    match.state.possession = 'home';
    match.tickClock(25); // exceeds 24 seconds
    expect(match.state.possession).toBe('away');
    expect(match.state.shotClockSeconds).toBe(24);
  });

  it('shot clock resets on score', () => {
    const { match } = createMatch();
    match.tickClock(20); // 4 seconds left
    match.score('home', 'layup');
    expect(match.state.shotClockSeconds).toBe(24);
  });
});
