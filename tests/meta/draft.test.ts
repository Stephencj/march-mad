import { describe, it, expect } from 'vitest';
import { DraftSystem } from '@/meta/draft';

describe('DraftSystem', () => {
  it('generates a pool of 12 players', () => {
    const draft = new DraftSystem('casual');
    expect(draft.pool).toHaveLength(12);
  });

  it('each player has stats (speed >= 1), personality (truthy), and name (truthy)', () => {
    const draft = new DraftSystem('casual');
    for (const player of draft.pool) {
      expect(player.stats.speed).toBeGreaterThanOrEqual(1);
      expect(player.personality).toBeTruthy();
      expect(player.name).toBeTruthy();
    }
  });

  it('allows picking exactly 2 players (3rd pick returns false)', () => {
    const draft = new DraftSystem('casual');
    const first = draft.pick(draft.pool[0].id);
    const second = draft.pick(draft.pool[1].id);
    const third = draft.pick(draft.pool[2].id);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(third).toBe(false);
    expect(draft.picks).toHaveLength(2);
    expect(draft.isComplete).toBe(true);
  });

  it('reroll generates fresh pool, max 2 rerolls (3rd returns false)', () => {
    const draft = new DraftSystem('casual');
    const originalIds = draft.pool.map((p) => p.id);

    const r1 = draft.reroll();
    expect(r1).toBe(true);
    expect(draft.rerollsLeft).toBe(1);
    const afterFirstReroll = draft.pool.map((p) => p.id);
    expect(afterFirstReroll).not.toEqual(originalIds);

    const r2 = draft.reroll();
    expect(r2).toBe(true);
    expect(draft.rerollsLeft).toBe(0);

    const r3 = draft.reroll();
    expect(r3).toBe(false);
    expect(draft.rerollsLeft).toBe(0);
  });

  it('season tier produces higher average stat players than casual (with generous margin)', () => {
    // Generate multiple pools and average to reduce randomness
    let casualTotal = 0;
    let seasonTotal = 0;
    const runs = 20;

    for (let i = 0; i < runs; i++) {
      const casualDraft = new DraftSystem('casual');
      const seasonDraft = new DraftSystem('season');

      for (const p of casualDraft.pool) {
        casualTotal += p.stats.speed + p.stats.shooting + p.stats.defense + p.stats.passing + p.stats.dunkPower;
      }
      for (const p of seasonDraft.pool) {
        seasonTotal += p.stats.speed + p.stats.shooting + p.stats.defense + p.stats.passing + p.stats.dunkPower;
      }
    }

    const casualAvg = casualTotal / (runs * 12 * 5);
    const seasonAvg = seasonTotal / (runs * 12 * 5);

    expect(seasonAvg).toBeGreaterThan(casualAvg);
  });
});
