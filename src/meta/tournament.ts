import { TeamData, TournamentTier, TOURNAMENT_CONFIGS } from '@/core/types';

export interface BracketMatch {
  id: string;
  round: number;
  teamA: TeamData;
  teamB: TeamData;
  winnerId: string | null;
}

export class Tournament {
  readonly tier: TournamentTier;
  private matches: BracketMatch[] = [];
  private currentRound = 1;
  private _champion: TeamData | null = null;

  constructor(tier: TournamentTier, teams: TeamData[]) {
    this.tier = tier;
    this.buildBracket(teams);
  }

  /** Sort teams by seed and pair i with (length-1-i). */
  private buildBracket(teams: TeamData[]): void {
    const sorted = [...teams].sort((a, b) => a.seed - b.seed);
    const half = sorted.length / 2;

    for (let i = 0; i < half; i++) {
      this.matches.push({
        id: `r1-m${i + 1}`,
        round: 1,
        teamA: sorted[i],
        teamB: sorted[sorted.length - 1 - i],
        winnerId: null,
      });
    }
  }

  /** Report the result of a match, advancing the round when all matches are decided. */
  reportResult(matchId: string, winnerId: string): void {
    const match = this.matches.find((m) => m.id === matchId);
    if (!match) return;

    match.winnerId = winnerId;

    const roundMatches = this.getMatchesForRound(match.round);
    const allDecided = roundMatches.every((m) => m.winnerId !== null);

    if (allDecided) {
      this.advanceRound(roundMatches);
    }
  }

  /** Pair winners for the next round; if only one winner remains, set champion. */
  private advanceRound(roundMatches: BracketMatch[]): void {
    const winners = roundMatches.map((m) => {
      const winnerId = m.winnerId!;
      return winnerId === m.teamA.id ? m.teamA : m.teamB;
    });

    if (winners.length === 1) {
      this._champion = winners[0];
      return;
    }

    const nextRound = this.currentRound + 1;
    this.currentRound = nextRound;

    for (let i = 0; i < winners.length; i += 2) {
      this.matches.push({
        id: `r${nextRound}-m${Math.floor(i / 2) + 1}`,
        round: nextRound,
        teamA: winners[i],
        teamB: winners[i + 1],
        winnerId: null,
      });
    }
  }

  /** Get the next unresolved match. */
  getNextMatch(): BracketMatch | undefined {
    return this.matches.find((m) => m.winnerId === null);
  }

  /** Get all matches for a given round number. */
  getMatchesForRound(round: number): BracketMatch[] {
    return this.matches.filter((m) => m.round === round);
  }

  /** Get all matches across all built rounds. */
  getAllMatches(): BracketMatch[] {
    return [...this.matches];
  }

  /** Deterministically pick a winner: lower seed always wins. */
  simulateMatch(matchId: string): string {
    const match = this.matches.find((m) => m.id === matchId);
    if (!match) throw new Error(`Match not found: ${matchId}`);
    if (match.winnerId !== null) return match.winnerId;
    const winner = match.teamA.seed <= match.teamB.seed ? match.teamA : match.teamB;
    this.reportResult(matchId, winner.id);
    return winner.id;
  }

  /** Resolve every still-undecided match in the same round as `excludeMatchId`. */
  simulateRemainingRoundMatches(excludeMatchId: string): void {
    const anchor = this.matches.find((m) => m.id === excludeMatchId);
    if (!anchor) throw new Error(`Match not found: ${excludeMatchId}`);
    const siblings = this.getMatchesForRound(anchor.round);
    for (const m of siblings) {
      if (m.winnerId === null && m.id !== excludeMatchId) {
        this.simulateMatch(m.id);
      }
    }
  }

  /** Whether the tournament is complete (has a champion). */
  get isComplete(): boolean {
    return this._champion !== null;
  }

  /** The tournament champion, or null if not yet decided. */
  get champion(): TeamData | null {
    return this._champion;
  }
}
