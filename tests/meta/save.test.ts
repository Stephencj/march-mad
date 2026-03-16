import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SaveSystem } from '@/meta/save';

describe('SaveSystem', () => {
  let save: SaveSystem;
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value; },
      removeItem: (key: string) => { delete storage[key]; },
    });
    save = new SaveSystem();
  });

  it('saves and loads player data', () => {
    const data = { coins: 500, reputation: 75, level: 3, xp: 350 };
    save.savePlayerData(data);
    const loaded = save.loadPlayerData();
    expect(loaded).toEqual(data);
  });

  it('returns null when no save exists', () => {
    const loaded = save.loadPlayerData();
    expect(loaded).toBeNull();
  });

  it('saves and loads tournament state', () => {
    const state = {
      round: 2,
      bracket: [['TeamA', 'TeamB'], ['TeamC', 'TeamD']],
      scores: { TeamA: 78, TeamB: 65 },
    };
    save.saveTournamentState(state);
    const loaded = save.loadTournamentState();
    expect(loaded).toEqual(state);
  });
});
