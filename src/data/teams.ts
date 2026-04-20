import type { TeamData, TeamArchetype, PlayerData, PlayerStats, Position } from '@/core/types';
import { POSITION_STATS } from '@/core/types';

// --- Name generation pools ---
//
// Theme: weekend-warrior office-league. Teams are named after the dad-life
// sponsor/workplace they're rep'ing. Names combine a PREFIX (a guy's name
// or office job) with a SUFFIX (the sport mascot energy filtered through
// middle-age). Mascots are what they CALL themselves, not what a logo would
// actually look like.

const NAME_PREFIXES: string[] = [
  // First-name/owner teams — "Bob's ___", etc.
  "Dave's", "Bob's", "Steve's", "Greg's", "Rick's", "Paul's", "Doug's",
  "Jerry's", "Terry's", "Larry's", "Barry's", "Gary's", "Harry's",
  // Workplace-sponsor teams
  'HR Department', 'Sales Division', 'Legal Team', 'IT Department',
  'Breakroom', 'Warehouse', 'Accounting', 'Marketing', 'Dispatch',
  'Loading Dock', 'Night Shift', 'Middle Management', 'Regional Office',
  // Middle-aged-life descriptors
  'Mid-Life', 'Weekend', 'Over-40', 'Beer League', 'Church League',
  'YMCA', 'Rec Center', 'Cul-de-Sac', 'Suburbia', 'Minivan',
];

const NAME_SUFFIXES: string[] = [
  "Ballers", 'Bros', 'Brigade', 'Crew', 'Squad',
  "Boys Club", 'Committee', 'Coalition', 'Collective', 'Crisis',
  'Champions', 'Chumps', 'Contenders', 'Pretenders',
];

const MASCOTS: string[] = [
  'Brewers', 'Grillers', 'Mower Men', 'Khakis', 'Dad Jokes',
  'Polo Shirts', 'Minivans', 'Lawn Kings', 'Fantasy Leaguers', 'Cornhole Kings',
  'Recliners', 'Snorers', 'Sunday Drivers', 'Home Improvers', 'Grill Masters',
  'Lawn Men', 'Garage Band', 'Golf Carts', 'Bourbon Bros', 'Sprinkler Squad',
  'Lawn Chairs', 'Tool Time', 'Briefcases', 'Ties & Dies', 'Deck Chairs',
  "Father Figures", 'Glory Days', 'Second Winds', 'Knee Braces', 'Back Spasms',
];

const COLOR_PALETTES: { primary: string; secondary: string }[] = [
  { primary: '#C41E3A', secondary: '#FFD700' },
  { primary: '#003366', secondary: '#FF6600' },
  { primary: '#228B22', secondary: '#FFFFFF' },
  { primary: '#4B0082', secondary: '#DAA520' },
  { primary: '#8B0000', secondary: '#C0C0C0' },
  { primary: '#00008B', secondary: '#FF4500' },
  { primary: '#006400', secondary: '#FFD700' },
  { primary: '#2F4F4F', secondary: '#FF6347' },
  { primary: '#191970', secondary: '#F0E68C' },
  { primary: '#800020', secondary: '#E8E8E8' },
  { primary: '#1C1C1C', secondary: '#FF8C00' },
  { primary: '#0D47A1', secondary: '#FFEB3B' },
  { primary: '#4A148C', secondary: '#E0E0E0' },
  { primary: '#B71C1C', secondary: '#212121' },
  { primary: '#1B5E20', secondary: '#FAFAFA' },
  { primary: '#E65100', secondary: '#263238' },
];

// --- Archetypes ---

const ARCHETYPES: TeamArchetype[] = [
  'Run & Gun', 'Fortress', 'Sharpshooters', 'Inside Beasts', 'Balanced', 'Chaos',
];

const ARCHETYPE_STATS: Record<TeamArchetype, PlayerStats> = {
  'Run & Gun':      { speed: 8, shooting: 6, defense: 4, passing: 7, dunkPower: 5 },
  'Fortress':       { speed: 4, shooting: 5, defense: 9, passing: 6, dunkPower: 6 },
  'Sharpshooters':  { speed: 5, shooting: 9, defense: 4, passing: 7, dunkPower: 3 },
  'Inside Beasts':  { speed: 4, shooting: 4, defense: 6, passing: 5, dunkPower: 9 },
  'Balanced':       { speed: 6, shooting: 6, defense: 6, passing: 6, dunkPower: 6 },
  'Chaos':          { speed: 7, shooting: 5, defense: 5, passing: 5, dunkPower: 8 },
};

// --- Player name pools ---

const FIRST_NAMES: string[] = [
  'Marcus', 'Jaylen', 'Darius', 'Terrence', 'Xavier',
  'DeShawn', 'Khalil', 'Andre', 'Malik', 'Tyrell',
  'Brandon', 'Corey', 'Isaiah', 'Jamal', 'Devon',
  'Rashid', 'Cameron', 'Kareem', 'Lamar', 'Quincy',
];

const LAST_NAMES: string[] = [
  'Williams', 'Johnson', 'Davis', 'Brown', 'Thompson',
  'Jackson', 'Harris', 'Robinson', 'Clark', 'Lewis',
  'Walker', 'Young', 'Allen', 'King', 'Wright',
  'Hill', 'Scott', 'Green', 'Adams', 'Baker',
];

const PERSONALITIES: PlayerData['personality'][] = [
  'Clutch', 'Ball Hog', 'Lockdown', 'Spark Plug', 'Team Player',
];

// --- Marquee teams ---

// Marquee teams — the #1-seeded office-league powerhouses. These are the
// Dukes and Kansases of weekend men's ball: the team everyone pencils into
// the Final Four of their workplace bracket.
export const MARQUEE_TEAMS: Partial<TeamData>[] = [
  {
    name: "Dave's Brewers",
    mascot: 'Brewers',
    colors: { primary: '#8B4513', secondary: '#F4A460' }, // bourbon brown
    archetype: 'Sharpshooters' as TeamArchetype,
  },
  {
    name: 'Accounting Animals',
    mascot: 'Ledger Lions',
    colors: { primary: '#2C3E50', secondary: '#ECF0F1' }, // business casual navy
    archetype: 'Run & Gun' as TeamArchetype,
  },
  {
    name: 'Mid-Life Crisis Crew',
    mascot: 'Crisis',
    colors: { primary: '#C41E3A', secondary: '#FFD700' }, // red convertible
    archetype: 'Inside Beasts' as TeamArchetype,
  },
  {
    name: 'HR Department Hammers',
    mascot: 'Hammers',
    colors: { primary: '#0051BA', secondary: '#E8000D' }, // corporate polo
    archetype: 'Balanced' as TeamArchetype,
  },
  {
    name: "Bob's Breakroom Ballers",
    mascot: 'Ballers',
    colors: { primary: '#002967', secondary: '#C8102E' }, // beverage cooler
    archetype: 'Fortress' as TeamArchetype,
  },
  {
    name: 'Cul-de-Sac Sharpshooters',
    mascot: 'Sharpshooters',
    colors: { primary: '#228B22', secondary: '#FFFFFF' }, // fresh-mowed green
    archetype: 'Sharpshooters' as TeamArchetype,
  },
  {
    name: 'Sunday-Drive Spartans',
    mascot: 'Spartans',
    colors: { primary: '#18453B', secondary: '#FFFFFF' }, // forest-green cargo shorts
    archetype: 'Fortress' as TeamArchetype,
  },
  {
    name: 'Grillmaster Gang',
    mascot: 'Grillers',
    colors: { primary: '#E65100', secondary: '#263238' }, // charcoal + flame orange
    archetype: 'Run & Gun' as TeamArchetype,
  },
  {
    name: 'Minivan Mafia',
    mascot: 'Minivans',
    colors: { primary: '#D44500', secondary: '#002D72' }, // soccer-parent palette
    archetype: 'Chaos' as TeamArchetype,
  },
  {
    name: 'Back-Spasm Brigade',
    mascot: 'Brigade',
    colors: { primary: '#AD0000', secondary: '#000000' }, // ice-pack red
    archetype: 'Inside Beasts' as TeamArchetype,
  },
];

// --- Helpers ---

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export function generatePlayerForArchetype(archetype: TeamArchetype, seed: number): PlayerData {
  const base = ARCHETYPE_STATS[archetype];
  const rng = seededRandom(seed * 31 + archetype.length * 17);

  // Top seeds (1-4) get a stat bonus
  const seedBonus = seed <= 4 ? (5 - seed) * 0.4 : 0;

  const vary = (stat: number): number => {
    const delta = (rng() - 0.5) * 3;
    return clamp(Math.round(stat + delta + seedBonus), 1, 10);
  };

  const stats: PlayerStats = {
    speed: vary(base.speed),
    shooting: vary(base.shooting),
    defense: vary(base.defense),
    passing: vary(base.passing),
    dunkPower: vary(base.dunkPower),
  };

  const firstIdx = Math.floor(rng() * FIRST_NAMES.length);
  const lastIdx = Math.floor(rng() * LAST_NAMES.length);
  const personalityIdx = Math.floor(rng() * PERSONALITIES.length);

  return {
    id: `player-${seed}-${archetype}-${firstIdx}-${lastIdx}`,
    name: `${FIRST_NAMES[firstIdx]} ${LAST_NAMES[lastIdx]}`,
    stats,
    personality: PERSONALITIES[personalityIdx],
    isCustom: false,
  };
}

// --- Main generator ---

export function generateTeams(playerCount: number = 3): TeamData[] {
  const teams: TeamData[] = [];
  const usedNames = new Set<string>();

  // Place marquee teams at top seeds across the 4 regions
  // We have 10 marquee teams; assign them seeds 1-3 across regions (and some at seed 2-3)
  const marqueeQueue = [...MARQUEE_TEAMS];
  const regions = 4;
  const seedsPerRegion = 16;

  // Assign marquee teams to top seeds first
  let marqueeSeed = 1;
  let marqueeRegion = 0;
  const assignedPositions: { seed: number; region: number }[] = [];

  for (let i = 0; i < marqueeQueue.length; i++) {
    assignedPositions.push({ seed: marqueeSeed, region: marqueeRegion });
    marqueeRegion++;
    if (marqueeRegion >= regions) {
      marqueeRegion = 0;
      marqueeSeed++;
    }
  }

  // Create marquee team entries
  for (let i = 0; i < marqueeQueue.length; i++) {
    const partial = marqueeQueue[i];
    const { seed } = assignedPositions[i];
    const archetype = partial.archetype ?? 'Balanced';

    const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
    const players: PlayerData[] = [];
    for (let p = 0; p < playerCount; p++) {
      const player = generatePlayerForArchetype(archetype, seed + p * 100 + i * 7);
      if (playerCount === 5 && p < positions.length) {
        player.position = positions[p];
        const posStats = POSITION_STATS[positions[p]];
        player.stats = {
          speed: Math.round((player.stats.speed + posStats.speed) / 2),
          shooting: Math.round((player.stats.shooting + posStats.shooting) / 2),
          defense: Math.round((player.stats.defense + posStats.defense) / 2),
          passing: Math.round((player.stats.passing + posStats.passing) / 2),
          dunkPower: Math.round((player.stats.dunkPower + posStats.dunkPower) / 2),
        };
      }
      players.push(player);
    }

    const team: TeamData = {
      id: `team-marquee-${i}`,
      name: partial.name!,
      mascot: partial.mascot!,
      colors: partial.colors!,
      archetype,
      seed,
      players,
    };

    teams.push(team);
    usedNames.add(team.name);
  }

  // Track how many teams are at each seed so far
  const seedCounts: Record<number, number> = {};
  for (let s = 1; s <= seedsPerRegion; s++) {
    seedCounts[s] = 0;
  }
  for (const team of teams) {
    seedCounts[team.seed]++;
  }

  // Fill the remaining slots
  const totalTeams = regions * seedsPerRegion; // 64
  let prefixIdx = 0;
  let suffixIdx = 0;
  let mascotIdx = 0;
  let colorIdx = 0;
  let generatedCounter = 0;

  for (let seed = 1; seed <= seedsPerRegion; seed++) {
    while (seedCounts[seed] < regions) {
      // Generate a unique name
      let name = '';
      let attempts = 0;
      while (attempts < 200) {
        const prefix = NAME_PREFIXES[prefixIdx % NAME_PREFIXES.length];
        const suffix = NAME_SUFFIXES[suffixIdx % NAME_SUFFIXES.length];
        name = `${prefix} ${suffix}`;
        prefixIdx++;
        if (prefixIdx % NAME_PREFIXES.length === 0) {
          suffixIdx++;
        }
        if (!usedNames.has(name)) {
          break;
        }
        attempts++;
      }

      usedNames.add(name);

      const mascot = MASCOTS[mascotIdx % MASCOTS.length];
      mascotIdx++;

      const palette = COLOR_PALETTES[colorIdx % COLOR_PALETTES.length];
      colorIdx++;

      const archetype = ARCHETYPES[generatedCounter % ARCHETYPES.length];

      const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
      const players: PlayerData[] = [];
      for (let p = 0; p < playerCount; p++) {
        const player = generatePlayerForArchetype(archetype, seed + p * 100 + generatedCounter * 13);
        if (playerCount === 5 && p < positions.length) {
          player.position = positions[p];
          const posStats = POSITION_STATS[positions[p]];
          player.stats = {
            speed: Math.round((player.stats.speed + posStats.speed) / 2),
            shooting: Math.round((player.stats.shooting + posStats.shooting) / 2),
            defense: Math.round((player.stats.defense + posStats.defense) / 2),
            passing: Math.round((player.stats.passing + posStats.passing) / 2),
            dunkPower: Math.round((player.stats.dunkPower + posStats.dunkPower) / 2),
          };
        }
        players.push(player);
      }

      const team: TeamData = {
        id: `team-gen-${generatedCounter}`,
        name,
        mascot,
        colors: { primary: palette.primary, secondary: palette.secondary },
        archetype,
        seed,
        players,
      };

      teams.push(team);
      seedCounts[seed]++;
      generatedCounter++;
    }
  }

  return teams;
}
