import { describe, it, expect, beforeEach } from 'vitest';
import { SubInSystem } from '@/systems/sub-in';

describe('SubInSystem', () => {
  let system: SubInSystem;

  beforeEach(() => {
    system = new SubInSystem();
  });

  it('returns null stage when no bet is active', () => {
    const result = system.getStage(5);
    expect(result).toBeNull();
  });

  it('returns null when bet team is winning (negative deficit)', () => {
    system.activateBet('team-a');
    const result = system.getStage(-3);
    expect(result).toBeNull();
  });

  it('returns subtle stage for deficit 3-5', () => {
    system.activateBet('team-a');
    for (const deficit of [3, 4, 5]) {
      const result = system.getStage(deficit);
      expect(result).not.toBeNull();
      expect(result!.stage).toBe('subtle');
      expect(result!.deficit).toBe(deficit);
    }
  });

  it('returns pulsing stage for deficit 6-9', () => {
    system.activateBet('team-a');
    for (const deficit of [6, 7, 8, 9]) {
      const result = system.getStage(deficit);
      expect(result).not.toBeNull();
      expect(result!.stage).toBe('pulsing');
      expect(result!.deficit).toBe(deficit);
    }
  });

  it('returns urgent stage for deficit 10-14', () => {
    system.activateBet('team-a');
    for (const deficit of [10, 11, 12, 13, 14]) {
      const result = system.getStage(deficit);
      expect(result).not.toBeNull();
      expect(result!.stage).toBe('urgent');
      expect(result!.deficit).toBe(deficit);
    }
  });

  it('returns last-stand stage for deficit 15+', () => {
    system.activateBet('team-a');
    for (const deficit of [15, 20, 30]) {
      const result = system.getStage(deficit);
      expect(result).not.toBeNull();
      expect(result!.stage).toBe('last-stand');
      expect(result!.deficit).toBe(deficit);
    }
  });

  it('grants starting powerup tier scaled to deficit (tier at 15 > tier at 4)', () => {
    const tierAtSmall = system.getEntryPowerupTier(4);
    const tierAtMedium = system.getEntryPowerupTier(7);
    const tierAtLarge = system.getEntryPowerupTier(15);

    expect(tierAtSmall).toBe(1);
    expect(tierAtMedium).toBe(2);
    expect(tierAtLarge).toBe(3);
    expect(tierAtLarge).toBeGreaterThan(tierAtSmall);
  });

  it('findReplacementTarget picks player with lowest performance score', () => {
    const performers = [
      { id: 'p1', score: 72 },
      { id: 'p2', score: 45 },
      { id: 'p3', score: 88 },
      { id: 'p4', score: 51 },
    ];

    const target = SubInSystem.findReplacementTarget(performers);
    expect(target).toBe('p2');
  });

  it('disables after executeSubIn() is called', () => {
    system.activateBet('team-a');
    expect(system.getStage(10)).not.toBeNull();

    system.executeSubIn();

    expect(system.getStage(10)).toBeNull();
  });
});
