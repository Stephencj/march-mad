export interface OddsResult {
  favorite: number;
  underdog: number;
}

export interface PlaceBetResult {
  success: boolean;
  reason?: string;
}

export class BettingSystem {
  coins = 0;
  reputation = 0;

  private _betTeamId: string | null = null;
  private _betCoinAmount = 0;
  private _betRepAmount = 0;

  /** Set the player's balance. */
  setBalance(coins: number, rep: number): void {
    this.coins = coins;
    this.reputation = rep;
  }

  /**
   * Calculate odds based on seed difference.
   * Lower odds for the favorite, higher for the underdog.
   */
  calculateOdds(seedA: number, seedB: number): OddsResult {
    const diff = Math.abs(seedA - seedB);
    const favoriteOdds = Math.max(1.1, 2.0 - diff * 0.1);
    const underdogOdds = 1.0 + diff * 0.1 + 1.0;

    return {
      favorite: parseFloat(favoriteOdds.toFixed(2)),
      underdog: parseFloat(underdogOdds.toFixed(2)),
    };
  }

  /**
   * Place a bet on a team.
   * Enforces a 50% max bet relative to current coin balance.
   */
  placeBet(
    teamId: string,
    coinAmount: number,
    repAmount: number,
  ): PlaceBetResult {
    const maxBet = Math.floor(this.coins * 0.5);
    if (coinAmount > maxBet) {
      return {
        success: false,
        reason: `Bet exceeds 50% max (${maxBet} coins)`,
      };
    }

    this.coins -= coinAmount;
    this.reputation -= repAmount;

    this._betTeamId = teamId;
    this._betCoinAmount = coinAmount;
    this._betRepAmount = repAmount;

    return { success: true };
  }

  /**
   * Resolve the active bet.
   * On win: payout = coins * odds * clutchMultiplier, add coins + rep bonus.
   * On loss: coins already deducted, lose rep.
   */
  resolveBet(
    winningTeamId: string,
    odds: number,
    subbedIn: boolean,
  ): void {
    if (!this._betTeamId) return;

    const won = winningTeamId === this._betTeamId;

    if (won) {
      const clutchMultiplier = subbedIn ? 2 : 1;
      const payout = this._betCoinAmount * odds * clutchMultiplier;
      this.coins += payout;
      this.reputation += this._betRepAmount + 5;
    } else {
      // Coins already deducted on placement.
      // Additional rep loss on loss.
      this.reputation -= 3;
    }

    this._betTeamId = null;
    this._betCoinAmount = 0;
    this._betRepAmount = 0;
  }

  /**
   * Calculate the cash-out amount for the active bet.
   * Returns coins * odds * (timeRemaining / totalTime) * 0.5
   */
  getCashOutAmount(
    odds: number,
    timeRemaining: number,
    totalTime: number,
  ): number {
    return this._betCoinAmount * odds * (timeRemaining / totalTime) * 0.5;
  }

  /** Cash out the active bet, adding the cash-out amount to balance. */
  cashOut(odds: number, timeRemaining: number, totalTime: number): void {
    const amount = this.getCashOutAmount(odds, timeRemaining, totalTime);
    this.coins += amount;

    this._betTeamId = null;
    this._betCoinAmount = 0;
    this._betRepAmount = 0;
  }

  /** Whether a bet is currently active. */
  get hasBet(): boolean {
    return this._betTeamId !== null;
  }

  /** The team id of the active bet, or null. */
  get betTeamId(): string | null {
    return this._betTeamId;
  }
}
