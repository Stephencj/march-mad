import { PlayerData, PlayerStats, PersonalityTrait, TournamentTier } from '@/core/types';

const FIRST_NAMES: string[] = [
  'Jamal', 'DeShawn', 'Marcus', 'Tyrese', 'Andre',
  'Kwame', 'Isaiah', 'Darius', 'Terrence', 'Malik',
  'Javon', 'Rasheed', 'Cameron', 'Xavier', 'Donovan',
  'Kendrick', 'Lamar', 'Bryce', 'Trevon', 'Zion',
  'Jalen', 'Kyrie', 'Damian', 'Jaylen',
];

const LAST_NAMES: string[] = [
  'Williams', 'Johnson', 'Brown', 'Davis', 'Jackson',
  'Thompson', 'Harris', 'Robinson', 'Clark', 'Lewis',
  'Walker', 'Hall', 'Allen', 'Young', 'King',
  'Wright', 'Scott', 'Green', 'Baker', 'Adams',
  'Nelson', 'Carter',
];

const PERSONALITIES: PersonalityTrait[] = [
  'Clutch', 'Ball Hog', 'Lockdown', 'Spark Plug', 'Team Player',
];

const TIER_STAT_RANGES: Record<TournamentTier, { min: number; max: number }> = {
  casual: { min: 3, max: 7 },
  sweet16: { min: 4, max: 8 },
  season: { min: 5, max: 9 },
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomStats(tier: TournamentTier): PlayerStats {
  const { min, max } = TIER_STAT_RANGES[tier];
  return {
    speed: randomInt(min, max),
    shooting: randomInt(min, max),
    defense: randomInt(min, max),
    passing: randomInt(min, max),
    dunkPower: randomInt(min, max),
  };
}

let poolIdCounter = 0;

export function generateDraftPool(tier: TournamentTier, count: number = 12): PlayerData[] {
  const pool: PlayerData[] = [];

  for (let i = 0; i < count; i++) {
    poolIdCounter++;
    const firstName = randomElement(FIRST_NAMES);
    const lastName = randomElement(LAST_NAMES);

    pool.push({
      id: `draft-player-${poolIdCounter}-${Date.now()}`,
      name: `${firstName} ${lastName}`,
      stats: generateRandomStats(tier),
      personality: randomElement(PERSONALITIES),
      isCustom: false,
    });
  }

  return pool;
}
