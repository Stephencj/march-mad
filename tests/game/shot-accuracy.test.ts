import { describe, it, expect } from 'vitest';
import { calculateShotSuccess, ShotContext } from '@/game/shot-accuracy';

function runTrials(ctx: ShotContext, count: number): number {
  let made = 0;
  for (let i = 0; i < count; i++) {
    if (calculateShotSuccess(ctx)) made++;
  }
  return made;
}

describe('calculateShotSuccess', () => {
  it('layup success rate >60% over 100 trials', () => {
    const made = runTrials(
      { distance: 1.5, shootingStat: 7, defenderDistance: 3, shotType: 'layup' },
      100
    );
    expect(made).toBeGreaterThan(60);
  });

  it('dunk nearly guaranteed >85% over 100 trials', () => {
    const made = runTrials(
      { distance: 1, shootingStat: 7, defenderDistance: 4, shotType: 'dunk' },
      100
    );
    expect(made).toBeGreaterThan(85);
  });

  it('half court shot <5% over 200 trials', () => {
    const made = runTrials(
      { distance: 14, shootingStat: 10, defenderDistance: 5, shotType: 'three-pointer' },
      200
    );
    expect(made).toBeLessThan(10);
  });

  it('contested shot harder than open shot', () => {
    const contested = runTrials(
      { distance: 5, shootingStat: 7, defenderDistance: 1, shotType: 'mid-range' },
      500
    );
    const open = runTrials(
      { distance: 5, shootingStat: 7, defenderDistance: 5, shotType: 'mid-range' },
      500
    );
    expect(open).toBeGreaterThan(contested);
  });

  it('higher shooting stat means better accuracy', () => {
    const low = runTrials(
      { distance: 5, shootingStat: 3, defenderDistance: 3, shotType: 'mid-range' },
      500
    );
    const high = runTrials(
      { distance: 5, shootingStat: 9, defenderDistance: 3, shotType: 'mid-range' },
      500
    );
    expect(high).toBeGreaterThan(low);
  });
});
