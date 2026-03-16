import { describe, it, expect } from 'vitest';
import { PlayerAI, AIContext, AIAction } from '@/ai/player-ai';
import { createDefaultPlayerStats, PlayerStats } from '@/core/types';

function makeContext(overrides: Partial<AIContext> = {}): AIContext {
  return {
    hasBall: false,
    distanceToHoop: 10,
    nearestDefenderDist: 5,
    teammateOpenness: [0.5, 0.5, 0.5],
    scoreDiff: 0,
    clockSeconds: 120,
    ...overrides,
  };
}

describe('PlayerAI', () => {
  it('chooses shoot when open and near basket with high shooting stat', () => {
    const stats: PlayerStats = { ...createDefaultPlayerStats(), shooting: 9 };
    const ai = new PlayerAI(stats, 'Clutch');
    const ctx = makeContext({
      hasBall: true,
      distanceToHoop: 3,
      nearestDefenderDist: 8,
    });
    const decision = ai.decide(ctx);
    expect(decision.action).toBe('shoot');
    expect(decision.confidence).toBeGreaterThan(0.5);
  });

  it('Ball Hog personality shoots more often even when covered', () => {
    const stats: PlayerStats = { ...createDefaultPlayerStats(), shooting: 6 };
    const ai = new PlayerAI(stats, 'Ball Hog');
    const ctx = makeContext({
      hasBall: true,
      distanceToHoop: 7,
      nearestDefenderDist: 2, // tightly covered
      teammateOpenness: [0.8, 0.7, 0.6],
    });

    let shootCount = 0;
    for (let i = 0; i < 100; i++) {
      const decision = ai.decide(ctx);
      if (decision.action === 'shoot') shootCount++;
    }
    expect(shootCount).toBeGreaterThan(40);
  });

  it('Clutch personality gets stat bonuses in close games with low clock', () => {
    const stats: PlayerStats = { ...createDefaultPlayerStats(), shooting: 5 };
    const ai = new PlayerAI(stats, 'Clutch');
    const modifiers = ai.getStatModifiers(3, 30); // close game, <60s
    expect(modifiers.shootingBonus).toBeGreaterThan(0);
    expect(modifiers.speedBonus).toBeGreaterThan(0);
    expect(modifiers.defenseBonus).toBeGreaterThan(0);

    // No bonus when game is not close or plenty of time
    const noBonus = ai.getStatModifiers(10, 120);
    expect(noBonus.shootingBonus).toBe(0);
    expect(noBonus.speedBonus).toBe(0);
    expect(noBonus.defenseBonus).toBe(0);
  });

  it('Lockdown personality prefers defensive actions', () => {
    const stats: PlayerStats = { ...createDefaultPlayerStats(), defense: 8 };
    const ai = new PlayerAI(stats, 'Lockdown');
    const ctx = makeContext({
      hasBall: false,
      nearestDefenderDist: 3,
      distanceToHoop: 5,
    });
    const decision = ai.decide(ctx);
    const defensiveActions: AIAction[] = ['guard', 'steal', 'block'];
    expect(defensiveActions).toContain(decision.action);
  });

  it('Team Player passes to open teammates more than 50% of the time', () => {
    const stats: PlayerStats = { ...createDefaultPlayerStats(), passing: 7 };
    const ai = new PlayerAI(stats, 'Team Player');
    const ctx = makeContext({
      hasBall: true,
      distanceToHoop: 8,
      nearestDefenderDist: 3,
      teammateOpenness: [0.9, 0.8, 0.7],
    });

    let passCount = 0;
    for (let i = 0; i < 100; i++) {
      const decision = ai.decide(ctx);
      if (decision.action === 'pass') passCount++;
    }
    expect(passCount).toBeGreaterThan(50);
  });
});
