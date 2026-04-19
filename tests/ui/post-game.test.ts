// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { PostGameUI } from '@/ui/post-game';
import type { GameOverData } from '@/core/types';

function makeGameOverData(overrides: Partial<GameOverData> = {}): GameOverData {
  return {
    winner: 'home',
    homeScore: 21,
    awayScore: 15,
    humanTeam: 'home',
    humanWon: true,
    humanStats: { points: 14, assists: 5, steals: 3 },
    xpEarned: 95,
    coinsEarned: 50,
    gameDuration: 300,
    ...overrides,
  };
}

describe('PostGameUI', () => {
  it('renders win screen with YOU WIN and scores', () => {
    const container = document.createElement('div');
    const ui = new PostGameUI(container, () => {});

    ui.show(makeGameOverData({ humanWon: true, homeScore: 21, awayScore: 15 }));

    expect(container.textContent).toContain('YOU WIN!');
    expect(container.textContent).toContain('21');
    expect(container.textContent).toContain('15');
  });

  it('renders loss screen with YOU LOSE', () => {
    const container = document.createElement('div');
    const ui = new PostGameUI(container, () => {});

    ui.show(makeGameOverData({ humanWon: false }));

    expect(container.textContent).toContain('YOU LOSE');
    expect(container.textContent).not.toContain('YOU WIN');
  });

  it('shows XP and coins values', () => {
    const container = document.createElement('div');
    const ui = new PostGameUI(container, () => {});

    ui.show(makeGameOverData({ xpEarned: 95, coinsEarned: 50 }));

    expect(container.textContent).toContain('+95 XP');
    expect(container.textContent).toContain('+50 coins');
  });

  it('hide() clears children', () => {
    const container = document.createElement('div');
    const ui = new PostGameUI(container, () => {});

    ui.show(makeGameOverData());
    expect(container.children.length).toBeGreaterThan(0);

    ui.hide();
    expect(container.children.length).toBe(0);
  });

  describe('quick mode (default)', () => {
    it('renders PLAY AGAIN and MAIN MENU buttons', () => {
      const container = document.createElement('div');
      const ui = new PostGameUI(container, () => {});
      ui.show(makeGameOverData());

      const buttons = Array.from(container.querySelectorAll('button'));
      const labels = buttons.map((b) => b.textContent);
      expect(labels).toContain('PLAY AGAIN');
      expect(labels).toContain('MAIN MENU');
      expect(labels).not.toContain('VIEW BRACKET');
    });

    it('PLAY AGAIN dispatches play-again action', () => {
      const container = document.createElement('div');
      const actions: string[] = [];
      const ui = new PostGameUI(container, (a) => actions.push(a));
      ui.show(makeGameOverData());

      const playAgain = container.querySelector<HTMLButtonElement>('button[data-action="play-again"]')!;
      playAgain.click();
      expect(actions).toContain('play-again');
    });
  });

  describe('tournament mode', () => {
    it('renders VIEW BRACKET (not PLAY AGAIN) when not champion', () => {
      const container = document.createElement('div');
      const ui = new PostGameUI(container, () => {});
      ui.show(makeGameOverData(), { mode: 'tournament', isChampion: false });

      const buttons = Array.from(container.querySelectorAll('button'));
      const labels = buttons.map((b) => b.textContent);
      expect(labels).toContain('VIEW BRACKET');
      expect(labels).toContain('MAIN MENU');
      expect(labels).not.toContain('PLAY AGAIN');
    });

    it('renders VIEW CHAMPION when isChampion is true', () => {
      const container = document.createElement('div');
      const ui = new PostGameUI(container, () => {});
      ui.show(makeGameOverData(), { mode: 'tournament', isChampion: true });

      const buttons = Array.from(container.querySelectorAll('button'));
      const labels = buttons.map((b) => b.textContent);
      expect(labels).toContain('VIEW CHAMPION');
    });

    it('VIEW BRACKET dispatches tournament-continue action', () => {
      const container = document.createElement('div');
      const actions: string[] = [];
      const ui = new PostGameUI(container, (a) => actions.push(a));
      ui.show(makeGameOverData(), { mode: 'tournament' });

      const btn = container.querySelector<HTMLButtonElement>('button[data-action="tournament-continue"]')!;
      btn.click();
      expect(actions).toContain('tournament-continue');
    });
  });

  describe('tournament-end mode', () => {
    it('renders CHAMPION headline with the champion name', () => {
      const container = document.createElement('div');
      const ui = new PostGameUI(container, () => {});
      ui.show(makeGameOverData(), { mode: 'tournament-end', championName: 'State Wolves' });

      expect(container.textContent).toContain('CHAMPION: State Wolves');
      expect(container.textContent).not.toContain('YOU WIN');
    });

    it('only renders MAIN MENU button (no continue/play-again)', () => {
      const container = document.createElement('div');
      const ui = new PostGameUI(container, () => {});
      ui.show(makeGameOverData(), { mode: 'tournament-end', championName: 'X' });

      const buttons = Array.from(container.querySelectorAll('button'));
      const labels = buttons.map((b) => b.textContent);
      expect(labels).toEqual(['MAIN MENU']);
    });
  });
});
