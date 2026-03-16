const XP_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500];
const STAT_POINTS_PER_LEVEL = 2;

export class ProgressionSystem {
  xp = 0;
  level = 1;
  availableStatPoints = 0;

  static calculateXP(result: {
    won: boolean;
    points: number;
    assists: number;
    subbedIn: boolean;
  }): number {
    let xp = result.points * 5 + result.assists * 3;
    if (result.won) xp += 50;
    if (result.subbedIn && result.won) xp += 30;
    return xp;
  }

  addXP(amount: number): void {
    this.xp += amount;
    while (
      this.level < XP_THRESHOLDS.length &&
      this.xp >= XP_THRESHOLDS[this.level]
    ) {
      this.level++;
      this.availableStatPoints += STAT_POINTS_PER_LEVEL;
    }
  }

  getXPForNextLevel(): number {
    if (this.level >= XP_THRESHOLDS.length) return Infinity;
    return XP_THRESHOLDS[this.level] - this.xp;
  }
}
