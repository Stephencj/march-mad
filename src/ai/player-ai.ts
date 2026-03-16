import { PlayerStats, PersonalityTrait } from '@/core/types';

export type AIAction =
  | 'shoot'
  | 'pass'
  | 'drive'
  | 'dunk'
  | 'guard'
  | 'steal'
  | 'block'
  | 'screen'
  | 'idle';

export interface AIContext {
  hasBall: boolean;
  distanceToHoop: number;
  nearestDefenderDist: number;
  teammateOpenness: number[];
  scoreDiff: number;
  clockSeconds: number;
}

export interface AIDecision {
  action: AIAction;
  targetIndex?: number;
  confidence: number;
}

interface StatModifiers {
  shootingBonus: number;
  speedBonus: number;
  defenseBonus: number;
}

interface PersonalityWeights {
  shootBias: number;
  passBias: number;
  driveBias: number;
  defenseBias: number;
}

const PERSONALITY_WEIGHTS: Record<PersonalityTrait, PersonalityWeights> = {
  'Ball Hog':    { shootBias: 0.35, passBias: -0.15, driveBias: 0.1,  defenseBias: 0.0 },
  'Team Player': { shootBias: -0.1,  passBias: 0.3,   driveBias: 0.0,  defenseBias: 0.05 },
  'Clutch':      { shootBias: 0.1,   passBias: 0.0,   driveBias: 0.05, defenseBias: 0.05 },
  'Lockdown':    { shootBias: -0.05, passBias: 0.0,   driveBias: 0.0,  defenseBias: 0.4 },
  'Spark Plug':  { shootBias: 0.1,   passBias: 0.05,  driveBias: 0.2,  defenseBias: 0.05 },
};

export class PlayerAI {
  private stats: PlayerStats;
  private personality: PersonalityTrait;
  private weights: PersonalityWeights;

  constructor(stats: PlayerStats, personality: PersonalityTrait) {
    this.stats = stats;
    this.personality = personality;
    this.weights = PERSONALITY_WEIGHTS[personality];
  }

  getStatModifiers(scoreDiff: number, clockSeconds: number): StatModifiers {
    if (this.personality !== 'Clutch') {
      return { shootingBonus: 0, speedBonus: 0, defenseBonus: 0 };
    }
    const isCloseGame = Math.abs(scoreDiff) <= 5;
    const isLowClock = clockSeconds < 60;
    if (isCloseGame && isLowClock) {
      return {
        shootingBonus: 2,
        speedBonus: 1,
        defenseBonus: 1,
      };
    }
    return { shootingBonus: 0, speedBonus: 0, defenseBonus: 0 };
  }

  decide(ctx: AIContext): AIDecision {
    const mods = this.getStatModifiers(ctx.scoreDiff, ctx.clockSeconds);

    if (ctx.hasBall) {
      return this.decideOffense(ctx, mods);
    }
    return this.decideDefense(ctx, mods);
  }

  private decideOffense(ctx: AIContext, mods: StatModifiers): AIDecision {
    const effectiveShooting = this.stats.shooting + mods.shootingBonus;
    const effectiveSpeed = this.stats.speed + mods.speedBonus;
    const effectivePassing = this.stats.passing;

    // Proximity factor: closer to hoop = higher shoot score (max at distance 0)
    const proximityFactor = Math.max(0, 1 - ctx.distanceToHoop / 20);

    // Openness factor: further from defender = more open
    const opennessFactor = Math.min(1, ctx.nearestDefenderDist / 10);

    // --- Shoot score ---
    const shootBase = (effectiveShooting / 10) * 0.4
      + proximityFactor * 0.3
      + opennessFactor * 0.3;
    const shootScore = Math.min(1, shootBase + this.weights.shootBias);

    // --- Pass score ---
    const bestTeammateOpenness = ctx.teammateOpenness.length > 0
      ? Math.max(...ctx.teammateOpenness)
      : 0;
    const avgTeammateOpenness = ctx.teammateOpenness.length > 0
      ? ctx.teammateOpenness.reduce((a, b) => a + b, 0) / ctx.teammateOpenness.length
      : 0;
    const passBase = (effectivePassing / 10) * 0.35
      + bestTeammateOpenness * 0.35
      + (1 - opennessFactor) * 0.3; // pass more when covered
    const passScore = Math.min(1, passBase + this.weights.passBias);

    // --- Drive score ---
    const driveBase = (effectiveSpeed / 10) * 0.4
      + (1 - proximityFactor) * 0.2
      + opennessFactor * 0.2
      + (this.stats.dunkPower / 10) * 0.2;
    const driveScore = Math.min(1, driveBase + this.weights.driveBias);

    // --- Dunk score (only close to hoop and open) ---
    let dunkScore = 0;
    if (ctx.distanceToHoop <= 4 && ctx.nearestDefenderDist > 3) {
      dunkScore = (this.stats.dunkPower / 10) * 0.6 + proximityFactor * 0.4;
    }

    // Pick the highest scoring action
    const scores: { action: AIAction; score: number; targetIndex?: number }[] = [
      { action: 'shoot', score: shootScore },
      { action: 'pass', score: passScore, targetIndex: this.pickPassTarget(ctx.teammateOpenness) },
      { action: 'drive', score: driveScore },
      { action: 'dunk', score: dunkScore },
    ];

    // Add slight randomness to prevent perfectly deterministic behavior
    const jitteredScores = scores.map(s => ({
      ...s,
      score: s.score + (Math.random() * 0.08 - 0.04),
    }));

    jitteredScores.sort((a, b) => b.score - a.score);
    const best = jitteredScores[0];

    return {
      action: best.action,
      targetIndex: best.targetIndex,
      confidence: Math.max(0, Math.min(1, best.score)),
    };
  }

  private decideDefense(ctx: AIContext, mods: StatModifiers): AIDecision {
    const effectiveDefense = this.stats.defense + mods.defenseBonus;
    const defenseBias = this.weights.defenseBias;

    // Steal attempt when close to ball handler
    if (ctx.nearestDefenderDist <= 2) {
      const stealScore = (effectiveDefense / 10) * 0.6 + 0.3 + defenseBias * 0.5;
      return {
        action: 'steal',
        confidence: Math.max(0, Math.min(1, stealScore)),
      };
    }

    // Block when near the hoop
    if (ctx.distanceToHoop <= 4) {
      const blockScore = (effectiveDefense / 10) * 0.5 + 0.3 + defenseBias * 0.5;
      return {
        action: 'block',
        confidence: Math.max(0, Math.min(1, blockScore)),
      };
    }

    // Otherwise guard
    const guardScore = (effectiveDefense / 10) * 0.5 + 0.3 + defenseBias * 0.3;
    return {
      action: 'guard',
      confidence: Math.max(0, Math.min(1, guardScore)),
    };
  }

  private pickPassTarget(teammateOpenness: number[]): number {
    if (teammateOpenness.length === 0) return 0;
    let bestIdx = 0;
    let bestVal = teammateOpenness[0];
    for (let i = 1; i < teammateOpenness.length; i++) {
      if (teammateOpenness[i] > bestVal) {
        bestVal = teammateOpenness[i];
        bestIdx = i;
      }
    }
    return bestIdx;
  }
}
