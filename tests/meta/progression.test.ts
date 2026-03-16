import { describe, it, expect, beforeEach } from 'vitest';
import { ProgressionSystem } from '@/meta/progression';

describe('ProgressionSystem', () => {
  let progression: ProgressionSystem;

  beforeEach(() => {
    progression = new ProgressionSystem();
  });

  it('calculateXP returns > 0 for a game result', () => {
    const xp = ProgressionSystem.calculateXP({
      won: true,
      points: 8,
      assists: 3,
      subbedIn: false,
    });
    // 8*5 + 3*3 + 50 (win) = 40 + 9 + 50 = 99
    expect(xp).toBeGreaterThan(0);
    expect(xp).toBe(99);
  });

  it('sub-in wins give bonus XP', () => {
    const stats = { won: true, points: 8, assists: 3 };
    const xpWithoutSubIn = ProgressionSystem.calculateXP({ ...stats, subbedIn: false });
    const xpWithSubIn = ProgressionSystem.calculateXP({ ...stats, subbedIn: true });
    expect(xpWithSubIn).toBeGreaterThan(xpWithoutSubIn);
  });

  it('levels up at correct thresholds (100 XP = level 2, +200 more = level 3)', () => {
    progression.addXP(100);
    expect(progression.level).toBe(2);

    progression.addXP(200);
    // total XP = 300, threshold for level 3 is 300
    expect(progression.level).toBe(3);
  });

  it('grants 2 stat points per level up', () => {
    expect(progression.availableStatPoints).toBe(0);

    // Level 1 -> 2: +2 stat points
    progression.addXP(100);
    expect(progression.availableStatPoints).toBe(2);

    // Level 2 -> 3: +2 more stat points (total 4)
    progression.addXP(200);
    expect(progression.availableStatPoints).toBe(4);
  });
});
