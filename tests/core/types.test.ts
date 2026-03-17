import { describe, it, expect } from 'vitest';
import {
  type PlayerStats, type TeamData, type MatchState, type PowerupType,
  type CrowdLevel, type GamePhase, type BetData, type PersonalityTrait,
  type TeamArchetype, type TournamentTier,
  createDefaultPlayerStats, CROWD_LEVELS, POWERUP_TIERS, POSITION_SCALES,
} from '@/core/types';

describe('types', () => {
  it('creates default player stats with valid ranges', () => {
    const stats = createDefaultPlayerStats();
    expect(stats.speed).toBeGreaterThanOrEqual(1);
    expect(stats.speed).toBeLessThanOrEqual(10);
    expect(stats.shooting).toBeGreaterThanOrEqual(1);
    expect(stats.defense).toBeGreaterThanOrEqual(1);
    expect(stats.passing).toBeGreaterThanOrEqual(1);
    expect(stats.dunkPower).toBeGreaterThanOrEqual(1);
  });

  it('has 5 crowd levels in order', () => {
    expect(CROWD_LEVELS).toEqual(['CALM', 'ENGAGED', 'HYPED', 'ROWDY', 'CHAOS']);
  });

  it('maps powerup tiers to correct deficit ranges', () => {
    expect(POWERUP_TIERS[1].minDeficit).toBe(1);
    expect(POWERUP_TIERS[1].maxDeficit).toBe(4);
    expect(POWERUP_TIERS[2].minDeficit).toBe(5);
    expect(POWERUP_TIERS[2].maxDeficit).toBe(9);
    expect(POWERUP_TIERS[3].minDeficit).toBe(10);
    expect(POWERUP_TIERS[3].maxDeficit).toBe(Infinity);
  });

  it('has position scales for all 5 positions', () => {
    expect(Object.keys(POSITION_SCALES)).toHaveLength(5);
    expect(POSITION_SCALES['C'].height).toBeGreaterThan(POSITION_SCALES['PG'].height);
  });
});
