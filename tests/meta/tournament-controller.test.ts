import { describe, it, expect } from 'vitest';
import { TournamentController } from '@/meta/tournament-controller';
import type { TeamData } from '@/core/types';

function makeTeam(seed: number): TeamData {
  return {
    id: `team-${seed}`,
    name: `Team ${seed}`,
    mascot: `Mascot ${seed}`,
    colors: { primary: '#000', secondary: '#fff' },
    archetype: 'Balanced',
    seed,
    players: [],
  };
}

function makeTeams(count: number): TeamData[] {
  return Array.from({ length: count }, (_, i) => makeTeam(i + 1));
}

describe('TournamentController', () => {
  it('builds an 8-team casual bracket with 4 round-1 matches', () => {
    const c = new TournamentController('casual', makeTeams);
    expect(c.tier).toBe('casual');
    expect(c.allMatches).toHaveLength(4);
    expect(c.currentRound).toBe(1);
    expect(c.isActive).toBe(true);
    expect(c.champion).toBeNull();
  });

  it('throws if the team provider returns the wrong count', () => {
    expect(() => new TournamentController('casual', () => makeTeams(7))).toThrow();
  });

  it('translates winnerSide=home to the human team id', () => {
    const c = new TournamentController('casual', makeTeams);
    const next = c.getNextHumanMatch()!;
    const ctx = c.enterMatch(next.id);
    const homeId = ctx.homeTeam.id;

    c.recordHumanResult('home');

    const decided = c.allMatches.find((m) => m.id === next.id)!;
    expect(decided.winnerId).toBe(homeId);
  });

  it('translates winnerSide=away to the CPU team id', () => {
    const c = new TournamentController('casual', makeTeams);
    const next = c.getNextHumanMatch()!;
    const ctx = c.enterMatch(next.id);
    const awayId = ctx.awayTeam.id;

    c.recordHumanResult('away');

    const decided = c.allMatches.find((m) => m.id === next.id)!;
    expect(decided.winnerId).toBe(awayId);
  });

  it('auto-sims the rest of the round, advancing to round 2', () => {
    const c = new TournamentController('casual', makeTeams);
    const r1 = c.allMatches.filter((m) => m.round === 1);
    const human = r1[0];

    c.enterMatch(human.id);
    c.recordHumanResult('home');

    const allR1 = c.allMatches.filter((m) => m.round === 1);
    expect(allR1.every((m) => m.winnerId !== null)).toBe(true);
    const r2 = c.allMatches.filter((m) => m.round === 2);
    expect(r2).toHaveLength(2);
    expect(c.currentRound).toBe(2);
  });

  it('plays through all 3 rounds and produces a champion', () => {
    const c = new TournamentController('casual', makeTeams);
    while (c.isActive) {
      const next = c.getNextHumanMatch()!;
      c.enterMatch(next.id);
      c.recordHumanResult('home'); // human always wins
    }
    expect(c.champion).not.toBeNull();
    expect(c.isActive).toBe(false);
  });

  it('clears the active context after recording a result', () => {
    const c = new TournamentController('casual', makeTeams);
    const next = c.getNextHumanMatch()!;
    c.enterMatch(next.id);
    expect(c.currentMatchContext).not.toBeNull();
    c.recordHumanResult('home');
    expect(c.currentMatchContext).toBeNull();
  });

  it('throws if recordHumanResult is called with no active match', () => {
    const c = new TournamentController('casual', makeTeams);
    expect(() => c.recordHumanResult('home')).toThrow();
  });

  it('refuses to enter an already-decided match', () => {
    const c = new TournamentController('casual', makeTeams);
    const next = c.getNextHumanMatch()!;
    c.enterMatch(next.id);
    c.recordHumanResult('home');
    expect(() => c.enterMatch(next.id)).toThrow();
  });

  it('dispose clears active context', () => {
    const c = new TournamentController('casual', makeTeams);
    const next = c.getNextHumanMatch()!;
    c.enterMatch(next.id);
    c.dispose();
    expect(c.currentMatchContext).toBeNull();
  });

  it('works for sweet16 (16 teams, 4 rounds)', () => {
    const c = new TournamentController('sweet16', makeTeams);
    expect(c.allMatches).toHaveLength(8);
    while (c.isActive) {
      const next = c.getNextHumanMatch()!;
      c.enterMatch(next.id);
      c.recordHumanResult('home');
    }
    expect(c.champion).not.toBeNull();
  });

  it('works for season (64 teams, 6 rounds)', () => {
    const c = new TournamentController('season', makeTeams);
    expect(c.allMatches).toHaveLength(32);
    let humanMatchCount = 0;
    while (c.isActive) {
      const next = c.getNextHumanMatch()!;
      c.enterMatch(next.id);
      c.recordHumanResult('home');
      humanMatchCount++;
    }
    expect(humanMatchCount).toBe(6);
    expect(c.champion).not.toBeNull();
  });
});
