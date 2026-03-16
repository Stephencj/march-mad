import { describe, it, expect } from 'vitest';
import { getDifficultyModifiers } from '@/ai/difficulty';

describe('getDifficultyModifiers', () => {
  it('1-seed is harder than 16-seed (lower reactionTime, higher accuracyMod)', () => {
    const seed1 = getDifficultyModifiers(1, 1);
    const seed16 = getDifficultyModifiers(16, 1);

    expect(seed1.reactionTime).toBeLessThan(seed16.reactionTime);
    expect(seed1.accuracyMod).toBeGreaterThan(seed16.accuracyMod);
  });

  it('later tournament rounds increase difficulty (round 6 > round 1 for same seed)', () => {
    const round1 = getDifficultyModifiers(8, 1);
    const round6 = getDifficultyModifiers(8, 6);

    expect(round6.reactionTime).toBeLessThan(round1.reactionTime);
    expect(round6.accuracyMod).toBeGreaterThan(round1.accuracyMod);
    expect(round6.decisionQuality).toBeGreaterThan(round1.decisionQuality);
  });

  it('all modifiers stay within bounds for all seed/round combos', () => {
    for (let seed = 1; seed <= 16; seed++) {
      for (let round = 1; round <= 6; round++) {
        const mods = getDifficultyModifiers(seed, round);

        expect(mods.reactionTime).toBeGreaterThan(0);
        expect(mods.reactionTime).toBeLessThan(2);

        expect(mods.accuracyMod).toBeGreaterThanOrEqual(0.3);
        expect(mods.accuracyMod).toBeLessThanOrEqual(1.2);

        expect(mods.decisionQuality).toBeGreaterThanOrEqual(0.3);
        expect(mods.decisionQuality).toBeLessThanOrEqual(1.0);
      }
    }
  });
});
