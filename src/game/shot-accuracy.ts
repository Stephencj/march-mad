export interface ShotContext {
  distance: number;         // distance from hoop in court units
  shootingStat: number;     // 1-10 player shooting stat
  defenderDistance: number;  // nearest defender distance (units)
  shotType: string;         // 'layup', 'mid-range', 'three-pointer', 'dunk', etc.
}

export function calculateShotSuccess(ctx: ShotContext): boolean {
  let baseAccuracy: number;
  switch (ctx.shotType) {
    case 'dunk':
    case 'alley-oop':
    case 'powerup-dunk':
      baseAccuracy = 0.95;
      break;
    case 'layup':
      baseAccuracy = 0.75;
      break;
    case 'mid-range':
      baseAccuracy = 0.45;
      break;
    case 'three-pointer':
      baseAccuracy = 0.33;
      break;
    default:
      baseAccuracy = 0.40;
  }

  // Distance penalty: beyond normal range, accuracy drops sharply
  const normalRange = 8;
  if (ctx.distance > normalRange) {
    const overshoot = (ctx.distance - normalRange) / normalRange;
    baseAccuracy *= Math.max(0.02, 1 - overshoot * 1.5);
  }

  // Stat modifier: shooting stat 1-10 scales ±30%
  const statModifier = 1 + (ctx.shootingStat - 5) * 0.06;
  baseAccuracy *= statModifier;

  // Contest penalty: closer defender = lower accuracy
  const contestPenalty = Math.max(0.6, 1 - Math.max(0, 5 - ctx.defenderDistance) * 0.08);
  baseAccuracy *= contestPenalty;

  baseAccuracy = Math.max(0.02, Math.min(0.98, baseAccuracy));
  return Math.random() < baseAccuracy;
}
