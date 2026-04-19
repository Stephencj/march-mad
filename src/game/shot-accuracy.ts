import { balanceConfig } from '@/dev/balance-config';

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

  const accuracy = balanceConfig.shooting.baseAccuracy;
  let baseAccuracy: number;
  switch (ctx.shotType) {
    case 'layup':
      baseAccuracy = accuracy.layup;
      break;
    case 'mid-range':
      baseAccuracy = accuracy.midRange;
      break;
    case 'three-pointer':
      baseAccuracy = accuracy.threePointer;
      break;
    default:
      baseAccuracy = accuracy.default;
  }

  // Distance penalty: beyond normal range, accuracy drops
  const normalRange = balanceConfig.shooting.normalRange;
  if (ctx.distance > normalRange) {
    const overshoot = (ctx.distance - normalRange) / normalRange;
    baseAccuracy *= Math.max(0.05, 1 - overshoot * balanceConfig.shooting.distancePenalty);
  }

  // Stat modifier: shooting stat 1-10 scales +/-30%
  const statModifier = 1 + (ctx.shootingStat - 5) * 0.06;
  baseAccuracy *= statModifier;

  // Contest penalty: ONLY when defender is actively guarding AND close
  if (ctx.isDefenderGuarding && ctx.defenderDistance < 2) {
    baseAccuracy *= balanceConfig.shooting.contestPenalty;
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
