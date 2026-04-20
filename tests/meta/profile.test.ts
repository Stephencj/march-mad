// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  STARTING_CASH,
  ALL_IN,
  createProfile,
  loadProfiles,
  saveProfiles,
  getActiveProfileId,
  setActiveProfileId,
  getActiveProfile,
  deleteProfile,
  SessionWallet,
} from '@/meta/profile';

/** Clean localStorage between tests so each one starts from nothing. */
beforeEach(() => {
  localStorage.clear();
});

describe('profile storage', () => {
  it('starts with no profiles', () => {
    expect(loadProfiles()).toEqual([]);
    expect(getActiveProfileId()).toBeNull();
  });

  it('createProfile persists and activates', () => {
    const p = createProfile('Bob');
    expect(p.name).toBe('Bob');
    expect(p.cash).toBe(STARTING_CASH);
    expect(p.wins).toBe(0);
    expect(loadProfiles()).toHaveLength(1);
    expect(getActiveProfileId()).toBe(p.id);
    expect(getActiveProfile()?.name).toBe('Bob');
  });

  it('trims whitespace-only names to "Player"', () => {
    const p = createProfile('   ');
    expect(p.name).toBe('Player');
  });

  it('deleteProfile removes and clears active if matched', () => {
    const a = createProfile('A');
    const b = createProfile('B');
    setActiveProfileId(a.id);
    deleteProfile(a.id);
    expect(loadProfiles().map(p => p.id)).toEqual([b.id]);
    expect(getActiveProfileId()).toBeNull();
  });

  it('deleteProfile of a non-active keeps the active pointer', () => {
    const a = createProfile('A');
    const b = createProfile('B');
    setActiveProfileId(a.id);
    deleteProfile(b.id);
    expect(getActiveProfileId()).toBe(a.id);
  });

  it('corrupt localStorage yields empty list without throwing', () => {
    localStorage.setItem('mm:profiles', '{not json');
    expect(loadProfiles()).toEqual([]);
  });

  it('saveProfiles round-trips', () => {
    const p = createProfile('Z');
    p.cash = 42;
    saveProfiles([p]);
    expect(loadProfiles()[0].cash).toBe(42);
  });
});

describe('SessionWallet — guest', () => {
  it('starts with STARTING_CASH and reports isGuest', () => {
    const w = new SessionWallet(null);
    expect(w.isGuest()).toBe(true);
    expect(w.getCash()).toBe(STARTING_CASH);
    expect(w.getDisplayName()).toBe('Guest');
  });

  it('settleMatch win adds the bet', () => {
    const w = new SessionWallet(null);
    const entry = w.settleMatch(25, 'win');
    expect(w.getCash()).toBe(STARTING_CASH + 25);
    expect(entry.delta).toBe(25);
    expect(entry.balanceAfter).toBe(STARTING_CASH + 25);
  });

  it('settleMatch loss deducts', () => {
    const w = new SessionWallet(null);
    w.settleMatch(25, 'loss');
    expect(w.getCash()).toBe(STARTING_CASH - 25);
  });

  it('cash floors at 0', () => {
    const w = new SessionWallet(null);
    w.settleMatch(9999, 'loss');
    expect(w.getCash()).toBe(0);
  });

  it('guest stats are not persisted until saveGuestAs', () => {
    const w = new SessionWallet(null);
    w.settleMatch(10, 'win');
    w.settleMatch(5, 'loss');
    expect(loadProfiles()).toHaveLength(0);
    expect(w.guestGameCount()).toBe(2);
  });

  it('saveGuestAs promotes the wallet to a persisted profile', () => {
    const w = new SessionWallet(null);
    w.settleMatch(10, 'win');
    w.settleMatch(10, 'win');
    const p = w.saveGuestAs('DadBob');
    expect(p.name).toBe('DadBob');
    expect(p.cash).toBe(STARTING_CASH + 20);
    expect(p.wins).toBe(2);
    expect(p.history).toHaveLength(2);
    expect(w.isGuest()).toBe(false);
    expect(loadProfiles()).toHaveLength(1);
    expect(getActiveProfileId()).toBe(p.id);
    // After save, guestGameCount resets so a subsequent prompt doesn't double-fire
    expect(w.guestGameCount()).toBe(0);
  });
});

describe('SessionWallet — persisted profile', () => {
  it('reads cash from the live profile', () => {
    const p = createProfile('Zoe');
    const w = new SessionWallet(p);
    expect(w.isGuest()).toBe(false);
    expect(w.getCash()).toBe(STARTING_CASH);
    expect(w.getDisplayName()).toBe('Zoe');
  });

  it('settleMatch writes cash back to localStorage', () => {
    const p = createProfile('Zoe');
    const w = new SessionWallet(p);
    w.settleMatch(30, 'win');
    const reloaded = loadProfiles().find(x => x.id === p.id)!;
    expect(reloaded.cash).toBe(STARTING_CASH + 30);
    expect(reloaded.wins).toBe(1);
    expect(reloaded.betsWon).toBe(1);
    expect(reloaded.history).toHaveLength(1);
  });

  it('settleMatch loss updates losses count and history', () => {
    const p = createProfile('Zoe');
    const w = new SessionWallet(p);
    w.settleMatch(10, 'loss');
    const reloaded = loadProfiles().find(x => x.id === p.id)!;
    expect(reloaded.cash).toBe(STARTING_CASH - 10);
    expect(reloaded.losses).toBe(1);
    expect(reloaded.betsWon).toBe(0);
    expect(reloaded.history[0].result).toBe('loss');
  });

  it('resolveBet expands ALL_IN to current cash', () => {
    const p = createProfile('Zoe');
    const w = new SessionWallet(p);
    expect(w.resolveBet(ALL_IN)).toBe(STARTING_CASH);
    w.settleMatch(40, 'loss');
    expect(w.resolveBet(ALL_IN)).toBe(STARTING_CASH - 40);
    expect(w.resolveBet(25)).toBe(25);
  });
});
