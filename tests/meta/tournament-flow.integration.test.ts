// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { TournamentController } from '@/meta/tournament-controller';
import { PostGameUI } from '@/ui/post-game';
import type { GameOverData, TeamData } from '@/core/types';

/**
 * End-to-end flow: simulate the loop main.ts runs for a tournament.
 * We don't import main.ts (it constructs a Three.js renderer that won't
 * work in jsdom), but we replicate the state transitions through the
 * controller + post-game UI to catch wiring bugs in their composition —
 * specifically the home/away ↔ winnerId translation across the round loop.
 */

function makeTeam(seed: number): TeamData {
  return {
    id: `team-${seed}`,
    name: `Team ${seed}`,
    mascot: `Mascot ${seed}`,
    colors: { primary: '#000', secondary: '#fff' },
    archetype: 'Balanced',
    seed,
    players: [],
  };
}

function makeTeams(count: number): TeamData[] {
  return Array.from({ length: count }, (_, i) => makeTeam(i + 1));
}

function makeGameOver(side: 'home' | 'away'): GameOverData {
  return {
    winner: side,
    homeScore: side === 'home' ? 21 : 14,
    awayScore: side === 'away' ? 21 : 14,
    humanTeam: 'home',
    humanWon: side === 'home',
    humanStats: { points: 10, assists: 0, steals: 0 },
    xpEarned: 0,
    coinsEarned: 0,
    gameDuration: 180,
  };
}

describe('Tournament flow — controller × post-game integration', () => {
  it('plays an 8-team tournament where the human always wins, ending in a champion screen', () => {
    const controller = new TournamentController('casual', makeTeams);
    const container = document.createElement('div');
    const actions: string[] = [];
    const postGame = new PostGameUI(container, (a) => actions.push(a));

    let humanMatchesPlayed = 0;

    while (controller.isActive) {
      // 1. Bracket: pick the next human match
      const next = controller.getNextHumanMatch()!;
      const ctx = controller.enterMatch(next.id);
      const humanTeamId = ctx.homeTeam.id; // human is always home in our wiring

      // 2. YourGame plays. Simulate game-over on home (human wins).
      controller.recordHumanResult('home');
      humanMatchesPlayed++;

      // 3. PostGame shows. The human team should be the recorded winner of this match.
      const decided = controller.allMatches.find((m) => m.id === next.id)!;
      expect(decided.winnerId).toBe(humanTeamId);

      const isFinalMatch = !controller.isActive; // controller went inactive => champion set
      postGame.show(makeGameOver('home'), {
        mode: isFinalMatch ? 'tournament-end' : 'tournament',
        isChampion: isFinalMatch,
        championName: controller.champion?.name,
      });

      // 4. Verify the right button is rendered
      const buttons = Array.from(container.querySelectorAll('button'));
      const labels = buttons.map((b) => b.textContent);
      if (isFinalMatch) {
        expect(labels).toContain('MAIN MENU');
        expect(labels).not.toContain('VIEW BRACKET');
        expect(container.textContent).toContain('CHAMPION');
        expect(container.textContent).toContain(controller.champion!.name);
      } else {
        expect(labels).toContain('VIEW BRACKET');
        // Click VIEW BRACKET to advance — main.ts would dispatch tournament-continue
        const cont = container.querySelector<HTMLButtonElement>('button[data-action="tournament-continue"]')!;
        cont.click();
        expect(actions[actions.length - 1]).toBe('tournament-continue');
      }
      postGame.hide();
    }

    // 8-team casual = 3 rounds = 3 matches for the human
    expect(humanMatchesPlayed).toBe(3);
    expect(controller.champion).not.toBeNull();
    // Since human always wins as 'home' (= teamA) and teamA is the lower seed in
    // round 1 (seed 1 vs 8, etc.), and we deterministically advance, the #1 seed wins.
    expect(controller.champion!.id).toBe('team-1');
  });

  it('records the AWAY (CPU) team as the winner when the human loses', () => {
    const controller = new TournamentController('casual', makeTeams);
    const next = controller.getNextHumanMatch()!;
    const ctx = controller.enterMatch(next.id);
    const cpuTeamId = ctx.awayTeam.id;

    controller.recordHumanResult('away'); // CPU won

    const decided = controller.allMatches.find((m) => m.id === next.id)!;
    expect(decided.winnerId).toBe(cpuTeamId);
    expect(decided.winnerId).not.toBe(ctx.homeTeam.id);
  });

  it('plays through sweet16 (16 teams, 4 rounds = 4 human matches)', () => {
    const controller = new TournamentController('sweet16', makeTeams);
    let count = 0;
    while (controller.isActive) {
      const next = controller.getNextHumanMatch()!;
      controller.enterMatch(next.id);
      controller.recordHumanResult('home');
      count++;
    }
    expect(count).toBe(4);
    expect(controller.champion).not.toBeNull();
  });
});
