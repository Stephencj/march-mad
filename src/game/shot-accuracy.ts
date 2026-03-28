export interface ShotContext {
  distance: number;
  shootingStat: number;
  defenderDistance: number;
  shotType: string;
  chargeMultiplier?: number;
  contestBonus?: number;
  isDefenderGuarding?: boolean;
}

export function calculateShotSuccess(ctx: ShotContext): boolean {
  // Dunks always succeed — contest is handled separately in game-session
  if (ctx.shotType === 'dunk' || ctx.shotType === 'alley-oop' || ctx.shotType === 'powerup-dunk') {
    return true;
  }

  let baseAccuracy: number;
  switch (ctx.shotType) {
    case 'layup':
      baseAccuracy = 0.85;
      break;
    case 'mid-range':
      baseAccuracy = 0.55;
      break;
    case 'three-pointer':
      baseAccuracy = 0.40;
      break;
    default:
      baseAccuracy = 0.50;
  }

  // Distance penalty: beyond normal range, accuracy drops
  const normalRange = 8;
  if (ctx.distance > normalRange) {
    const overshoot = (ctx.distance - normalRange) / normalRange;
    baseAccuracy *= Math.max(0.05, 1 - overshoot * 1.2);
  }

  // Stat modifier: shooting stat 1-10 scales +/-30%
  const statModifier = 1 + (ctx.shootingStat - 5) * 0.06;
  baseAccuracy *= statModifier;

  // Contest penalty: ONLY when defender is actively guarding AND close
  if (ctx.isDefenderGuarding && ctx.defenderDistance < 2) {
    baseAccuracy *= 0.80; // -20% for active guard within 2u
  }

  // Charge multiplier (default 1.0 for AI, variable for human)
  const charge = ctx.chargeMultiplier ?? 1.0;
  baseAccuracy *= charge;

  // Active contest bonus (jump-block)
  const bonus = ctx.contestBonus ?? 0;
  baseAccuracy *= (1 - bonus);

  baseAccuracy = Math.max(0.02, Math.min(0.98, baseAccuracy));
  return Math.random() < baseAccuracy;
}
