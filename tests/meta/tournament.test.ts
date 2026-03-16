import { describe, it, expect } from 'vitest';
import { Tournament } from '@/meta/tournament';
import { TeamData, TOURNAMENT_CONFIGS } from '@/core/types';

/** Helper: create a minimal team with the given seed. */
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

describe('Tournament', () => {
  it('creates 8-team bracket for casual (4 first-round matchups, 3 total rounds)', () => {
    const teams = makeTeams(8);
    const tourney = new Tournament('casual', teams);

    const round1 = tourney.getMatchesForRound(1);
    expect(round1).toHaveLength(4);

    const config = TOURNAMENT_CONFIGS['casual'];
    expect(config.rounds).toBe(3);
    expect(config.teamCount).toBe(8);
  });

  it('creates 16-team bracket for sweet16 (8 matchups, 4 rounds)', () => {
    const teams = makeTeams(16);
    const tourney = new Tournament('sweet16', teams);

    const round1 = tourney.getMatchesForRound(1);
    expect(round1).toHaveLength(8);

    const config = TOURNAMENT_CONFIGS['sweet16'];
    expect(config.rounds).toBe(4);
    expect(config.teamCount).toBe(16);
  });

  it('creates 64-team bracket for season (32 matchups, 6 rounds)', () => {
    const teams = makeTeams(64);
    const tourney = new Tournament('season', teams);

    const round1 = tourney.getMatchesForRound(1);
    expect(round1).toHaveLength(32);

    const config = TOURNAMENT_CONFIGS['season'];
    expect(config.rounds).toBe(6);
    expect(config.teamCount).toBe(64);
  });

  it('advances winner to next round on reportResult', () => {
    const teams = makeTeams(8);
    const tourney = new Tournament('casual', teams);

    const round1 = tourney.getMatchesForRound(1);
    // Report all round-1 results
    for (const match of round1) {
      tourney.reportResult(match.id, match.teamA.id);
    }

    const round2 = tourney.getMatchesForRound(2);
    expect(round2).toHaveLength(2);
    // Winners should appear in round 2
    expect(round2[0].teamA.id).toBe(round1[0].teamA.id);
  });

  it('completes tournament with a champion (play through all 8-team games picking teamA)', () => {
    const teams = makeTeams(8);
    const tourney = new Tournament('casual', teams);

    // Play through all rounds, always picking teamA
    while (!tourney.isComplete) {
      const nextMatch = tourney.getNextMatch();
      expect(nextMatch).toBeDefined();
      tourney.reportResult(nextMatch!.id, nextMatch!.teamA.id);
    }

    expect(tourney.isComplete).toBe(true);
    expect(tourney.champion).not.toBeNull();
    // The #1 seed should win when always picking teamA (sorted by seed)
    expect(tourney.champion!.id).toBe('team-1');
  });

  it('seeds teams correctly (1 vs 16, 2 vs 15, etc. — check first match of 16-team bracket)', () => {
    const teams = makeTeams(16);
    const tourney = new Tournament('sweet16', teams);

    const round1 = tourney.getMatchesForRound(1);
    // First match: seed 1 vs seed 16
    expect(round1[0].teamA.seed).toBe(1);
    expect(round1[0].teamB.seed).toBe(16);
    // Second match: seed 2 vs seed 15
    expect(round1[1].teamA.seed).toBe(2);
    expect(round1[1].teamB.seed).toBe(15);
  });
});
