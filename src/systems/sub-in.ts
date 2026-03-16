export type SubInStageName = 'subtle' | 'pulsing' | 'urgent' | 'last-stand';

export interface SubInStageResult {
  stage: SubInStageName;
  deficit: number;
}

export class SubInSystem {
  private betTeamId: string | null = null;
  private subbedIn = false;

  /** Enable sub-in tracking for the given team. */
  activateBet(teamId: string): void {
    this.betTeamId = teamId;
    this.subbedIn = false;
  }

  /** Clear all sub-in state. */
  deactivate(): void {
    this.betTeamId = null;
    this.subbedIn = false;
  }

  /** Mark as subbed in, disabling future prompts. */
  executeSubIn(): void {
    this.subbedIn = true;
  }

  /**
   * Returns the current sub-in stage based on score deficit, or null
   * if no bet is active, already subbed in, or deficit < 3.
   */
  getStage(deficit: number): SubInStageResult | null {
    if (!this.betTeamId || this.subbedIn || deficit < 3) {
      return null;
    }

    let stage: SubInStageName;
    if (deficit <= 5) {
      stage = 'subtle';
    } else if (deficit <= 9) {
      stage = 'pulsing';
    } else if (deficit <= 14) {
      stage = 'urgent';
    } else {
      stage = 'last-stand';
    }

    return { stage, deficit };
  }

  /**
   * Returns a powerup tier scaled to the deficit.
   * Tier 1 (deficit < 6), Tier 2 (6-9), Tier 3 (10+).
   */
  getEntryPowerupTier(deficit: number): number {
    if (deficit < 6) return 1;
    if (deficit <= 9) return 2;
    return 3;
  }

  /**
   * Returns entrance animation duration in seconds based on deficit.
   * 1s (<6), 2s (6-9), 3s (10-14), 4s (15+).
   */
  getEntranceDuration(deficit: number): number {
    if (deficit < 6) return 1;
    if (deficit <= 9) return 2;
    if (deficit <= 14) return 3;
    return 4;
  }

  /**
   * Return the id of the player with the lowest performance score.
   */
  static findReplacementTarget(performers: { id: string; score: number }[]): string {
    let lowest = performers[0];
    for (let i = 1; i < performers.length; i++) {
      if (performers[i].score < lowest.score) {
        lowest = performers[i];
      }
    }
    return lowest.id;
  }
}
