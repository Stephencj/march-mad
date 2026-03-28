import { describe, it, expect } from 'vitest';
import { calculateShotSuccess, type ShotContext } from '@/game/shot-accuracy';

function measureAccuracy(ctx: ShotContext, trials = 5000): number {
  let hits = 0;
  for (let i = 0; i < trials; i++) {
    if (calculateShotSuccess(ctx)) hits++;
  }
  return hits / trials;
}

describe('calculateShotSuccess', () => {
  it('should have ~85% base accuracy for layups', () => {
    const rate = measureAccuracy({
      distance: 1.5, shootingStat: 5, defenderDistance: 10,
      shotType: 'layup', isDefenderGuarding: false,
    });
    expect(rate).toBeGreaterThan(0.75);
    expect(rate).toBeLessThan(0.95);
  });

  it('should have ~55% base accuracy for mid-range', () => {
    const rate = measureAccuracy({
      distance: 5, shootingStat: 5, defenderDistance: 10,
      shotType: 'mid-range', isDefenderGuarding: false,
    });
    expect(rate).toBeGreaterThan(0.45);
    expect(rate).toBeLessThan(0.65);
  });

  it('should have ~40% base accuracy for three-pointers', () => {
    const rate = measureAccuracy({
      distance: 7, shootingStat: 5, defenderDistance: 10,
      shotType: 'three-pointer', isDefenderGuarding: false,
    });
    expect(rate).toBeGreaterThan(0.30);
    expect(rate).toBeLessThan(0.50);
  });

  it('should NOT penalize when defender is close but not guarding', () => {
    const unguarded = measureAccuracy({
      distance: 5, shootingStat: 5, defenderDistance: 1,
      shotType: 'mid-range', isDefenderGuarding: false,
    });
    const farAway = measureAccuracy({
      distance: 5, shootingStat: 5, defenderDistance: 10,
      shotType: 'mid-range', isDefenderGuarding: false,
    });
    expect(Math.abs(unguarded - farAway)).toBeLessThan(0.10);
  });

  it('should penalize when defender is close AND guarding', () => {
    const guarded = measureAccuracy({
      distance: 5, shootingStat: 5, defenderDistance: 1,
      shotType: 'mid-range', isDefenderGuarding: true,
    });
    const unguarded = measureAccuracy({
      distance: 5, shootingStat: 5, defenderDistance: 10,
      shotType: 'mid-range', isDefenderGuarding: false,
    });
    expect(guarded).toBeLessThan(unguarded - 0.05);
  });

  it('dunks should always succeed (100%)', () => {
    const rate = measureAccuracy({
      distance: 2, shootingStat: 5, defenderDistance: 1,
      shotType: 'dunk', isDefenderGuarding: false,
    });
    expect(rate).toBe(1.0);
  });
});
