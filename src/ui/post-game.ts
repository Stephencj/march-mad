import type { GameOverData } from '@/core/types';
import { MenuNavigator } from './menu-navigator';

export interface PostGameContext {
  mode: 'quick' | 'tournament' | 'tournament-end';
  isChampion?: boolean;
  championName?: string;
}

export class PostGameUI {
  private container: HTMLElement;
  private onAction: (action: string) => void;
  private overlay: HTMLElement | null = null;
  private navigator: MenuNavigator | null = null;

  constructor(container: HTMLElement, onAction: (action: string) => void) {
    this.container = container;
    this.onAction = onAction;
  }

  setNavigator(nav: MenuNavigator): void {
    this.navigator = nav;
  }

  show(data: GameOverData, ctx: PostGameContext = { mode: 'quick' }): void {
    this.hide();
    this.container.style.pointerEvents = 'auto';

    this.overlay = document.createElement('div');
    this.overlay.dataset.role = 'post-game-overlay';
    Object.assign(this.overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      background: 'rgba(0,0,0,0.85)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '9999',
      fontFamily: 'sans-serif',
      color: '#ffffff',
    });

    // Result headline
    const headline = document.createElement('div');
    headline.dataset.role = 'result-headline';
    if (ctx.mode === 'tournament-end') {
      headline.textContent = `CHAMPION: ${ctx.championName ?? '???'}`;
    } else {
      headline.textContent = data.humanWon ? 'YOU WIN!' : 'YOU LOSE';
    }
    Object.assign(headline.style, {
      fontSize: '64px',
      fontWeight: 'bold',
      color: ctx.mode === 'tournament-end' ? '#ffc107' : (data.humanWon ? '#4caf50' : '#f44336'),
      marginBottom: '16px',
    });
    this.overlay.appendChild(headline);

    // Final score
    const score = document.createElement('div');
    score.dataset.role = 'final-score';
    const homeSpan = document.createElement('span');
    homeSpan.textContent = String(data.homeScore);
    const sep = document.createElement('span');
    sep.textContent = ' - ';
    const awaySpan = document.createElement('span');
    awaySpan.textContent = String(data.awayScore);
    score.appendChild(homeSpan);
    score.appendChild(sep);
    score.appendChild(awaySpan);
    Object.assign(score.style, {
      fontSize: '48px',
      fontWeight: 'bold',
      marginBottom: '32px',
    });
    this.overlay.appendChild(score);

    // Player stats section
    const statsSection = document.createElement('div');
    statsSection.dataset.role = 'player-stats';
    Object.assign(statsSection.style, {
      display: 'flex',
      gap: '32px',
      marginBottom: '32px',
    });

    const statEntries: [string, number][] = [
      ['Points', data.humanStats.points],
      ['Assists', data.humanStats.assists],
      ['Steals', data.humanStats.steals],
    ];

    for (const [label, value] of statEntries) {
      const statBox = document.createElement('div');
      Object.assign(statBox.style, {
        textAlign: 'center',
      });

      const statValue = document.createElement('div');
      statValue.textContent = String(value);
      Object.assign(statValue.style, {
        fontSize: '36px',
        fontWeight: 'bold',
      });
      statBox.appendChild(statValue);

      const statLabel = document.createElement('div');
      statLabel.textContent = label;
      Object.assign(statLabel.style, {
        fontSize: '14px',
        color: '#aaaaaa',
      });
      statBox.appendChild(statLabel);

      statsSection.appendChild(statBox);
    }
    this.overlay.appendChild(statsSection);

    // XP earned
    const xpRow = document.createElement('div');
    xpRow.dataset.role = 'xp-earned';
    xpRow.textContent = `+${data.xpEarned} XP`;
    Object.assign(xpRow.style, {
      fontSize: '28px',
      fontWeight: 'bold',
      color: '#ffc107',
      marginBottom: '8px',
    });
    this.overlay.appendChild(xpRow);

    // Coins earned
    const coinsRow = document.createElement('div');
    coinsRow.dataset.role = 'coins-earned';
    coinsRow.textContent = `+${data.coinsEarned} coins`;
    Object.assign(coinsRow.style, {
      fontSize: '28px',
      fontWeight: 'bold',
      color: '#ffc107',
      marginBottom: '32px',
    });
    this.overlay.appendChild(coinsRow);

    // Buttons
    const buttonRow = document.createElement('div');
    Object.assign(buttonRow.style, {
      display: 'flex',
      gap: '16px',
    });

    const primaryStyle = {
      padding: '12px 32px',
      fontSize: '18px',
      fontWeight: 'bold',
      border: 'none',
      borderRadius: '8px',
      cursor: 'pointer',
      background: '#4caf50',
      color: '#ffffff',
    } as const;

    if (ctx.mode === 'quick') {
      const playAgainBtn = document.createElement('button');
      playAgainBtn.textContent = 'PLAY AGAIN';
      playAgainBtn.dataset.action = 'play-again';
      Object.assign(playAgainBtn.style, primaryStyle);
      playAgainBtn.addEventListener('click', () => this.onAction('play-again'));
      buttonRow.appendChild(playAgainBtn);
    } else if (ctx.mode === 'tournament') {
      const continueBtn = document.createElement('button');
      continueBtn.textContent = ctx.isChampion ? 'VIEW CHAMPION' : 'VIEW BRACKET';
      continueBtn.dataset.action = 'tournament-continue';
      Object.assign(continueBtn.style, primaryStyle);
      continueBtn.addEventListener('click', () => this.onAction('tournament-continue'));
      buttonRow.appendChild(continueBtn);
    }

    const menuBtn = document.createElement('button');
    menuBtn.textContent = 'MAIN MENU';
    menuBtn.dataset.action = 'menu';
    Object.assign(menuBtn.style, {
      padding: '12px 32px',
      fontSize: '18px',
      fontWeight: 'bold',
      border: '2px solid #ffffff',
      borderRadius: '8px',
      cursor: 'pointer',
      background: 'transparent',
      color: '#ffffff',
    });
    menuBtn.addEventListener('click', () => this.onAction('menu'));
    buttonRow.appendChild(menuBtn);

    this.overlay.appendChild(buttonRow);
    this.container.appendChild(this.overlay);

    const buttons = this.container.querySelectorAll('button');
    this.navigator?.register(Array.from(buttons));
  }

  hide(): void {
    this.navigator?.clear();
    this.container.style.pointerEvents = 'none';
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
    this.overlay = null;
  }
}
