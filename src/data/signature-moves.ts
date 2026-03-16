export interface SignatureMove {
  name: string;
  cooldown: number;
  effect: string;
  duration: number;
  unlockLevel: number;
}

export const SIGNATURE_MOVES: SignatureMove[] = [
  { name: 'Ankle Breaker', cooldown: 20, effect: 'crossover-stun', duration: 2, unlockLevel: 1 },
  { name: 'Fadeaway', cooldown: 15, effect: 'unblockable-shot', duration: 1, unlockLevel: 1 },
  { name: 'Chase Down', cooldown: 25, effect: 'guaranteed-block', duration: 3, unlockLevel: 1 },
  { name: 'No-Look Pass', cooldown: 12, effect: 'perfect-pass', duration: 1, unlockLevel: 3 },
  { name: 'Posterizer', cooldown: 30, effect: 'power-dunk', duration: 2, unlockLevel: 5 },
  { name: 'Lock Up', cooldown: 20, effect: 'steal-boost', duration: 5, unlockLevel: 4 },
  { name: 'Heat Check', cooldown: 25, effect: 'shot-streak', duration: 8, unlockLevel: 6 },
  { name: 'Floor General', cooldown: 18, effect: 'team-boost', duration: 10, unlockLevel: 7 },
];

export function getSignatureMove(name: string): SignatureMove | undefined {
  return SIGNATURE_MOVES.find(m => m.name === name);
}
