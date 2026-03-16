export interface DifficultyModifiers {
  reactionTime: number;
  accuracyMod: number;
  decisionQuality: number;
}

export function getDifficultyModifiers(seed: number, tournamentRound: number): DifficultyModifiers {
  const seedFactor = (seed - 1) / 15; // 0 = hardest (seed 1), 1 = easiest (seed 16)
  const roundBonus = (tournamentRound - 1) * 0.03;

  return {
    reactionTime: Math.max(0.05, 0.1 + seedFactor * 0.8 - roundBonus * 2),
    accuracyMod: Math.min(1.2, Math.max(0.3, 1.0 - seedFactor * 0.5 + roundBonus)),
    decisionQuality: Math.min(1, Math.max(0.3, 0.9 - seedFactor * 0.5 + roundBonus)),
  };
}
