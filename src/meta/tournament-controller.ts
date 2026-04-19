import type { TeamData, TournamentTier } from '@/core/types';
import { TOURNAMENT_CONFIGS } from '@/core/types';
import { Tournament, BracketMatch } from './tournament';
import { generateTeams } from '@/data/teams';

export interface CurrentMatchContext {
  match: BracketMatch;
  homeTeam: TeamData;
  awayTeam: TeamData;
}

export class TournamentController {
  readonly tier: TournamentTier;
  private tournament: Tournament;
  private context: CurrentMatchContext | null = null;

  constructor(tier: TournamentTier, teamProvider: (count: number) => TeamData[] = defaultTeamProvider) {
    this.tier = tier;
    const teamCount = TOURNAMENT_CONFIGS[tier].teamCount;
    const teams = teamProvider(teamCount);
    if (teams.length !== teamCount) {
      throw new Error(`Tier ${tier} requires ${teamCount} teams, got ${teams.length}`);
    }
    this.tournament = new Tournament(tier, teams);
  }

  get isActive(): boolean {
    return !this.tournament.isComplete;
  }

  get champion(): TeamData | null {
    return this.tournament.champion;
  }

  get currentMatchContext(): CurrentMatchContext | null {
    return this.context;
  }

  get allMatches(): BracketMatch[] {
    return this.tournament.getAllMatches();
  }

  get currentRound(): number {
    const next = this.tournament.getNextMatch();
    return next?.round ?? this.allMatches[this.allMatches.length - 1]?.round ?? 1;
  }

  getNextHumanMatch(): BracketMatch | undefined {
    return this.tournament.getNextMatch();
  }

  /**
   * Mark the given bracket match as the human's active match. Convention:
   * teamA is always assigned to home, teamB to away. The home/away mapping
   * is captured here so we can translate `GameOverData.winner` ('home'|'away')
   * back to a team id when the match ends.
   */
  enterMatch(matchId: string): CurrentMatchContext {
    const match = this.allMatches.find((m) => m.id === matchId);
    if (!match) throw new Error(`Match not found: ${matchId}`);
    if (match.winnerId !== null) throw new Error(`Match ${matchId} already decided`);
    this.context = { match, homeTeam: match.teamA, awayTeam: match.teamB };
    return this.context;
  }

  /**
   * Record the human's match result, then auto-sim every other match in the
   * same round so the bracket is ready to advance.
   */
  recordHumanResult(winnerSide: 'home' | 'away'): void {
    if (!this.context) throw new Error('No active match context');
    const winnerId = winnerSide === 'home' ? this.context.homeTeam.id : this.context.awayTeam.id;
    const matchId = this.context.match.id;
    this.tournament.simulateRemainingRoundMatches(matchId);
    this.tournament.reportResult(matchId, winnerId);
    this.context = null;
  }

  dispose(): void {
    this.context = null;
  }
}

function defaultTeamProvider(count: number): TeamData[] {
  // generateTeams returns 64 teams with seeds 1-16 (4 per seed, one per region).
  // Tournament needs unique seeds 1..count, so we re-seed the slice.
  const all = generateTeams(5);
  return all.slice(0, count).map((t, i) => ({ ...t, seed: i + 1 }));
}
