/**
 * Profile + cash persistence.
 *
 * Profiles live in `localStorage` under the key `mm:profiles`. The currently
 * active profile id (if any) is stored under `mm:activeProfile`. A guest can
 * play without a profile — their cash is tracked in-memory and thrown away on
 * page reload, with a prompt to save as a profile after their first match.
 *
 * Bet payouts are 1:1 for now (win → +bet, lose → -bet). Lots of room to
 * add odds, parlays, streaks later — those all bolt onto `settleMatch()`.
 */

const STORAGE_KEY = 'mm:profiles';
const ACTIVE_KEY = 'mm:activeProfile';

export const STARTING_CASH = 100;
export const BET_TIERS = [5, 10, 25, 50] as const;
/** Sentinel for "all-in" — resolved against the active profile's cash at bet time. */
export const ALL_IN = -1;

export interface MatchHistoryEntry {
  timestamp: number;
  result: 'win' | 'loss';
  bet: number;
  delta: number; // +bet on win, -bet on loss
  balanceAfter: number;
  venueId?: 'gym' | 'rec' | 'park';
  tournamentTier?: string;
}

export interface Profile {
  id: string;
  name: string;
  cash: number;
  wins: number;
  losses: number;
  betsWon: number;
  createdAt: number;
  history: MatchHistoryEntry[];
}

/** Load every persisted profile from localStorage. Empty array if nothing saved. */
export function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isProfileShape);
  } catch {
    return [];
  }
}

function isProfileShape(v: unknown): v is Profile {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string' && typeof p.cash === 'number';
}

/** Persist all profiles, replacing the stored array wholesale. */
export function saveProfiles(profiles: Profile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.error('[profile] failed to save', err);
  }
}

/** Currently-active profile id (null = guest / not signed in). */
export function getActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveProfileId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, id);
  } catch (err) {
    console.error('[profile] failed to set active', err);
  }
}

/** Convenience — return the active profile object, or null if guest. */
export function getActiveProfile(): Profile | null {
  const id = getActiveProfileId();
  if (!id) return null;
  return loadProfiles().find(p => p.id === id) ?? null;
}

/** Create a new profile with $STARTING_CASH and set it active. */
export function createProfile(name: string): Profile {
  const trimmed = name.trim() || 'Player';
  const id = `p-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const profile: Profile = {
    id,
    name: trimmed,
    cash: STARTING_CASH,
    wins: 0,
    losses: 0,
    betsWon: 0,
    createdAt: Date.now(),
    history: [],
  };
  const all = loadProfiles();
  all.push(profile);
  saveProfiles(all);
  setActiveProfileId(id);
  return profile;
}

/** Delete a profile and, if it was active, clear the active pointer. */
export function deleteProfile(id: string): void {
  const all = loadProfiles().filter(p => p.id !== id);
  saveProfiles(all);
  if (getActiveProfileId() === id) setActiveProfileId(null);
}

/**
 * Session wallet — holds cash state for whoever is currently playing.
 * Wraps either a persisted profile or a guest (in-memory, discarded on close).
 * All cash reads/writes go through this object so the match code doesn't care
 * which kind of player it is.
 */
export class SessionWallet {
  /** `null` iff this is a guest. */
  private profileId: string | null;
  private cashInMemory: number;
  /** Set of in-memory history entries for a guest session (not persisted). */
  private guestHistory: MatchHistoryEntry[] = [];
  private guestWins = 0;
  private guestLosses = 0;
  private guestBetsWon = 0;

  constructor(profile: Profile | null) {
    this.profileId = profile?.id ?? null;
    this.cashInMemory = profile?.cash ?? STARTING_CASH;
  }

  static fromActive(): SessionWallet {
    return new SessionWallet(getActiveProfile());
  }

  /** True iff no profile is backing this wallet (guest play). */
  isGuest(): boolean {
    return this.profileId === null;
  }

  getCash(): number {
    return this.cashInMemory;
  }

  getDisplayName(): string {
    if (this.profileId === null) return 'Guest';
    const p = loadProfiles().find(p => p.id === this.profileId);
    return p?.name ?? 'Guest';
  }

  /** Resolve an ALL_IN sentinel to the current cash amount. */
  resolveBet(bet: number): number {
    return bet === ALL_IN ? this.cashInMemory : bet;
  }

  /**
   * Apply the outcome of a match. `bet` is the wager amount (post-resolution —
   * not ALL_IN). Win pays 1:1 (`+bet`), loss costs `-bet`. Cash floors at 0 —
   * a guest can't go into debt. Returns the entry so the HUD can flash the delta.
   */
  settleMatch(bet: number, result: 'win' | 'loss', meta?: Partial<MatchHistoryEntry>): MatchHistoryEntry {
    const delta = result === 'win' ? bet : -bet;
    const newCash = Math.max(0, this.cashInMemory + delta);
    this.cashInMemory = newCash;

    const entry: MatchHistoryEntry = {
      timestamp: Date.now(),
      result,
      bet,
      delta,
      balanceAfter: newCash,
      ...(meta ?? {}),
    };

    if (this.profileId === null) {
      this.guestHistory.push(entry);
      if (result === 'win') { this.guestWins++; this.guestBetsWon++; }
      else this.guestLosses++;
    } else {
      const all = loadProfiles();
      const idx = all.findIndex(p => p.id === this.profileId);
      if (idx >= 0) {
        all[idx].cash = newCash;
        if (result === 'win') { all[idx].wins++; all[idx].betsWon++; }
        else all[idx].losses++;
        all[idx].history.push(entry);
        saveProfiles(all);
      }
    }

    return entry;
  }

  /**
   * Convert an in-progress guest session into a saved profile, carrying the
   * current cash + in-memory stats. Returns the newly-created profile so the
   * caller can set it active / refresh the menu.
   */
  saveGuestAs(name: string): Profile {
    if (this.profileId !== null) {
      throw new Error('SessionWallet is already backed by a profile');
    }
    const trimmed = name.trim() || 'Player';
    const id = `p-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
    const profile: Profile = {
      id,
      name: trimmed,
      cash: this.cashInMemory,
      wins: this.guestWins,
      losses: this.guestLosses,
      betsWon: this.guestBetsWon,
      createdAt: Date.now(),
      history: [...this.guestHistory],
    };
    const all = loadProfiles();
    all.push(profile);
    saveProfiles(all);
    setActiveProfileId(id);
    this.profileId = id;
    // Guest-only stats now promoted; clear the in-memory buffers.
    this.guestHistory = [];
    this.guestWins = 0;
    this.guestLosses = 0;
    this.guestBetsWon = 0;
    return profile;
  }

  /** Count how many guest matches have been played (for the "save profile?" prompt). */
  guestGameCount(): number {
    return this.guestHistory.length;
  }
}
