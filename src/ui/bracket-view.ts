import { BracketMatch } from '@/meta/tournament';

export class BracketViewUI {
  private container: HTMLElement;
  private onMatchClick: (match: BracketMatch) => void;

  constructor(container: HTMLElement, onMatchClick: (match: BracketMatch) => void) {
    this.container = container;
    this.onMatchClick = onMatchClick;
  }

  render(matches: BracketMatch[], currentRound: number): void {
    this.hide();

    const wrapper = document.createElement('div');
    wrapper.classList.add('bracket');

    // Determine all rounds present
    const rounds = new Set<number>();
    for (const m of matches) {
      rounds.add(m.round);
    }

    const sortedRounds = [...rounds].sort((a, b) => a - b);

    for (const round of sortedRounds) {
      const roundCol = document.createElement('div');
      roundCol.classList.add('bracket__round');
      if (round === currentRound) {
        roundCol.classList.add('bracket__round--active');
      }

      const roundLabel = document.createElement('h3');
      roundLabel.classList.add('bracket__round-label');
      roundLabel.textContent = `Round ${round}`;
      roundCol.appendChild(roundLabel);

      const roundMatches = matches.filter((m) => m.round === round);

      for (const match of roundMatches) {
        const card = document.createElement('button');
        card.classList.add('bracket__match');

        const isActive = match.winnerId === null && match.round === currentRound;
        if (isActive) {
          card.classList.add('bracket__match--active');
        }

        const teamAEl = document.createElement('div');
        teamAEl.classList.add('bracket__team');
        if (match.winnerId === match.teamA.id) {
          teamAEl.classList.add('bracket__team--winner');
        }
        teamAEl.textContent = match.teamA.name;
        card.appendChild(teamAEl);

        const vs = document.createElement('span');
        vs.classList.add('bracket__vs');
        vs.textContent = 'vs';
        card.appendChild(vs);

        const teamBEl = document.createElement('div');
        teamBEl.classList.add('bracket__team');
        if (match.winnerId === match.teamB.id) {
          teamBEl.classList.add('bracket__team--winner');
        }
        teamBEl.textContent = match.teamB.name;
        card.appendChild(teamBEl);

        card.addEventListener('click', () => this.onMatchClick(match));
        roundCol.appendChild(card);
      }

      wrapper.appendChild(roundCol);
    }

    this.container.appendChild(wrapper);
  }

  hide(): void {
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }
}
