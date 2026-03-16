import type { TeamArchetype, Possession } from '@/core/types';

// --- Types ---

export type Tempo = 'fast' | 'moderate' | 'slow';
export type Formation = 'spread' | 'tight' | 'balanced';
export type Zone = 'paint' | 'mid-range' | 'three-point' | 'any';

export interface TeamPlay {
  tempo: Tempo;
  formation: Formation;
  preferredZone: Zone;
}

export interface TeamContext {
  possession: Possession;
  scoreDiff: number;
  clockSeconds: number;
}

export interface FormationPosition {
  x: number;
  z: number;
}

// --- Play presets per archetype ---

interface PlayPreset {
  tempo: Tempo;
  formation: Formation;
  preferredZone: Zone;
}

export const ARCHETYPE_PLAYS: Record<TeamArchetype, { offense: PlayPreset; defense: PlayPreset }> = {
  'Run & Gun': {
    offense: { tempo: 'fast', formation: 'spread', preferredZone: 'three-point' },
    defense: { tempo: 'fast', formation: 'balanced', preferredZone: 'any' },
  },
  'Fortress': {
    offense: { tempo: 'slow', formation: 'tight', preferredZone: 'paint' },
    defense: { tempo: 'slow', formation: 'tight', preferredZone: 'paint' },
  },
  'Sharpshooters': {
    offense: { tempo: 'moderate', formation: 'spread', preferredZone: 'three-point' },
    defense: { tempo: 'moderate', formation: 'balanced', preferredZone: 'mid-range' },
  },
  'Inside Beasts': {
    offense: { tempo: 'moderate', formation: 'tight', preferredZone: 'paint' },
    defense: { tempo: 'slow', formation: 'tight', preferredZone: 'paint' },
  },
  'Balanced': {
    offense: { tempo: 'moderate', formation: 'balanced', preferredZone: 'mid-range' },
    defense: { tempo: 'moderate', formation: 'balanced', preferredZone: 'mid-range' },
  },
  'Chaos': {
    offense: { tempo: 'fast', formation: 'spread', preferredZone: 'any' },
    defense: { tempo: 'fast', formation: 'spread', preferredZone: 'any' },
  },
};

// --- Formation positions (3 players on a half-court) ---

export const FORMATIONS: Record<Formation, FormationPosition[]> = {
  spread: [
    { x: -6, z: 3 },
    { x: 6, z: 3 },
    { x: 0, z: 8 },
  ],
  tight: [
    { x: -2, z: 2 },
    { x: 2, z: 2 },
    { x: 0, z: 4 },
  ],
  balanced: [
    { x: -4, z: 3 },
    { x: 4, z: 3 },
    { x: 0, z: 6 },
  ],
};

// --- All possible options for Chaos random selection ---

const ALL_TEMPOS: Tempo[] = ['fast', 'moderate', 'slow'];
const ALL_FORMATIONS: Formation[] = ['spread', 'tight', 'balanced'];
const ALL_ZONES: Zone[] = ['paint', 'mid-range', 'three-point', 'any'];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- TeamAI class ---

export class TeamAI {
  private archetype: TeamArchetype;

  constructor(archetype: TeamArchetype) {
    this.archetype = archetype;
  }

  choosePlay(ctx: TeamContext): TeamPlay {
    // Chaos archetype: fully random
    if (this.archetype === 'Chaos') {
      return {
        tempo: pickRandom(ALL_TEMPOS),
        formation: pickRandom(ALL_FORMATIONS),
        preferredZone: pickRandom(ALL_ZONES),
      };
    }

    // Get base preset based on possession
    const presets = ARCHETYPE_PLAYS[this.archetype];
    const base = ctx.possession === 'home' || ctx.possession === 'away'
      ? { ...presets.offense }
      : { ...presets.offense };

    // Apply some randomness: ~20% chance to deviate from preset
    let play: TeamPlay = { ...base };
    if (Math.random() < 0.2) {
      play.tempo = pickRandom(ALL_TEMPOS);
    }
    if (Math.random() < 0.2) {
      play.formation = pickRandom(ALL_FORMATIONS);
    }
    if (Math.random() < 0.2) {
      play.preferredZone = pickRandom(ALL_ZONES);
    }

    // Late-game adjustments: override tempo when clock < 30s
    if (ctx.clockSeconds < 30) {
      if (ctx.scoreDiff < 0) {
        // Losing → push tempo
        play.tempo = 'fast';
      } else if (ctx.scoreDiff > 0) {
        // Winning → slow down
        play.tempo = 'slow';
      }
    }

    return play;
  }

  static getFormationPositions(formation: Formation): FormationPosition[] {
    return FORMATIONS[formation];
  }
}
