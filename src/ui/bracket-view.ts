import { BracketMatch } from '@/meta/tournament';
import { MenuNavigator } from './menu-navigator';

export class BracketViewUI {
  private container: HTMLElement;
  private onMatchClick: (match: BracketMatch) => void;
  private navigator: MenuNavigator | null = null;

  constructor(container: HTMLElement, onMatchClick: (match: BracketMatch) => void) {
    this.container = container;
    this.onMatchClick = onMatchClick;
  }

  setNavigator(nav: MenuNavigator): void {
    this.navigator = nav;
  }

  render(matches: BracketMatch[], currentRound: number): void {
    this.hide();

    const wrapper = document.createElement('div');
    wrapper.classList.add('bracket');
    Object.assign(wrapper.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      background: 'rgba(10, 10, 20, 0.92)',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '24px',
      padding: '24px',
      overflow: 'auto',
      fontFamily: 'sans-serif',
      color: '#ffffff',
      boxSizing: 'border-box',
    });

    // Determine all rounds present
    const rounds = new Set<number>();
    for (const m of matches) {
      rounds.add(m.round);
    }

    const sortedRounds = [...rounds].sort((a, b) => a - b);

    for (const round of sortedRounds) {
      const roundCol = document.createElement('div');
      roundCol.classList.add('bracket__round');
      Object.assign(roundCol.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '8px',
        minWidth: '160px',
      });
      const isActiveRound = round === currentRound;
      if (isActiveRound) {
        roundCol.classList.add('bracket__round--active');
      }

      const roundLabel = document.createElement('h3');
      roundLabel.classList.add('bracket__round-label');
      roundLabel.textContent = `Round ${round}`;
      Object.assign(roundLabel.style, {
        fontSize: '16px',
        fontWeight: 'bold',
        color: isActiveRound ? '#e94560' : '#aaaaaa',
        textAlign: 'center',
        margin: '0 0 8px 0',
        letterSpacing: '2px',
      });
      roundCol.appendChild(roundLabel);

      const roundMatches = matches.filter((m) => m.round === round);

      for (const match of roundMatches) {
        const card = document.createElement('button');
        card.classList.add('bracket__match');
        card.dataset.matchId = match.id;

        const isActive = match.winnerId === null && match.round === currentRound;
        if (isActive) {
          card.classList.add('bracket__match--active');
        }
        Object.assign(card.style, {
          background: isActive ? '#1f2540' : '#15182a',
          border: isActive ? '2px solid #e94560' : '1px solid #333',
          borderRadius: '6px',
          padding: '10px 12px',
          cursor: match.winnerId === null ? 'pointer' : 'default',
          color: '#ffffff',
          fontFamily: 'sans-serif',
          fontSize: '13px',
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          pointerEvents: 'auto',
        });

        const teamAEl = document.createElement('div');
        teamAEl.classList.add('bracket__team');
        const teamAWon = match.winnerId === match.teamA.id;
        if (teamAWon) teamAEl.classList.add('bracket__team--winner');
        Object.assign(teamAEl.style, {
          fontWeight: teamAWon ? 'bold' : 'normal',
          color: teamAWon ? '#4caf50' : '#ffffff',
          opacity: match.winnerId !== null && !teamAWon ? '0.5' : '1',
        });
        teamAEl.textContent = `(${match.teamA.seed}) ${match.teamA.name}`;
        card.appendChild(teamAEl);

        const vs = document.createElement('span');
        vs.classList.add('bracket__vs');
        vs.textContent = 'vs';
        Object.assign(vs.style, {
          fontSize: '10px',
          color: '#666',
          textAlign: 'center',
        });
        card.appendChild(vs);

        const teamBEl = document.createElement('div');
        teamBEl.classList.add('bracket__team');
        const teamBWon = match.winnerId === match.teamB.id;
        if (teamBWon) teamBEl.classList.add('bracket__team--winner');
        Object.assign(teamBEl.style, {
          fontWeight: teamBWon ? 'bold' : 'normal',
          color: teamBWon ? '#4caf50' : '#ffffff',
          opacity: match.winnerId !== null && !teamBWon ? '0.5' : '1',
        });
        teamBEl.textContent = `(${match.teamB.seed}) ${match.teamB.name}`;
        card.appendChild(teamBEl);

        card.addEventListener('click', () => this.onMatchClick(match));
        roundCol.appendChild(card);
      }

      wrapper.appendChild(roundCol);
    }

    this.container.appendChild(wrapper);

    const buttons = this.container.querySelectorAll('button');
    this.navigator?.register(Array.from(buttons));
  }

  /** Highlight a match button so the user sees which one to enter. */
  focusMatch(matchId: string): void {
    const btn = this.container.querySelector<HTMLButtonElement>(
      `button[data-match-id="${matchId}"]`,
    );
    if (!btn) return;
    btn.classList.add('menu-focused');
    btn.focus();
  }

  hide(): void {
    this.navigator?.clear();
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }
}
