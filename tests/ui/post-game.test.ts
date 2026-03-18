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
});
