import { PlayerData, TournamentTier } from '@/core/types';
import { generateDraftPool } from '@/data/player-pool';

export class DraftSystem {
  private _pool: PlayerData[];
  private _picks: PlayerData[] = [];
  private _rerollsLeft: number = 2;
  private _tier: TournamentTier;

  constructor(tier: TournamentTier) {
    this._tier = tier;
    this._pool = generateDraftPool(tier);
  }

  get pool(): PlayerData[] {
    return this._pool;
  }

  get picks(): PlayerData[] {
    return this._picks;
  }

  get isComplete(): boolean {
    return this._picks.length === 2;
  }

  get rerollsLeft(): number {
    return this._rerollsLeft;
  }

  pick(playerId: string): boolean {
    if (this._picks.length >= 2) {
      return false;
    }

    const player = this._pool.find((p) => p.id === playerId);
    if (!player) {
      return false;
    }

    this._picks.push(player);
    return true;
  }

  reroll(): boolean {
    if (this._rerollsLeft <= 0) {
      return false;
    }

    this._rerollsLeft--;
    this._pool = generateDraftPool(this._tier);
    return true;
  }
}
