// --- Player ---
export interface PlayerStats {
  speed: number;      // 1-10
  shooting: number;   // 1-10
  defense: number;    // 1-10
  passing: number;    // 1-10
  dunkPower: number;  // 1-10
}

export function createDefaultPlayerStats(): PlayerStats {
  return { speed: 5, shooting: 5, defense: 5, passing: 5, dunkPower: 5 };
}

export type PersonalityTrait = 'Clutch' | 'Ball Hog' | 'Lockdown' | 'Spark Plug' | 'Team Player';

// --- Position ---
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export const POSITION_STATS: Record<Position, PlayerStats> = {
  PG: { speed: 9, shooting: 7, defense: 5, passing: 8, dunkPower: 4 },
  SG: { speed: 7, shooting: 9, defense: 5, passing: 6, dunkPower: 5 },
  SF: { speed: 7, shooting: 7, defense: 7, passing: 6, dunkPower: 7 },
  PF: { speed: 5, shooting: 5, defense: 8, passing: 5, dunkPower: 8 },
  C:  { speed: 3, shooting: 3, defense: 9, passing: 4, dunkPower: 9 },
};

export const POSITION_SCALES: Record<Position, { height: number; body: number; head: number }> = {
  PG: { height: 0.85, body: 0.85, head: 1.0 },
  SG: { height: 0.95, body: 0.90, head: 1.0 },
  SF: { height: 1.0,  body: 1.0,  head: 1.05 },
  PF: { height: 1.1,  body: 1.15, head: 1.08 },
  C:  { height: 1.2,  body: 1.3,  head: 1.12 },
};

export interface PlayerData {
  id: string;
  name: string;
  stats: PlayerStats;
  personality: PersonalityTrait;
  isCustom: boolean;
  position?: Position;
}

export interface CustomPlayerData extends PlayerData {
  isCustom: true;
  appearance: PlayerAppearance;
  signatureMove: string;
  xp: number;
  level: number;
}

export interface PlayerAppearance {
  bodyType: number;
  hairStyle: number;
  skinTone: number;
  jerseyNumber: number;
}

// --- Team ---
export type TeamArchetype = 'Run & Gun' | 'Fortress' | 'Sharpshooters' | 'Inside Beasts' | 'Balanced' | 'Chaos';

export interface TeamData {
  id: string;
  name: string;
  mascot: string;
  colors: { primary: string; secondary: string };
  archetype: TeamArchetype;
  seed: number;
  players: PlayerData[];
}

// --- Match ---
export type GamePhase = 'pre-game' | 'playing' | 'check-ball' | 'foul' | 'post-game';
export type Possession = 'home' | 'away';

export interface MatchState {
  homeTeam: TeamData;
  awayTeam: TeamData;
  homeScore: number;
  awayScore: number;
  possession: Possession;
  phase: GamePhase;
  clockSeconds: number;
  powerupMeter: number;
}

// --- Powerups ---
export type PowerupType =
  | 'speed-burst' | 'hot-hand' | 'sticky-fingers'
  | 'on-fire' | 'phantom-step' | 'brick-wall'
  | 'giant-ball' | 'trampoline' | 'force-field';

export interface PowerupTier {
  tier: number;
  minDeficit: number;
  maxDeficit: number;
  types: PowerupType[];
}

export const POWERUP_TIERS: Record<number, PowerupTier> = {
  1: { tier: 1, minDeficit: 1, maxDeficit: 4, types: ['speed-burst', 'hot-hand', 'sticky-fingers'] },
  2: { tier: 2, minDeficit: 5, maxDeficit: 9, types: ['on-fire', 'phantom-step', 'brick-wall'] },
  3: { tier: 3, minDeficit: 10, maxDeficit: Infinity, types: ['giant-ball', 'trampoline', 'force-field'] },
};

// --- Crowd ---
export type CrowdLevel = 'CALM' | 'ENGAGED' | 'HYPED' | 'ROWDY' | 'CHAOS';
export const CROWD_LEVELS: CrowdLevel[] = ['CALM', 'ENGAGED', 'HYPED', 'ROWDY', 'CHAOS'];

// --- Betting ---
export interface BetData {
  teamId: string;
  coinAmount: number;
  repAmount: number;
  odds: number;
  subbedIn: boolean;
}

// --- Tournament ---
export type TournamentTier = 'casual' | 'sweet16' | 'season';

export interface TournamentConfig {
  tier: TournamentTier;
  teamCount: number;
  rounds: number;
}

export const TOURNAMENT_CONFIGS: Record<TournamentTier, TournamentConfig> = {
  casual: { tier: 'casual', teamCount: 8, rounds: 3 },
  sweet16: { tier: 'sweet16', teamCount: 16, rounds: 4 },
  season: { tier: 'season', teamCount: 64, rounds: 6 },
};

// --- Game Mode ---
export type GameMode = '3v3' | '5v5';

// --- Game State Machine ---
export type AppState =
  | 'MainMenu' | 'PlayerCreation' | 'TournamentSelect' | 'DraftPhase'
  | 'BracketView' | 'YourGame' | 'Spectating' | 'BettingOverlay'
  | 'SubInCinematic' | 'PostGame' | 'TournamentEnd';

// --- Scoring ---
export type ShotType = 'layup' | 'mid-range' | 'three-pointer' | 'dunk' | 'alley-oop' | 'powerup-dunk';

export const SHOT_POINTS: Record<ShotType, number> = {
  'layup': 1,
  'mid-range': 1,
  'three-pointer': 2,
  'dunk': 2,
  'alley-oop': 2,
  'powerup-dunk': 3,
};
