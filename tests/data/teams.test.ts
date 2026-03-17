import { describe, it, expect } from 'vitest';
import { generateTeams, MARQUEE_TEAMS } from '@/data/teams';
import type { TeamData } from '@/core/types';

describe('team data generation', () => {
  const teams: TeamData[] = generateTeams();

  it('generates exactly 64 teams', () => {
    expect(teams).toHaveLength(64);
  });

  it('each team has required fields', () => {
    for (const team of teams) {
      expect(team.name).toBeTruthy();
      expect(typeof team.name).toBe('string');
      expect(team.mascot).toBeTruthy();
      expect(typeof team.mascot).toBe('string');
      expect(team.colors.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(team.colors.secondary).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(team.archetype).toBeTruthy();
      expect(team.seed).toBeGreaterThanOrEqual(1);
      expect(team.seed).toBeLessThanOrEqual(16);
      expect(team.players).toHaveLength(3);
    }
  });

  it('all team names are unique', () => {
    const names = teams.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('includes marquee teams', () => {
    const teamNames = new Set(teams.map((t) => t.name));
    const first5 = MARQUEE_TEAMS.slice(0, 5);
    for (const marquee of first5) {
      expect(teamNames.has(marquee.name)).toBe(true);
    }
  });

  it('distributes seeds 1-16 across 4 regions (each seed appears exactly 4 times)', () => {
    for (let seed = 1; seed <= 16; seed++) {
      const count = teams.filter((t) => t.seed === seed).length;
      expect(count).toBe(4);
    }
  });

  it('generates 5-player teams with positions when playerCount is 5', () => {
    const teams = generateTeams(5);
    expect(teams[0].players).toHaveLength(5);
    const positions = teams[0].players.map(p => p.position);
    expect(positions).toContain('PG');
    expect(positions).toContain('C');
  });
});
